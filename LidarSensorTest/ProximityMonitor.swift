import ARKit
import Combine

/// Runs an ARSession with sceneDepth and continuously samples a center
/// region of the depth map — representing the path directly ahead of the
/// user — to find the nearest confident distance.
///
/// This deliberately does NOT do object detection/classification. It's a
/// depth-only proximity sensor: fast, simple, and works on anything in the
/// path regardless of whether it's a trained object class.
final class ProximityMonitor: NSObject, ObservableObject {

    @Published private(set) var nearestDistance: Float?
    @Published private(set) var trackingState: ARCamera.TrackingState = .notAvailable

    let session = ARSession()

    /// Fraction of the depth map's width/height to sample, centered in the
    /// frame. 0.5 means the middle 50% of the frame — narrow enough to
    /// approximate "what's in the walking path ahead" rather than
    /// alerting on things off to the side that the user isn't walking
    /// toward. Tune this once you've tested real walks.
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
    }

    func pause() {
        session.pause()
    }

    // MARK: - Depth sampling

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
        confidenceMap.map { CVPixelBufferLockBaseAddress($0, .readOnly) }
        defer {
            CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
            confidenceMap.map { CVPixelBufferUnlockBaseAddress($0, .readOnly) }
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

extension ProximityMonitor: ARSessionDelegate {
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
