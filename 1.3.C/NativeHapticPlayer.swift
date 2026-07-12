import CoreHaptics

/// Fires a single sharp haptic pulse per call, intensity scaled by
/// proximity. Called alongside each beep from ProximityAlertController so
/// the user gets synchronized audio + tactile feedback.
final class NativeHapticPlayer {
    private var engine: CHHapticEngine?

    init() {
        setupEngine()
    }

    private func setupEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            print("Device does not support Core Haptics.")
            return
        }

        do {
            engine = try CHHapticEngine()
            engine?.resetHandler = { [weak self] in
                try? self?.engine?.start()
            }
            engine?.stoppedHandler = { reason in
                print("Haptic engine stopped: \(reason)")
            }
            try engine?.start()
        } catch {
            print("Failed to start haptic engine: \(error.localizedDescription)")
        }
    }

    /// Fires one sharp haptic pulse. `intensity` should be 0 (far/weak) to
    /// 1 (close/strong) — a floor is applied so it's never imperceptible.
    func pulse(intensity: Float) {
        guard let engine = engine else { return }

        do {
            let clampedIntensity = max(0.35, min(1.0, intensity))
            let intensityParam = CHHapticEventParameter(parameterID: .hapticIntensity, value: clampedIntensity)
            let sharpnessParam = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.6)

            let event = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [intensityParam, sharpnessParam],
                relativeTime: 0
            )

            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            print("Haptic pulse failed: \(error.localizedDescription)")
        }
    }
}
