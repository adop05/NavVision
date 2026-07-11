import ARKit
import AVFoundation
import Combine

/// Records the live ARSession camera feed to disk as an .mp4, using the
/// SAME session configuration your production detection pipeline will use.
///
/// Why not just use the stock Camera app or AVCaptureSession directly?
/// ARKit's `capturedImage` may differ from the stock camera in resolution,
/// field of view, and lens distortion correction. Training on footage that
/// doesn't match what your model sees at inference time can quietly hurt
/// accuracy in ways that are hard to debug later. Recording through
/// ARSession guarantees your training distribution matches your inference
/// distribution.
final class ARFrameRecorder: NSObject, ObservableObject {

    @Published private(set) var isRecording = false
    @Published private(set) var elapsedSeconds: TimeInterval = 0
    @Published private(set) var lastSavedURL: URL?
    @Published private(set) var trackingState: ARCamera.TrackingState = .notAvailable

    let session = ARSession()

    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?

    private var recordingStartTime: CMTime?
    private var currentOutputURL: URL?
    private var timer: Timer?
    private var sessionStartWallClock: Date?

    // Must match the config used in ARDepthDetectionManager so recorded
    // footage matches production input exactly. sceneDepth isn't needed for
    // recording RGB, but keeping the same frameSemantics means frame timing/
    // throughput behaves the same as it will in the real pipeline.
    private func makeConfiguration() -> ARWorldTrackingConfiguration {
        let configuration = ARWorldTrackingConfiguration()
        let depthFormats: [ARConfiguration.FrameSemantics] = [.sceneDepth, .smoothedSceneDepth]
        for format in depthFormats {
            if type(of: configuration).supportsFrameSemantics(format) {
                configuration.frameSemantics.insert(format)
            }
        }
        return configuration
    }

    override init() {
        super.init()
        session.delegate = self
    }

    // MARK: - Session lifecycle

    func startSession() {
        session.run(makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    }

    func pauseSession() {
        if isRecording { stopRecording() }
        session.pause()
    }

    // MARK: - Recording control

    func startRecording() {
        guard !isRecording else { return }

        let fileName = "obstacle_\(Self.timestampString()).mp4"
        let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        currentOutputURL = outputURL

        do {
            let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

            // 1920x1440 matches typical ARKit capturedImage dimensions on
            // iPhone 15 Pro's default video format; verify against
            // `ARWorldTrackingConfiguration.supportedVideoFormats` on your
            // device if you want to lock to a specific format explicitly.
            let videoSettings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: 1920,
                AVVideoHeightKey: 1440,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 12_000_000
                ]
            ]

            let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
            input.expectsMediaDataInRealTime = true

            let sourcePixelAttributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            ]
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(
                assetWriterInput: input,
                sourcePixelBufferAttributes: sourcePixelAttributes
            )

            guard writer.canAdd(input) else {
                print("Cannot add video input to asset writer")
                return
            }
            writer.add(input)

            self.assetWriter = writer
            self.videoInput = input
            self.pixelBufferAdaptor = adaptor
            self.recordingStartTime = nil

            writer.startWriting()

            isRecording = true
            sessionStartWallClock = Date()
            startTimer()
        } catch {
            print("Failed to start asset writer: \(error.localizedDescription)")
        }
    }

    func stopRecording() {
        guard isRecording, let writer = assetWriter, let videoInput = videoInput else { return }

        isRecording = false
        stopTimer()
        videoInput.markAsFinished()

        writer.finishWriting { [weak self] in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if writer.status == .completed, let url = self.currentOutputURL {
                    self.lastSavedURL = url
                    self.persistRecording(from: url)
                } else if let error = writer.error {
                    print("Asset writer finished with error: \(error.localizedDescription)")
                }
                self.assetWriter = nil
                self.videoInput = nil
                self.pixelBufferAdaptor = nil
                self.recordingStartTime = nil
            }
        }
    }

    /// Moves the finished recording from tmp into the app's Documents
    /// directory so it survives beyond this recording session and shows up
    /// in RecordingsListView.
    private func persistRecording(from tempURL: URL) {
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationURL = documentsURL.appendingPathComponent(tempURL.lastPathComponent)

        do {
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.moveItem(at: tempURL, to: destinationURL)
            lastSavedURL = destinationURL
        } catch {
            print("Failed to persist recording: \(error.localizedDescription)")
        }
    }

    // MARK: - Timer (UI elapsed-time display)

    private func startTimer() {
        elapsedSeconds = 0
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self, let start = self.sessionStartWallClock else { return }
            self.elapsedSeconds = Date().timeIntervalSince(start)
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private static func timestampString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter.string(from: Date())
    }
}

// MARK: - ARSessionDelegate

extension ARFrameRecorder: ARSessionDelegate {
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        trackingState = frame.camera.trackingState

        guard isRecording,
              let writer = assetWriter,
              let videoInput = videoInput,
              let adaptor = pixelBufferAdaptor,
              videoInput.isReadyForMoreMediaData else { return }

        let presentationTime = frame.timestamp

        if recordingStartTime == nil {
            recordingStartTime = CMTime(seconds: presentationTime, preferredTimescale: 600)
            // startSession(atSourceTime:) must be called before appending buffers.
            writer.startSession(atSourceTime: .zero)
        }

        guard let startTime = recordingStartTime else { return }
        let currentTime = CMTime(seconds: presentationTime, preferredTimescale: 600)
        let relativeTime = CMTimeSubtract(currentTime, startTime)

        adaptor.append(frame.capturedImage, withPresentationTime: relativeTime)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        print("ARSession failed: \(error.localizedDescription)")
    }
}
