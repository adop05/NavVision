import AVFoundation

/// Generates a short beep tone and plays it repeatedly at an adjustable
/// interval. Shorter interval = faster beeping = closer object, similar to
/// a car's parking-sensor proximity alert.
///
/// Note: this changes beep RATE (how often it beeps), not pitch. Rate
/// changes are generally easier to perceive unambiguously at a glance/glance
/// -free than pitch changes, which is why parking sensors use this pattern.
/// If you'd prefer pitch (frequency of the tone itself) to rise instead of
/// or in addition to rate, `beepFrequencyHz` below is the knob for that —
/// easy to wire up to distance too if you want to experiment.
final class BeepPlayer {

    /// Tone pitch in Hz. Fixed for now; see note above if you want this to
    /// scale with distance too.
    var beepFrequencyHz: Double = 1000.0
    var beepDurationSeconds: Double = 0.08

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var beepBuffer: AVAudioPCMBuffer?

    private var timer: DispatchSourceTimer?
    private var currentInterval: TimeInterval?
    private let timerQueue = DispatchQueue(label: "com.proximitybeeper.beeptimer")

    init() {
        configureAudioSession()
        setupEngine()
        beepBuffer = generateBeepBuffer()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            // .ambient would duck under other audio; for a safety alert we
            // want it audible even if the user is playing music/navigation
            // audio, so mixWithOthers + playback category.
            try session.setCategory(.playback, options: [.mixWithOthers, .duckOthers])
            try session.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error.localizedDescription)")
        }
    }

    private func setupEngine() {
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: nil)
        do {
            try engine.start()
        } catch {
            print("Failed to start audio engine: \(error.localizedDescription)")
        }
    }

    private func generateBeepBuffer() -> AVAudioPCMBuffer? {
        let sampleRate = 44100.0
        let frameCount = AVAudioFrameCount(sampleRate * beepDurationSeconds)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }
        buffer.frameLength = frameCount

        guard let channelData = buffer.floatChannelData?[0] else { return nil }

        let fadeSamples = Int(sampleRate * 0.005) // 5ms fade in/out to avoid clicks

        for frame in 0..<Int(frameCount) {
            let t = Double(frame) / sampleRate
            var sample = Float(sin(2.0 * .pi * beepFrequencyHz * t))

            // Fade in/out envelope
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
        // jittery beep rate from small distance noise frame-to-frame.
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
        playerNode.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !playerNode.isPlaying {
            playerNode.play()
        }
    }

    func stop() {
        timer?.cancel()
        timer = nil
        currentInterval = nil
        playerNode.stop()
    }
}
