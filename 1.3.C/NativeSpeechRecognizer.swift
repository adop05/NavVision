import Speech
import AVFoundation

/// Wraps Apple's Speech framework (SFSpeechRecognizer) to provide
/// speech-to-text for the "Speak Destination" feature. This replaces the
/// web's window.SpeechRecognition/webkitSpeechRecognition, which doesn't
/// exist in WKWebView/Safari at all — Web Speech *recognition* (as opposed
/// to speechSynthesis, used elsewhere for TTS output) is a Chrome-only API.
final class NativeSpeechRecognizer: NSObject, ObservableObject {

    @Published private(set) var isListening = false

    /// Called with the final transcript once recognition completes.
    var onResult: ((String) -> Void)?
    /// Called with a human-readable error message if recognition fails,
    /// is denied, or times out with no speech detected.
    var onError: ((String) -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?

    /// How long to wait for a final result before giving up and reporting
    /// "no speech detected" — SFSpeechRecognitionRequest has no built-in
    /// equivalent to the Web Speech API's onspeechend/no-speech timeout, so
    /// this is a simple manual stand-in.
    private let silenceTimeout: TimeInterval = 6.0

    func startListening() {
        guard !isListening else { return }

        requestAuthorization { [weak self] authorized in
            guard let self = self else { return }
            guard authorized else {
                self.onError?("Speech recognition permission denied. Enable it in Settings.")
                return
            }
            self.beginRecognition()
        }
    }

    func stopListening() {
        silenceTimer?.invalidate()
        silenceTimer = nil

        guard isListening || audioEngine.isRunning else { return }

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        isListening = false
    }

    private func requestAuthorization(completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            DispatchQueue.main.async {
                completion(authStatus == .authorized)
            }
        }
    }

    private func beginRecognition() {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            onError?("Speech recognizer unavailable on this device.")
            return
        }

        stopListening() // clear any stale session first

        do {
            let audioSession = AVAudioSession.sharedInstance()
            // .duckOthers so this doesn't fully silence Mapbox/other audio
            // while listening.
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = false
            self.request = request

            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            inputNode.removeTap(onBus: 0) // safety, in case a prior tap wasn't cleaned up
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                request.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()
            isListening = true

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self = self else { return }

                if let result = result, result.isFinal {
                    let transcript = result.bestTranscription.formattedString
                    self.stopListening()
                    self.onResult?(transcript)
                }

                if let error = error {
                    self.stopListening()
                    self.onError?(error.localizedDescription)
                }
            }

            scheduleSilenceTimeout()
        } catch {
            isListening = false
            onError?("Failed to start listening: \(error.localizedDescription)")
        }
    }

    private func scheduleSilenceTimeout() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
            guard let self = self, self.isListening else { return }
            self.stopListening()
            self.onError?("Didn't catch that. Tap and try again.")
        }
    }
}
