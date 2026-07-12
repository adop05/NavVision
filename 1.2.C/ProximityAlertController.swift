import Combine
import Foundation

/// Drives native beep + haptic feedback from LiDAR distance readings.
/// Beeping starts at `startDistance`, reaching the fastest rate at/below
/// `criticalDistance`. Runs independently of the web view — this replaces
/// the JS SonarSynthesizer's audio entirely, since Web Audio in a WKWebView
/// requires unlocking via a genuine user touch and native bridge-driven
/// updates don't qualify as one.
final class ProximityAlertController: ObservableObject {

    let startDistance: Float = 1.0        // beeping starts within this range
    let criticalDistance: Float = 0.30    // fastest beep at/below this distance
    let slowestInterval: TimeInterval = 1.0   // seconds, at startDistance
    let fastestInterval: TimeInterval = 0.08  // seconds, at/below criticalDistance

    @Published private(set) var isMuted: Bool = false

    private let beepPlayer = NativeBeepPlayer()
    private let hapticPlayer = NativeHapticPlayer()

    private var latestDistance: Float?
    private var isTicking = false
    private var cancellables = Set<AnyCancellable>()

    init(depthMonitor: LidarDepthMonitor) {
        depthMonitor.$nearestDistance
            .receive(on: DispatchQueue.main)
            .sink { [weak self] distance in
                self?.handle(distance: distance)
            }
            .store(in: &cancellables)
    }

    /// Called from the "Distance Alert" mute button via the JS bridge, so
    /// muting in the web UI silences native audio/haptics too.
    func setMuted(_ muted: Bool) {
        isMuted = muted
        if muted {
            isTicking = false
        } else if let distance = latestDistance, distance < startDistance {
            startTicking()
        }
    }

    private func handle(distance: Float?) {
        latestDistance = distance
        guard !isMuted else { return }

        if let distance = distance, distance < startDistance {
            if !isTicking {
                startTicking()
            }
            // If already ticking, the in-flight tick() will pick up this
            // new distance value on its next scheduled firing — no need
            // to restart the loop on every single reading.
        } else {
            isTicking = false
        }
    }

    private func startTicking() {
        isTicking = true
        tick()
    }

    private func tick() {
        guard isTicking, !isMuted else { return }
        guard let distance = latestDistance, distance < startDistance else {
            isTicking = false
            return
        }

        let clamped = max(criticalDistance, min(startDistance, distance))
        let normalized = (clamped - criticalDistance) / (startDistance - criticalDistance) // 0 close, 1 far
        let interval = fastestInterval + Double(normalized) * (slowestInterval - fastestInterval)
        let intensity = 1.0 - normalized // 1 close, 0 far

        beepPlayer.playBeep()
        hapticPlayer.pulse(intensity: intensity)

        DispatchQueue.main.asyncAfter(deadline: .now() + interval) { [weak self] in
            self?.tick()
        }
    }
}
