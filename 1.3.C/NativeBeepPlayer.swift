import AVFoundation

/// Generates a short beep tone natively via AVAudioEngine. Unlike Web Audio
/// in a WKWebView, this doesn't require unlocking via a genuine user
/// touch/click — native AVAudioSession playback isn't subject to the same
/// autoplay restrictions, which is the whole reason this moved out of
/// JavaScript.
final class NativeBeepPlayer {

    var beepFrequencyHz: Double = 900.0
    var beepDurationSeconds: Double = 0.05

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var beepBuffer: AVAudioPCMBuffer?

    // Mono, explicit format used for both the engine connection and the
    // generated buffer — connecting with format: nil lets the node default
    // to the mixer's (often stereo) format, which then crashes when a mono
    // buffer is scheduled since AVAudioPlayerNode requires matching channel
    // counts.
    private let audioFormat = AVAudioFormat(standardFormatWithSampleRate: 44100.0, channels: 1)!

    init() {
        configureAudioSession()
        setupEngine()
        beepBuffer = generateBeepBuffer()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            // .mixWithOthers so this doesn't interrupt Mapbox/TTS or any
            // other audio; .duckOthers so the beep is still clearly audible
            // over background audio without fully silencing it.
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

            channelData[frame] = sample * 0.6
        }

        return buffer
    }

    func playBeep() {
        guard let buffer = beepBuffer else { return }

        if !engine.isRunning {
            try? engine.start()
        }

        playerNode.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !playerNode.isPlaying {
            playerNode.play()
        }
    }
}
