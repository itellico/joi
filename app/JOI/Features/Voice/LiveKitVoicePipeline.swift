import Foundation
import AVFoundation
import LiveKit
import Observation
import os

/// LiveKit-based voice pipeline. Replaces the on-device VoicePipeline with a
/// server-side real-time pipeline: audio streams via WebRTC, server handles
/// VAD/STT/LLM/TTS, audio streams back.
///
/// Exposes the same observable interface as VoicePipeline so the UI works unchanged.
@MainActor
@Observable
final class LiveKitVoicePipeline {
    enum State: String {
        case idle
        case connecting
        case active       // Connected, listening via server-side VAD
        case speaking     // Agent is responding with audio
        case error
    }

    enum VoiceMode: String {
        case wakeWord     // WakeWordService gates room connection
        case alwaysOn     // Room stays connected, server-side VAD detects speech
    }

    // MARK: - Observable State (matches VoicePipeline interface)

    private(set) var state: State = .idle
    private(set) var errorMessage: String?
    private(set) var isMuted = false
    private(set) var currentEmotion: String?
    private(set) var capturedTranscript = ""

    var statusText: String { stateStatusText }
    var micLevel: Double {
        if isMuted { return 0 }
        return _micLevel
    }
    var isActive: Bool { state == .active || state == .speaking || state == .connecting }

    // Debug accessors (for VoiceDebugOverlay compatibility)
    var debugWakeWordEnabled: Bool { voiceMode == .wakeWord && wakeWordService.isEnabled }
    var debugWakeWordListening: Bool { wakeWordService.isListening }
    var debugSpeechListening: Bool { state == .active }
    var debugWsState: String { room.connectionState.description }
    var debugWsError: String? { errorMessage }
    var debugLastEvent: String { lastDebugEvent }
    var debugStreamDone: Bool { false }
    var debugSentenceCount: Int { 0 }
    var debugSpokenCount: Int { 0 }

    /// Called when a voice message is finalized — allows ChatViewModel to show the user bubble
    var onVoiceMessageSent: (@MainActor (String) -> Void)?

    /// Called when a transcription (user or agent) is received
    var onTranscription: (@MainActor (_ text: String, _ isUser: Bool, _ isFinal: Bool) -> Void)?

    /// Called when token minting resolves to a concrete conversation ID.
    var onConversationReady: (@MainActor (String) -> Void)?

    // MARK: - Configuration

    var voiceMode: VoiceMode = .alwaysOn
    private var configuredConversationId: String?
    private var configuredAgentId = "personal"

    // MARK: - Private

    private let room = Room()
    private let tokenService = TokenService()
    let wakeWordService = WakeWordService()
    private let log = Logger(subsystem: "com.joi.app", category: "LiveKitVoice")
    private let dlog = VoiceDebugLog.shared

    private var _micLevel: Double = 0
    private var lastDebugEvent = "none"
    private var audioLevelTask: Task<Void, Never>?
    private var transcriptionTask: Task<Void, Never>?
    private var roomDelegateHandler: RoomDelegateHandler?
    private var preMuteOutputVolume: Float = 1.0
    private var didForceMuteOutput = false

    func setEvent(_ event: String) {
        lastDebugEvent = event
        dlog.log("livekit", event)
    }

    // MARK: - Lifecycle

    func start() async {
        guard state == .idle || state == .error else {
            log.info("start() skipped — state=\(self.state.rawValue, privacy: .public)")
            return
        }

        errorMessage = nil

        switch voiceMode {
        case .alwaysOn:
            await connectToRoom()
        case .wakeWord:
            state = .idle
            setEvent("wakeWord mode — listening locally")
            wakeWordService.setEnabled(true)
            wakeWordService.onCommand = { [weak self] command in
                guard let self else { return }
                await self.handleWakeCommand(command)
            }
            wakeWordService.onError = { [weak self] message in
                guard let self else { return }
                self.state = .error
                self.errorMessage = message
            }
        }
    }

