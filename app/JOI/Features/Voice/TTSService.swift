import AVFoundation
import Foundation
import os

@MainActor
final class TTSService: NSObject {
    enum SpeakError: Error {
        case canceled
    }

    static let shared = TTSService()

    private let synth = AVSpeechSynthesizer()
    private var speakContinuation: CheckedContinuation<Void, Error>?
    private var currentUtterance: AVSpeechUtterance?
    private var currentToken = UUID()
    private var watchdog: Task<Void, Never>?
    private let log = Logger(subsystem: "com.joi.app", category: "TTSService")

    /// Tracks sentences spoken so far during `speakStream()` for interruption memory.
    private(set) var spokenSentences: [String] = []

    struct VoiceInfo: Identifiable {
        let id: String
        let name: String
        let language: String
        let quality: String
    }

    var isSpeaking: Bool { synth.isSpeaking }

    override private init() {
        super.init()
        synth.delegate = self
    }

    /// Returns English voices sorted by quality (premium first), then name
    static func availableVoices() -> [VoiceInfo] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }
            .sorted { lhs, rhs in
                if lhs.quality != rhs.quality {
                    return lhs.quality.rawValue > rhs.quality.rawValue
                }
                return lhs.name < rhs.name
            }
            .map { voice in
                let quality: String
                switch voice.quality {
                case .premium: quality = "Premium"
                case .enhanced: quality = "Enhanced"
                default: quality = "Default"
                }
                return VoiceInfo(
                    id: voice.identifier,
                    name: voice.name,
                    language: voice.language,
                    quality: quality)
            }
    }

    /// Speak a short preview sample with the given voice
    func preview(voiceId: String) {
        stop()
        let utterance = AVSpeechUtterance(string: "Hello, I'm JOI. How can I help you today?")
        utterance.voice = AVSpeechSynthesisVoice(identifier: voiceId)
        synth.speak(utterance)
    }

    func stop() {
        currentToken = UUID()
        watchdog?.cancel()
        watchdog = nil
        synth.stopSpeaking(at: .immediate)
        finishCurrent(with: SpeakError.canceled)
    }

    /// Returns the text that was actually spoken before stop() was called.
    var spokenText: String {
        spokenSentences.joined(separator: " ")
    }

    func speak(text: String, language: String? = nil) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        stop()
        spokenSentences = []
        let token = UUID()
        currentToken = token

        let utterance = AVSpeechUtterance(string: trimmed)
        configureVoice(for: utterance, language: language)
        currentUtterance = utterance

        startWatchdog(for: trimmed, token: token)

        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { cont in
                self.speakContinuation = cont
                self.synth.speak(utterance)
            }
        }, onCancel: {
            Task { @MainActor in
                self.stop()
            }
        })

        if currentToken != token {
            throw SpeakError.canceled
        }
        spokenSentences = [trimmed]
    }

    /// Speak sentences from an AsyncStream one at a time.
    /// Returns the text that was actually spoken (for interruption tracking).
    func speakStream(_ sentences: AsyncStream<String>) async throws -> String {
        stop()
        spokenSentences = []
        let token = UUID()
        currentToken = token
        let dlog = VoiceDebugLog.shared

        for await sentence in sentences {
            guard currentToken == token else {
                dlog.log("tts", "token mismatch — stopping stream")
                break
            }

            let trimmed = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            log.info("TTS sentence: '\(trimmed.prefix(60), privacy: .public)'")
            dlog.log("tts", "speaking: '\(trimmed.prefix(60))' (\(trimmed.count) chars)")

            let utterance = AVSpeechUtterance(string: trimmed)
            configureVoice(for: utterance)
            currentUtterance = utterance

            startWatchdog(for: trimmed, token: token)

            do {
                try await withTaskCancellationHandler(operation: {
                    try await withCheckedThrowingContinuation { cont in
                        self.speakContinuation = cont
                        self.synth.speak(utterance)
                    }
                }, onCancel: {
                    Task { @MainActor in
                        self.stop()
                    }
                })
            } catch is SpeakError {
                dlog.log("tts", "cancelled during speak")
                break
            } catch {
                log.warning("TTS error on sentence, continuing: \(error.localizedDescription)")
                dlog.log("tts", "error: \(error.localizedDescription)")
                continue
            }

            guard currentToken == token else {
                dlog.log("tts", "token mismatch after speak — stopping stream")
                break
            }
            spokenSentences.append(trimmed)
            dlog.log("tts", "spoke OK: '\(trimmed.prefix(40))' (total spoken: \(spokenText.count) chars)")
        }

        return spokenText
    }

    // MARK: - Private

    private func configureVoice(for utterance: AVSpeechUtterance, language: String? = nil) {
        let storedVoiceId = UserDefaults.standard.string(forKey: "selectedVoiceId")
        if let voiceId = storedVoiceId, let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            utterance.voice = voice
        } else if let language, let voice = AVSpeechSynthesisVoice(language: language) {
            utterance.voice = voice
        }
    }

    private func startWatchdog(for text: String, token: UUID) {
        let estimatedSeconds = max(3.0, min(180.0, Double(text.count) * 0.08))
        watchdog?.cancel()
        watchdog = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(estimatedSeconds * 1_000_000_000))
            if Task.isCancelled { return }
            guard self.currentToken == token else { return }
            if self.synth.isSpeaking {
                self.synth.stopSpeaking(at: .immediate)
            }
            self.finishCurrent(
                with: NSError(domain: "TTSService", code: 408, userInfo: [
                    NSLocalizedDescriptionKey: "TTS timed out after \(estimatedSeconds)s",
                ]))
        }
    }

    private func handleFinish(error: Error?) {
        guard currentUtterance != nil else { return }
        watchdog?.cancel()
        watchdog = nil
        finishCurrent(with: error)
    }

    private func finishCurrent(with error: Error?) {
        currentUtterance = nil
        let cont = speakContinuation
        speakContinuation = nil
        if let error {
            cont?.resume(throwing: error)
        } else {
            cont?.resume(returning: ())
        }
    }
}

extension TTSService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance)
    {
        Task { @MainActor in self.handleFinish(error: nil) }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance)
    {
        Task { @MainActor in self.handleFinish(error: SpeakError.canceled) }
    }
}
