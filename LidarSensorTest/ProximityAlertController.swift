import Combine
import ARKit

/// Glue layer: watches ProximityMonitor's distance readings, maps them to a
/// beep interval per the user's SettingsStore thresholds, and drives
/// BeepPlayer accordingly.
final class ProximityAlertController: ObservableObject {

    let monitor = ProximityMonitor()
    let settings: SettingsStore
    private let beepPlayer = BeepPlayer()

    @Published private(set) var currentDistance: Float?
    @Published private(set) var trackingState: ARCamera.TrackingState = .notAvailable
    @Published var isEnabled: Bool = true {
        didSet {
            if !isEnabled { beepPlayer.stop() }
        }
    }

    private var cancellables = Set<AnyCancellable>()

    init(settings: SettingsStore) {
        self.settings = settings

        monitor.$nearestDistance
            .receive(on: DispatchQueue.main)
            .sink { [weak self] distance in
                self?.handle(distance: distance)
            }
            .store(in: &cancellables)

        monitor.$trackingState
            .receive(on: DispatchQueue.main)
            .assign(to: \.trackingState, on: self)
            .store(in: &cancellables)
    }

    func start() {
        monitor.start()
    }

    func pause() {
        monitor.pause()
        beepPlayer.stop()
    }

    private func handle(distance: Float?) {
        currentDistance = distance

        guard isEnabled, let distance = distance else {
            beepPlayer.updateInterval(nil)
            return
        }

        let alertStart = Float(settings.alertStartDistance)
        let critical = Float(settings.criticalDistance)

        guard distance <= alertStart else {
            beepPlayer.updateInterval(nil)
            return
        }

        let interval = mapDistanceToInterval(
            distance: distance,
            alertStart: alertStart,
            critical: critical,
            slowestInterval: settings.slowestBeepInterval,
            fastestInterval: settings.fastestBeepInterval
        )
        beepPlayer.updateInterval(interval)
    }

    /// Linear interpolation between slowest (at alertStart) and fastest
    /// (at or below critical) beep interval. Distances beyond alertStart
    /// are already filtered out by the caller.
    private func mapDistanceToInterval(
        distance: Float,
        alertStart: Float,
        critical: Float,
        slowestInterval: Double,
        fastestInterval: Double
    ) -> TimeInterval {
        guard alertStart > critical else { return fastestInterval }

        let clampedDistance = max(critical, min(alertStart, distance))
        let normalized = (clampedDistance - critical) / (alertStart - critical) // 1 = far (at alertStart), 0 = close (at critical)

        return fastestInterval + Double(normalized) * (slowestInterval - fastestInterval)
    }
}