    func stop() {
        log.info("Stopping LiveKit voice pipeline")
        setEvent("stopped")
        state = .idle
        errorMessage = nil
        currentEmotion = nil
        capturedTranscript = ""
        audioLevelTask?.cancel()
        audioLevelTask = nil
        transcriptionTask?.cancel()
        transcriptionTask = nil
        wakeWordService.stop()
        restoreOutputVolumeIfNeeded()

        Task {
            await room.disconnect()
        }
    }

    func mute() {
        isMuted = true
        setEvent("muted")
        forceMuteOutputVolume()
        Task {
            try? await room.localParticipant.setMicrophone(enabled: false)
        }
    }

    func unmute() {
        isMuted = false
        setEvent("unmuted")
        restoreOutputVolumeIfNeeded()
        Task {
            try? await room.localParticipant.setMicrophone(enabled: true)
        }
    }

    private func forceMuteOutputVolume() {
        guard !didForceMuteOutput else {
            AudioManager.shared.mixer.outputVolume = 0
            return
        }
        preMuteOutputVolume = AudioManager.shared.mixer.outputVolume
        didForceMuteOutput = true
        AudioManager.shared.mixer.outputVolume = 0
    }

    private func restoreOutputVolumeIfNeeded() {
        guard didForceMuteOutput else { return }
        AudioManager.shared.mixer.outputVolume = max(preMuteOutputVolume, 0.01)
        didForceMuteOutput = false
    }

    /// Tap-to-talk: in wakeWord mode, connects immediately; in alwaysOn mode, unmutes
    func tapToTalk() async {
        switch voiceMode {
        case .alwaysOn:
            if state == .idle || state == .error {
                await connectToRoom()
            } else if isMuted {
                unmute()
            }
        case .wakeWord:
            await handleWakeCommand("")
        }
    }

    func interruptSpeaking() {
        guard state == .speaking else { return }
        log.info("Interrupting agent speech")
        setEvent("interrupt")
        // LiveKit handles interruption natively — when user speaks,
        // the agent's VAD detects it and stops. We just update UI state.
        state = .active
    }

    func setConversationContext(conversationId: String?, agentId: String = "personal") {
        let normalizedConversation = conversationId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        configuredConversationId = (normalizedConversation?.isEmpty == false) ? normalizedConversation : nil

        let normalizedAgent = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
        configuredAgentId = normalizedAgent.isEmpty ? "personal" : normalizedAgent
    }

    // MARK: - Internal Setters (for RoomDelegateHandler)

    func updateState(_ newState: State) {
        state = newState
    }

    // MARK: - WebSocket Attachment (for legacy compatibility)

    /// No-op for LiveKitVoicePipeline — it doesn't use WebSocket for voice.
    /// Kept for API compatibility with VoicePipeline.
    func attach(webSocket: WebSocketClient, router: FrameRouter) {
        // LiveKit voice doesn't use WebSocket — text chat still does via existing path
    }

    // MARK: - Room Connection

    private func connectToRoom() async {
        state = .connecting
        setEvent("connecting")

        // Ensure no local pipeline is still holding the microphone.
        wakeWordService.stop()

        let micOK = await requestMicrophonePermission()
        guard micOK else {
            state = .error
            errorMessage = "Microphone permission denied. Enable in System Settings > Privacy > Microphone."
            setEvent("micPermissionDenied")
            log.error("LiveKit connect failed: microphone permission denied")
            return
        }

        #if os(macOS)
        configureMacOSAudioInput()
        #endif

        do {
            let details = try await tokenService.fetchConnectionDetails(
                conversationId: configuredConversationId,
                agentId: configuredAgentId
            )

            // Set up room delegate before connecting
            if roomDelegateHandler == nil {
                let handler = RoomDelegateHandler(pipeline: self)
                roomDelegateHandler = handler
                room.add(delegate: handler)
            }

            try await room.connect(
                url: details.serverUrl,
                token: details.token,
                connectOptions: ConnectOptions(autoSubscribe: true)
            )

            // Enable microphone
            try await room.localParticipant.setMicrophone(enabled: !isMuted)

            if let resolvedConversationId = details.conversationId {
                configuredConversationId = resolvedConversationId
                onConversationReady?(resolvedConversationId)
            }

            state = .active
            setEvent("connected to \(details.roomName)")
            log.info("Connected to LiveKit room: \(details.roomName, privacy: .public)")

            // Start monitoring mic level
            startAudioLevelMonitor()

            // Register for transcription streams
            await registerTranscriptionHandler()

        } catch {
            state = .error
            errorMessage = error.localizedDescription
            setEvent("connectError: \(error.localizedDescription)")
            log.error("LiveKit connect failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Permissions

    private nonisolated func requestMicrophonePermission() async -> Bool {
        #if os(iOS)
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        case .undetermined: break
        @unknown default: return false
        }
        return await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { ok in
                cont.resume(returning: ok)
            }
        }
        #elseif os(macOS)
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .denied, .restricted: return false
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        @unknown default: return false
        }
        #else
        return true
        #endif
    }

