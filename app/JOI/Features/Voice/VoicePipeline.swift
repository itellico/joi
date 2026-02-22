import Foundation
import Observation
import os

@MainActor
@Observable
final class VoicePipeline {
    enum State: String {
        case idle
        case listeningForWake
        case capturing
        case processing
        case speaking
        case error
    }

    private(set) var state: State = .idle
    private(set) var errorMessage: String?
    private(set) var isMuted = false
    private(set) var currentEmotion: String?
    var statusText: String { stateStatusText }
    var micLevel: Double {
        if isMuted { return 0 }
        switch state {
        case .listeningForWake: return wakeWordService.micLevel
        case .capturing: return speechService.micLevel
        default: return 0
        }
    }
    var isActive: Bool { state != .idle && state != .error }

    // Debug accessors
    var debugWakeWordEnabled: Bool { wakeWordService.isEnabled }
    var debugWakeWordListening: Bool { wakeWordService.isListening }
    var debugSpeechListening: Bool { speechService.isListening }
    var debugWsState: String { webSocket?.state.debugDescription ?? "nil" }
    var debugWsError: String? { webSocket?.lastError }
    var debugLastEvent: String { lastDebugEvent }
    var debugStreamDone: Bool { _streamDone }
    var debugSentenceCount: Int { sentenceBuffer.sentenceCount }
    var debugSpokenCount: Int { ttsService.spokenSentences.count }

    private let speechService = SpeechService()
    private let wakeWordService = WakeWordService()
    private let ttsService = TTSService.shared
    private let sentenceBuffer = SentenceBuffer()
    private let log = Logger(subsystem: "com.joi.app", category: "VoicePipeline")
    private let dlog = VoiceDebugLog.shared

    private var webSocket: WebSocketClient?
    private var router: FrameRouter?
    private var silenceTask: Task<Void, Never>?
    private var lastHeard: Date?
    private let silenceWindow: TimeInterval = 1.5
    private(set) var capturedTranscript = ""
    private var responseWaitTask: Task<Void, Never>?
    private var streamingTask: Task<Void, Never>?
    private var sentenceContinuation: AsyncStream<String>.Continuation?

    // Interruption tracking
    private var currentMessageId: String?

    // Proactive speaking — disabled by default, can be enabled
    private var idleTimer: Task<Void, Never>?
    var proactiveEnabled = false
    var proactiveTimeout: TimeInterval = 120.0

    /// Called when a voice message is sent — allows ChatViewModel to show the user bubble
    var onVoiceMessageSent: (@MainActor (String) -> Void)?

    // Debug state
    private var lastDebugEvent = "none"
    private var _streamDone = false

    private func setEvent(_ event: String) {
        lastDebugEvent = event
        dlog.log("pipeline", event)
    }

