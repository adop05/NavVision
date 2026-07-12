import ARKit

/// Converts ARCamera.TrackingState into a plain string for passing to JS,
/// since the enum itself can't be serialized directly.
extension ARCamera.TrackingState {
    var bridgeDescription: String {
        switch self {
        case .normal:
            return "normal"
        case .notAvailable:
            return "notAvailable"
        case .limited(let reason):
            switch reason {
            case .excessiveMotion: return "limitedExcessiveMotion"
            case .insufficientFeatures: return "limitedInsufficientFeatures"
            case .initializing: return "limitedInitializing"
            case .relocalizing: return "limitedRelocalizing"
            @unknown default: return "limitedOther"
            }
        }
    }
}