    #if os(macOS)
    private func configureMacOSAudioInput() {
        let manager = AudioManager.shared
        let devices = manager.inputDevices
        guard !devices.isEmpty else {
            log.error("LiveKit: no macOS input devices available")
            return
        }

        let current = manager.inputDevice
        let defaultDevice = manager.defaultInputDevice
        let names = devices.map { $0.name }.joined(separator: ", ")
        log.info("LiveKit macOS input devices: \(names, privacy: .public)")

        let preferredTokens = ["built-in", "internal", "microphone", "macbook", "mic"]
        let avoidTokens = ["blackhole", "loopback", "virtual", "aggregate", "obs", "soundflower", "vb-audio", "cable", "zoomaudio"]

        let chosen = devices.max { lhs, rhs in
            let lhsScore: Int = {
                let normalized = lhs.name.lowercased()
                var score = lhs.deviceId == defaultDevice.deviceId ? 1 : 0
                if preferredTokens.contains(where: { normalized.contains($0) }) { score += 3 }
                if avoidTokens.contains(where: { normalized.contains($0) }) { score -= 4 }
                return score
            }()
            let rhsScore: Int = {
                let normalized = rhs.name.lowercased()
                var score = rhs.deviceId == defaultDevice.deviceId ? 1 : 0
                if preferredTokens.contains(where: { normalized.contains($0) }) { score += 3 }
                if avoidTokens.contains(where: { normalized.contains($0) }) { score -= 4 }
                return score
            }()
            return lhsScore < rhsScore
        } ?? devices[0]

        if current.deviceId != chosen.deviceId {
            manager.inputDevice = chosen
            log.info("LiveKit selected input device: \(chosen.name, privacy: .public)")
        } else {
            log.info("LiveKit keeping input device: \(current.name, privacy: .public)")
        }

        // Ensure ADM mute state is not suppressing microphone capture.
        if manager.isMicrophoneMuted {
            manager.isMicrophoneMuted = false
            log.info("LiveKit unmuted internal microphone state")
        }
    }
    #endif

    // MARK: - Wake Word Integration

    private func handleWakeCommand(_ command: String) async {
        guard state == .idle || state == .error else { return }
        log.info("Wake command: '\(command, privacy: .public)'")
        setEvent("wakeCmd: '\(command.prefix(30))'")

        wakeWordService.setSuppressed(true)
        capturedTranscript = LocalVocabularyStore.apply(to: command)

        await connectToRoom()
    }

    // MARK: - Audio Level Monitoring

    private func startAudioLevelMonitor() {
        audioLevelTask?.cancel()
        audioLevelTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 50_000_000) // 20Hz
                guard let self else { break }

