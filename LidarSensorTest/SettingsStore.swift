import Foundation
import Combine

/// User-adjustable alert distance settings, persisted across app launches.
final class SettingsStore: ObservableObject {

    /// Distance (meters) at which beeping starts. Nothing closer than this
    /// and beeping is silent. This is the main "minimum distance required
    /// to start alerting" control requested — adjustable via SettingsView.
    @Published var alertStartDistance: Double {
        didSet { UserDefaults.standard.set(alertStartDistance, forKey: Keys.alertStartDistance) }
    }

    /// Distance (meters) representing "maximum urgency" — at or below this,
    /// beeping is at its fastest rate. Below this, LiDAR reliability and
    /// human reaction time both get less meaningful, so further increases
    /// in urgency don't add much.
    @Published var criticalDistance: Double {
        didSet { UserDefaults.standard.set(criticalDistance, forKey: Keys.criticalDistance) }
    }

    /// Slowest beep interval (seconds), used right at alertStartDistance.
    @Published var slowestBeepInterval: Double {
        didSet { UserDefaults.standard.set(slowestBeepInterval, forKey: Keys.slowestBeepInterval) }
    }

    /// Fastest beep interval (seconds), used at/below criticalDistance.
    @Published var fastestBeepInterval: Double {
        didSet { UserDefaults.standard.set(fastestBeepInterval, forKey: Keys.fastestBeepInterval) }
    }

    private enum Keys {
        static let alertStartDistance = "alertStartDistance"
        static let criticalDistance = "criticalDistance"
        static let slowestBeepInterval = "slowestBeepInterval"
        static let fastestBeepInterval = "fastestBeepInterval"
    }

    init() {
        let defaults = UserDefaults.standard
        self.alertStartDistance = defaults.object(forKey: Keys.alertStartDistance) as? Double ?? 3.0
        self.criticalDistance = defaults.object(forKey: Keys.criticalDistance) as? Double ?? 0.5
        self.slowestBeepInterval = defaults.object(forKey: Keys.slowestBeepInterval) as? Double ?? 1.0
        self.fastestBeepInterval = defaults.object(forKey: Keys.fastestBeepInterval) as? Double ?? 0.12
    }

    // MARK: - Bounds

    /// Reasonable UI bounds — LiDAR is reliable roughly up to ~5m outdoors
    /// (often less in bright sun), so alertStartDistance beyond that isn't
    /// meaningful to expose in the UI.
    let alertStartDistanceRange: ClosedRange<Double> = 0.5...5.0
    let criticalDistanceRange: ClosedRange<Double> = 0.2...2.0
}
