import AVFoundation

/// Generates a short beep tone and plays it repeatedly at an adjustable
/// interval, using a dedicated background DispatchSourceTimer rather than a
/// self-rescheduling main-thread loop. This is what makes it feel more
/// responsive than the main-thread asyncAfter approach: the timer just
/// gets its repeat interval updated in place, and only when the change is
/// meaningful (see updateInterval below) — no rescheduling churn, no
/// competing with SwiftUI/WebView/Combine work on the main thread.
final class BeepPlayer {

    var beepFrequencyHz: Double = 1000.0
    var beepDurationSeconds: Double = 0.08

    /// Called every time a beep actually plays (from the background timer
    /// queue, not main) — lets a caller (e.g. ProximityAlertController)
    /// fire a haptic pulse in sync with each beep.
    var onBeep: (() -> Void)?

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var beepBuffer: AVAudioPCMBuffer?

    // Mono, explicit format used for both the engine connection and the
    // generated buffer. Connecting with format: nil lets the node default
    // to the mixer's (often stereo) format, which then crashes when a mono
    // buffer is scheduled since AVAudioPlayerNode requires the scheduled
    // buffer's channel count to match the node's output format exactly.
    private let audioFormat = AVAudioFormat(standardFormatWithSampleRate: 44100.0, channels: 1)!

    private var timer: DispatchSourceTimer?
    private var currentInterval: TimeInterval?
    private let timerQueue = DispatchQueue(label: "com.navvision.beeptimer")

    init() {
        configureAudioSession()
        setupEngine()
        beepBuffer = generateBeepBuffer()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, options: [.mixWithOthers, .duckOthers])
            try session.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error.localizedDescription)")
        }
    }

    private func setupEngine() {
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: audioFormat)
        do {
            try engine.start()
        } catch {
            print("Failed to start audio engine: \(error.localizedDescription)")
        }
    }

    private func generateBeepBuffer() -> AVAudioPCMBuffer? {
        let sampleRate = audioFormat.sampleRate
        let frameCount = AVAudioFrameCount(sampleRate * beepDurationSeconds)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: frameCount) else {
            return nil
        }
        buffer.frameLength = frameCount

        guard let channelData = buffer.floatChannelData?[0] else { return nil }

        let fadeSamples = Int(sampleRate * 0.005) // 5ms fade in/out to avoid clicks

        for frame in 0..<Int(frameCount) {
            let t = Double(frame) / sampleRate
            var sample = Float(sin(2.0 * .pi * beepFrequencyHz * t))

            if frame < fadeSamples {
                sample *= Float(frame) / Float(fadeSamples)
            } else if frame > Int(frameCount) - fadeSamples {
                sample *= Float(Int(frameCount) - frame) / Float(fadeSamples)
            }

            channelData[frame] = sample * 0.5 // headroom
        }

        return buffer
    }

    // MARK: - Playback control

    /// Starts (or updates) repeating beep playback at the given interval.
    /// Pass nil to stop beeping entirely (e.g. nothing within alert range).
    func updateInterval(_ interval: TimeInterval?) {
        guard let interval = interval else {
            stop()
            return
        }

        // Avoid rescheduling the timer for tiny fluctuations — only
        // reschedule if the interval changed meaningfully. This prevents
        // jittery beep rate from small distance noise frame-to-frame, and
        // avoids tearing down/recreating the timer on every single reading.
        if let current = currentInterval, abs(current - interval) < 0.03 {
            return
        }

        currentInterval = interval
        scheduleTimer(interval: interval)
    }

    private func scheduleTimer(interval: TimeInterval) {
        timer?.cancel()

        let newTimer = DispatchSource.makeTimerSource(queue: timerQueue)
        newTimer.schedule(deadline: .now(), repeating: interval)
        newTimer.setEventHandler { [weak self] in
            self?.playBeep()
        }
        newTimer.resume()
        timer = newTimer
    }

    private func playBeep() {
        guard let buffer = beepBuffer else { return }

        // The audio engine can get stopped by session interruptions —
        // e.g. NativeSpeechRecognizer switching the shared AVAudioSession
        // to .record while listening for a spoken destination. Restarting
        // it here (checked on every beep, since this runs on a repeating
        // timer) means beeping self-heals within one interval of the
        // session becoming available again, without needing to listen for
        // interruption notifications separately.
        if !engine.isRunning {
            try? engine.start()
        }

        playerNode.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !playerNode.isPlaying {
            playerNode.play()
        }
        onBeep?()
    }

    func stop() {
        timer?.cancel()
        timer = nil
        currentInterval = nil
        playerNode.stop()
    }
}
