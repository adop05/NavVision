import ARKit
import Combine

/// Runs the ARSession with sceneDepth and continuously samples a center
/// "path ahead" region for the nearest confident distance — same approach
/// as the standalone ProximityBeeper app, just reused here to drive the
/// web frontend's existing SonarSynthesizer instead of a native beep.
final class LidarDepthMonitor: NSObject, ObservableObject {

    @Published private(set) var nearestDistance: Float?
    @Published private(set) var trackingState: ARCamera.TrackingState = .notAvailable
    @Published private(set) var isRunning: Bool = false

    let session = ARSession()

    var sampleRegionWidthFraction: CGFloat = 0.5
    var sampleRegionHeightFraction: CGFloat = 0.6
    var minimumConfidence: ARConfidenceLevel = .medium

    override init() {
        super.init()
        session.delegate = self
    }

    func start() {
        let configuration = ARWorldTrackingConfiguration()
        let depthFormats: [ARConfiguration.FrameSemantics] = [.sceneDepth, .smoothedSceneDepth]
        for format in depthFormats {
            if type(of: configuration).supportsFrameSemantics(format) {
                configuration.frameSemantics.insert(format)
            }
        }

        guard type(of: configuration).supportsFrameSemantics(.sceneDepth) else {
            assertionFailure("Device does not support sceneDepth (requires LiDAR — iPhone 12 Pro or later).")
            return
        }

        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        isRunning = true
    }

    func pause() {
        session.pause()
        isRunning = false
        nearestDistance = nil
    }

    func toggle() {
        if isRunning {
            pause()
        } else {
            start()
        }
    }

    // MARK: - Depth sampling (same technique as ProximityMonitor)

    private func sampleNearestDistance(from depthData: ARDepthData) -> Float? {
        let depthMap = depthData.depthMap
        let confidenceMap = depthData.confidenceMap

        let width = CVPixelBufferGetWidth(depthMap)
        let height = CVPixelBufferGetHeight(depthMap)

        let regionWidth = Int(CGFloat(width) * sampleRegionWidthFraction)
        let regionHeight = Int(CGFloat(height) * sampleRegionHeightFraction)
        let originX = (width - regionWidth) / 2
        let originY = (height - regionHeight) / 2

        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        if let confidenceMap = confidenceMap {
            CVPixelBufferLockBaseAddress(confidenceMap, .readOnly)
        }
        defer {
            CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
            if let confidenceMap = confidenceMap {
                CVPixelBufferUnlockBaseAddress(confidenceMap, .readOnly)
            }
        }

        guard let depthBase = CVPixelBufferGetBaseAddress(depthMap) else { return nil }
        let depthBytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
        let depthBuffer = depthBase.assumingMemoryBound(to: Float32.self)

        var confidenceBuffer: UnsafeMutablePointer<UInt8>?
        var confidenceBytesPerRow = 0
        if let confidenceMap = confidenceMap,
           let confidenceBase = CVPixelBufferGetBaseAddress(confidenceMap) {
            confidenceBuffer = confidenceBase.assumingMemoryBound(to: UInt8.self)
            confidenceBytesPerRow = CVPixelBufferGetBytesPerRow(confidenceMap)
        }

        var nearest: Float32 = .greatestFiniteMagnitude
        var foundAny = false

        let minY = max(0, originY)
        let maxY = min(height - 1, originY + regionHeight)
        let minX = max(0, originX)
        let maxX = min(width - 1, originX + regionWidth)

        guard minY <= maxY, minX <= maxX else { return nil }

        for y in minY...maxY {
            let depthRowStart = y * (depthBytesPerRow / MemoryLayout<Float32>.size)
            let confidenceRowStart = confidenceBuffer != nil ? y * confidenceBytesPerRow : 0

            for x in minX...maxX {
                if let confidenceBuffer = confidenceBuffer {
                    let confidenceRaw = confidenceBuffer[confidenceRowStart + x]
                    guard let level = ARConfidenceLevel(rawValue: Int(confidenceRaw)),
                          level.rawValue >= minimumConfidence.rawValue else { continue }
                }

                let depthValue = depthBuffer[depthRowStart + x]
                if depthValue.isFinite, depthValue > 0, depthValue < nearest {
                    nearest = depthValue
                    foundAny = true
                }
            }
        }

        return foundAny ? nearest : nil
    }
}

// MARK: - ARSessionDelegate

extension LidarDepthMonitor: ARSessionDelegate {
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        trackingState = frame.camera.trackingState

        guard let depthData = frame.smoothedSceneDepth ?? frame.sceneDepth else {
            DispatchQueue.main.async { self.nearestDistance = nil }
            return
        }

        let distance = sampleNearestDistance(from: depthData)
        DispatchQueue.main.async {
            self.nearestDistance = distance
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        print("ARSession failed: \(error.localizedDescription)")
    }
}