                // Get local audio track level
                let level = Double(self.room.localParticipant.audioLevel)
                self._micLevel = self._micLevel * 0.85 + level * 0.15
            }
        }
    }

    // MARK: - Transcription Handling

    private func registerTranscriptionHandler() async {
        do {
            try await room.registerTextStreamHandler(for: "lk.transcription") { [weak self] reader, participantIdentity in
                guard let self else { return }

                let isUser = participantIdentity == self.room.localParticipant.identity
                var accumulated = ""

                for try await chunk in reader {
                    guard !chunk.isEmpty else { continue }
                    accumulated += chunk

                    // Check for emotion tags in agent responses
                    if !isUser {
                        let (cleanText, emotion) = self.stripEmotionTags(accumulated)
                        if let emotion {
                            await MainActor.run { self.currentEmotion = emotion }
                        }
                        await MainActor.run {
                            self.onTranscription?(cleanText, false, false)
                        }
                    } else {
                        let normalized = LocalVocabularyStore.apply(to: accumulated)
                        await MainActor.run {
                            self.capturedTranscript = normalized
                            self.onTranscription?(normalized, true, false)
                        }
                    }
                }

                // Stream finished — this is the final transcription
                let isFinal = reader.info.attributes["lk.transcription_final"] == "true"
                let normalizedFinal = isUser ? LocalVocabularyStore.apply(to: accumulated) : accumulated

                if isUser && isFinal && !normalizedFinal.isEmpty {
                    await MainActor.run {
                        self.onVoiceMessageSent?(normalizedFinal)
                    }
                }

                if !isUser {
                    let (cleanText, _) = self.stripEmotionTags(accumulated)
                    await MainActor.run {
                        self.onTranscription?(cleanText, false, true)
                    }
                } else {
                    await MainActor.run {
                        self.onTranscription?(normalizedFinal, true, true)
                    }
                }
            }
        } catch {
            log.error("Failed to register transcription handler: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Helpers

    nonisolated private func stripEmotionTags(_ text: String) -> (String, String?) {
        // Match [emotion] tags like [happy], [thinking], [sad]
        let pattern = #"\[(\w+)\]"#
        var emotion: String?
        var cleanText = text

        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let range = Range(match.range(at: 1), in: text) {
            emotion = String(text[range])
            cleanText = regex.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text),
                withTemplate: ""
            ).trimmingCharacters(in: .whitespaces)
        }

        return (cleanText, emotion)
    }

    private var stateStatusText: String {
        if isMuted { return "Muted" }
        switch state {
        case .idle: return voiceMode == .wakeWord ? "Say \"Hey JOI\"..." : "Voice mode off"
        case .connecting: return "Connecting..."
        case .active: return "Listening..."
        case .speaking: return "Speaking..."
        case .error: return errorMessage ?? "Error"
        }
    }
}

// MARK: - Room Delegate

/// Handles LiveKit room events and updates the pipeline state accordingly.
private final class RoomDelegateHandler: RoomDelegate, @unchecked Sendable {
    private weak var pipeline: LiveKitVoicePipeline?

    init(pipeline: LiveKitVoicePipeline) {
        self.pipeline = pipeline
    }

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        Task { @MainActor [weak self] in
            guard let pipeline = self?.pipeline else { return }
            switch connectionState {
            case .disconnected:
                if pipeline.state != .idle {
                    pipeline.updateState(.idle)
                    pipeline.setEvent("room disconnected")
                    // In wake word mode, return to local listening
                    if pipeline.voiceMode == .wakeWord {
                        pipeline.wakeWordService.setSuppressed(false)
                    }
                }
            case .connected:
                pipeline.updateState(.active)
                pipeline.setEvent("room connected")
            case .reconnecting:
                pipeline.setEvent("room reconnecting")
            case .connecting:
                pipeline.updateState(.connecting)
            case .disconnecting:
                pipeline.setEvent("room disconnecting")
            @unknown default:
                break
            }
        }
    }

    nonisolated func room(_ room: Room, participant: Participant, didUpdateIsSpeaking isSpeaking: Bool) {
        Task { @MainActor [weak self] in
            guard let pipeline = self?.pipeline else { return }
            // Track when the agent is speaking
            let isAgent = participant.identity != room.localParticipant.identity
            if isAgent {
                if isSpeaking {
                    pipeline.updateState(.speaking)
                    pipeline.setEvent("agent speaking")
                } else if pipeline.state == .speaking {
                    pipeline.updateState(.active)
                    pipeline.setEvent("agent stopped speaking")
                }
            }
        }
    }
}