    func attach(webSocket: WebSocketClient, router: FrameRouter) {
        self.webSocket = webSocket
        self.router = router
        dlog.log("pipeline", "attached ws=\(webSocket.state.debugDescription)")

        wakeWordService.onCommand = { [weak self] command in
            guard let self else { return }
            await self.handleWakeCommand(command)
        }

        wakeWordService.onError = { [weak self] message in
            guard let self else { return }
            self.state = .error
            self.errorMessage = message
            self.setEvent("wakeError: \(message)")
            self.log.error("WakeWordService error: \(message)")

            // Auto-retry after 3s if not muted
            if !self.isMuted {
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    guard let self, self.state == .error, !self.isMuted else { return }
                    self.dlog.log("pipeline", "auto-retry after error")
                    await self.start()
                }
            }
        }
    }

    func start() async {
        guard state == .idle || state == .error else {
            log.info("start() skipped — state=\(self.state.rawValue, privacy: .public)")
            dlog.log("pipeline", "start() skipped — state=\(state.rawValue)")
            return
        }
        log.info("Starting voice pipeline...")
        setEvent("starting")
        errorMessage = nil
        state = .listeningForWake
        wakeWordService.setEnabled(true)

        // Poll for startup success — permission checks can take 3-4s
        Task { @MainActor [weak self] in
            for attempt in 1...10 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, self.state == .listeningForWake else { return }
                if self.wakeWordService.isListening {
                    self.log.info("Voice pipeline active after \(attempt)s")
                    self.setEvent("ready (\(attempt)s)")
                    return
                }
                self.dlog.log("pipeline", "startup poll \(attempt)/10 — not yet listening")
            }
            // 10s passed without success
            guard let self, self.state == .listeningForWake else { return }
            if !self.wakeWordService.isListening {
                self.log.error("WakeWordService failed to start within 10s: \(self.wakeWordService.statusText, privacy: .public)")
                self.state = .error
                self.errorMessage = self.wakeWordService.statusText
                self.setEvent("startFailed: \(self.wakeWordService.statusText)")
            }
        }
    }

    func stop() {
        log.info("Stopping voice pipeline")
        setEvent("stopped")
        state = .idle
        errorMessage = nil
        currentEmotion = nil
        silenceTask?.cancel()
        silenceTask = nil
        responseWaitTask?.cancel()
        responseWaitTask = nil
        streamingTask?.cancel()
        streamingTask = nil
        sentenceContinuation?.finish()
        sentenceContinuation = nil
        idleTimer?.cancel()
        idleTimer = nil
        wakeWordService.stop()
        speechService.stop()
        ttsService.stop()
        sentenceBuffer.reset()
    }

    func interruptSpeaking() {
        guard state == .speaking else { return }
        log.info("Interrupting speech")
        setEvent("interrupt (spoken=\(ttsService.spokenSentences.count) sents)")

        // Capture what was spoken before stopping
        let spoken = ttsService.spokenText
        let messageId = currentMessageId

        ttsService.stop()
        streamingTask?.cancel()
        streamingTask = nil
        sentenceContinuation?.finish()
        sentenceContinuation = nil
        sentenceBuffer.reset()

        // Send interrupt frame to gateway so it knows what was spoken
        // Skip for proactive messages (no real DB messageId)
        if !spoken.isEmpty, let messageId, messageId != "proactive" {
            log.info("Sending chat.interrupt — spoken \(spoken.count) chars")
            dlog.log("pipeline", "chat.interrupt → \(spoken.count) chars, msgId=\(messageId)")
            let interruptData: [String: String] = [
                "spokenText": spoken,
                "messageId": messageId,
            ]
            webSocket?.send(type: .chatInterrupt, data: interruptData)
        }

        returnToListening()
    }

    func mute() {
        isMuted = true
        setEvent("muted")
        idleTimer?.cancel()
        idleTimer = nil
        wakeWordService.setSuppressed(true)
        speechService.stop()
        // If we are currently speaking (or queued to speak), cut output immediately.
        ttsService.stop()
        if state == .speaking {
            returnToListening()
        }
    }

    func unmute() {
        isMuted = false
        setEvent("unmuted")
        if state == .listeningForWake {
            wakeWordService.setSuppressed(false)
        } else if state == .idle || state == .error {
            Task { await start() }
        }
    }

    /// Tap-to-talk: skip wake word, go straight to capturing
    func tapToTalk() async {
        guard state == .listeningForWake || state == .idle || state == .error else {
            log.info("tapToTalk ignored — state=\(self.state.rawValue, privacy: .public)")
            setEvent("tapIgnored(\(state.rawValue))")
            return
        }
        log.info("Tap-to-talk activated")
        setEvent("tapToTalk")
        await handleWakeCommand("")
    }

    // MARK: - State Machine

    private func handleWakeCommand(_ command: String) async {
        guard state == .listeningForWake || state == .idle || state == .error else {
            log.warning("handleWakeCommand ignored — state=\(self.state.rawValue, privacy: .public)")
            dlog.log("pipeline", "wakeCmd ignored — state=\(state.rawValue)")
            return
        }

        log.info("Wake command received: '\(command, privacy: .public)'")
        dlog.log("pipeline", "wakeCmd: '\(command.prefix(50))'")

        // Cancel idle timer — user is active
        idleTimer?.cancel()
        idleTimer = nil

        // Suspend wake word listening
        wakeWordService.setSuppressed(true)
        capturedTranscript = LocalVocabularyStore.apply(to: command)

        if command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Wake word only — start capture for the actual command
            state = .capturing
            dlog.log("pipeline", "→ capturing (waiting 300ms for audio release)")

            // Wait for audio hardware to release from wake word service
            try? await Task.sleep(nanoseconds: 300_000_000)

            // Retry speech service start up to 3 times
            var started = false
            for attempt in 1...3 {
                dlog.log("speech", "start attempt \(attempt)")
                started = await speechService.start()
                if started {
                    dlog.log("speech", "started OK on attempt \(attempt)")
                    break
                }
                dlog.log("speech", "attempt \(attempt) failed: \(speechService.statusText)")
                log.warning("SpeechService start attempt \(attempt) failed: \(self.speechService.statusText, privacy: .public)")
                if attempt < 3 {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                }
            }

            guard started else {
                log.error("SpeechService failed to start after 3 attempts")
                state = .error
                errorMessage = "Couldn't start listening — \(speechService.statusText)"
                setEvent("speechFailed: \(speechService.statusText)")
                wakeWordService.setSuppressed(false)
                return
            }

            log.info("SpeechService started, listening for command...")
            setEvent("capturing")

            speechService.onTranscript = { [weak self] text, isFinal in
                guard let self, self.state == .capturing else { return }
                self.capturedTranscript = LocalVocabularyStore.apply(to: text)
                self.lastHeard = Date()
                self.dlog.log("speech", "transcript(\(isFinal ? "final" : "partial")): '\(text.prefix(60))'")
                if isFinal {
                    self.finalizeCaptureAndSend()
                }
            }

            startSilenceMonitor()
        } else {
            // Wake word + command already captured
            dlog.log("pipeline", "wake+cmd — sending directly")
            await sendToGateway(LocalVocabularyStore.apply(to: command))
        }
    }

    private func startSilenceMonitor() {
        lastHeard = Date()
        silenceTask?.cancel()
        dlog.log("pipeline", "silence monitor started (\(silenceWindow)s window)")
        silenceTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000) // Check every 100ms for snappier response
                guard let self else { break }
                guard self.state == .capturing else { break }
                guard let lastHeard = self.lastHeard else { continue }
                let elapsed = Date().timeIntervalSince(lastHeard)
                if elapsed >= self.silenceWindow {
                    self.dlog.log("pipeline", "silence detected (\(String(format: "%.1f", elapsed))s)")
                    self.finalizeCaptureAndSend()
                    break
                }
            }
        }
    }

    private func finalizeCaptureAndSend() {
        // Guard: only finalize while actively capturing.
        // After stop(), the recognition task fires a final callback with empty text —
        // without this guard, that late callback would overwrite the real transcript.
        guard state == .capturing else {
            dlog.log("pipeline", "finalizeCaptureAndSend ignored — state=\(state.rawValue)")
            return
        }

        // Clear callback immediately to prevent any further late callbacks
        speechService.onTranscript = nil
        silenceTask?.cancel()
        silenceTask = nil

        let transcript = capturedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else {
            log.info("Empty capture after silence, returning to listening")
            setEvent("emptyCapture")
            dlog.log("pipeline", "empty capture — transcript was: '\(capturedTranscript)' (raw \(capturedTranscript.count) chars)")
            state = .listeningForWake
            speechService.stop()
            wakeWordService.setSuppressed(false)
            return
        }

        log.info("Capture finalized: '\(transcript, privacy: .public)'")
        setEvent("finalized: '\(transcript.prefix(30))'")
        speechService.stop()

        Task {
            await sendToGateway(transcript)
        }
    }

    private func sendToGateway(_ text: String) async {
        // Check WebSocket is connected BEFORE trying to send
        guard let ws = webSocket, ws.isConnected else {
            let wsState = webSocket?.state.debugDescription ?? "nil"
            log.error("Cannot send — WebSocket not connected (state=\(wsState, privacy: .public))")
            setEvent("sendFailed: ws=\(wsState)")
            state = .error
            errorMessage = "Not connected to gateway"
            wakeWordService.setSuppressed(false)
            return
        }

        state = .processing
        log.info("Sending to gateway: '\(text, privacy: .public)'")
        dlog.log("pipeline", "→ chat.send '\(text.prefix(60))'")

        // Notify ChatViewModel to show user bubble
        onVoiceMessageSent?(text)

        let payload = ChatSendData(content: text)
        ws.send(type: .chatSend, data: payload)

        // Handle streaming response with sentence-level TTS
        await handleStreamingResponse(timeout: 60.0)
    }

    // MARK: - Streaming Response Handler

    private func handleStreamingResponse(timeout: TimeInterval) async {
        dlog.log("pipeline", "handleStreamingResponse started (timeout=\(Int(timeout))s)")

        // Save existing callbacks so ChatViewModel still works after we're done
        let previousChatStream = router?.onChatStream
        let previousChatDone = router?.onChatDone
        let previousChatError = router?.onChatError

        // Create an AsyncStream of sentences for TTS
        let (sentenceStream, continuation) = AsyncStream<String>.makeStream()
        self.sentenceContinuation = continuation

        // Set up sentence buffer to feed the stream
        sentenceBuffer.reset()
        currentEmotion = nil
        currentMessageId = nil
        _streamDone = false

        sentenceBuffer.onSentence = { [weak self] sentence in
            guard let self else { return }
            // Transition to speaking on first sentence
            if self.state == .processing {
                self.state = .speaking
                self.setEvent("firstSentence")
            }
            self.dlog.log("buffer", "sentence #\(self.sentenceBuffer.sentenceCount): '\(sentence.prefix(50))'")
            // Update emotion from buffer
            if let emotion = self.sentenceBuffer.currentEmotion {
                self.currentEmotion = emotion
                self.dlog.log("buffer", "emotion: \(emotion)")
            }
            continuation.yield(sentence)
        }

        var streamDone = false

        // Subscribe to token deltas
        var streamChars = 0
        router?.onChatStream = { [weak self] data in
            guard let self, !streamDone else { return }
            streamChars += data.delta.count
            self.lastDebugEvent = "stream(\(streamChars)ch)"
            self.sentenceBuffer.append(data.delta)
            previousChatStream?(data)
        }

        // Subscribe to chat.done
        router?.onChatDone = { [weak self] data in
            guard let self, !streamDone else { return }
            streamDone = true
            self._streamDone = true
            self.currentMessageId = data.messageId
            self.setEvent("done(\(data.content.count)ch)")
            self.dlog.log("pipeline", "chat.done — \(data.content.count) chars, msgId=\(data.messageId)")

            // Flush remaining text in buffer
            let flushed = self.sentenceBuffer.flush()
            if let flushed {
                self.dlog.log("buffer", "flushed: '\(flushed.prefix(50))'")
            }
            if let emotion = self.sentenceBuffer.currentEmotion {
                self.currentEmotion = emotion
            }
            continuation.finish()

            // Restore callbacks and forward
            self.router?.onChatStream = previousChatStream
            self.router?.onChatDone = previousChatDone
            self.router?.onChatError = previousChatError
            previousChatDone?(data)
        }

        // Subscribe to errors
        router?.onChatError = { [weak self] error in
            guard let self, !streamDone else { return }
            streamDone = true
            self._streamDone = true
            self.setEvent("chatError")
            self.dlog.log("pipeline", "chat.error: \(error)")
            continuation.finish()

            self.router?.onChatStream = previousChatStream
            self.router?.onChatDone = previousChatDone
            self.router?.onChatError = previousChatError
            previousChatError?(error)
        }

        // Timeout
        responseWaitTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard let self, !streamDone else { return }
            streamDone = true
            self._streamDone = true
            self.setEvent("timeout(\(Int(timeout))s)")
            self.dlog.log("pipeline", "TIMEOUT after \(Int(timeout))s — streamChars=\(streamChars)")
            continuation.finish()

            self.router?.onChatStream = previousChatStream
            self.router?.onChatDone = previousChatDone
            self.router?.onChatError = previousChatError
            previousChatError?("Voice response timeout")
        }

        // Speak sentences as they arrive
        streamingTask = Task { [weak self] in
            guard let self else { return }
            self.dlog.log("tts", "speakStream started")
            do {
                let spoken = try await self.ttsService.speakStream(sentenceStream)
                self.setEvent("ttsComplete")
                self.dlog.log("tts", "speakStream complete — spoke \(spoken.count) chars")
            } catch {
                self.setEvent("ttsError")
                self.dlog.log("tts", "speakStream error: \(error.localizedDescription)")
            }

            // Return to listening after TTS completes
            self.responseWaitTask?.cancel()
            self.responseWaitTask = nil
            self.returnToListening()
        }
    }

    // MARK: - Proactive Speaking

    private func startIdleTimer() {
        guard proactiveEnabled else { return }
        idleTimer?.cancel()
        idleTimer = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(self.proactiveTimeout * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard self.state == .listeningForWake, !self.isMuted else { return }
            guard self.webSocket?.isConnected == true else { return }
            self.log.info("Idle timeout — sending proactive prompt")
            self.setEvent("proactive")
            self.sendProactive()
        }
    }

    private func sendProactive() {
        guard state == .listeningForWake, !isMuted else { return }
        guard webSocket?.isConnected == true else { return }

        state = .processing
        wakeWordService.setSuppressed(true)

        var payload = ChatSendData(content: "[proactive]")
        payload.proactive = true
        webSocket?.send(type: .chatSend, data: payload)

        Task {
            await handleStreamingResponse(timeout: 30.0)
        }
    }

    // MARK: - Helpers

    private func returnToListening() {
        guard !isMuted else {
            state = .listeningForWake
            return
        }
        state = .listeningForWake
        currentEmotion = nil
        setEvent("listening")
        wakeWordService.setSuppressed(false)
        startIdleTimer()
    }

    private var stateStatusText: String {
        if isMuted { return "Muted" }
        // Show connection state when relevant
        if let ws = webSocket {
            switch ws.state {
            case .disconnected:
                if state != .idle { return "Disconnected" }
            case .connecting:
                return "Connecting..."
            case .reconnecting:
                return "Reconnecting..."
            case .connected:
                break
            }
        }
        switch state {
        case .idle: return "Voice mode off"
        case .listeningForWake: return wakeWordService.isEnabled ? "Say \"Hey JOI\"..." : "Starting..."
        case .capturing: return "Listening..."
        case .processing: return "Thinking..."
        case .speaking: return "Speaking..."
        case .error: return errorMessage ?? "Error"
        }
    }
}

// MARK: - WebSocket state description helper

extension WebSocketClient.ConnectionState {
    var debugDescription: String {
        switch self {
        case .disconnected: return "disconnected"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .reconnecting: return "reconnecting"
        }
    }
}
