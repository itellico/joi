import Foundation

/// Unified voice engine that wraps either the legacy on-device pipeline
/// or the LiveKit cloud pipeline. The active engine is selected by UserDefaults.
///
/// All views observe this wrapper via @Environment — it delegates to whichever
/// pipeline is active, so UI code doesn't need to know which engine is in use.
@MainActor
@Observable
final class VoiceEngine {
    enum EngineType: String {
        case legacy = "legacy"
        case livekit = "livekit"
    }

    /// Which engine is currently active
    private(set) var activeEngine: EngineType

    /// The underlying pipelines
    let legacy = VoicePipeline()
    let livekit = LiveKitVoicePipeline()

    init() {
        let stored = UserDefaults.standard.string(forKey: "voiceEngine") ?? EngineType.livekit.rawValue
        let resolved = EngineType(rawValue: stored) ?? .livekit
        if resolved == .legacy {
            self.activeEngine = .livekit
            UserDefaults.standard.set(EngineType.livekit.rawValue, forKey: "voiceEngine")
        } else {
            self.activeEngine = resolved
        }
    }

    // MARK: - Forwarded Observable State

    var state: String {
        switch activeEngine {
        case .legacy: return legacy.state.rawValue
        case .livekit: return livekit.state.rawValue
        }
    }

    var errorMessage: String? {
        switch activeEngine {
        case .legacy: return legacy.errorMessage
        case .livekit: return livekit.errorMessage
        }
    }

    var isMuted: Bool {
        switch activeEngine {
        case .legacy: return legacy.isMuted
        case .livekit: return livekit.isMuted
        }
    }

    var currentEmotion: String? {
        switch activeEngine {
        case .legacy: return legacy.currentEmotion
        case .livekit: return livekit.currentEmotion
        }
    }

    var statusText: String {
        switch activeEngine {
        case .legacy: return legacy.statusText
        case .livekit: return livekit.statusText
        }
    }

    var micLevel: Double {
        switch activeEngine {
        case .legacy: return legacy.micLevel
        case .livekit: return livekit.micLevel
        }
    }

    var isActive: Bool {
        switch activeEngine {
        case .legacy: return legacy.isActive
        case .livekit: return livekit.isActive
        }
    }

    var capturedTranscript: String {
        switch activeEngine {
        case .legacy: return legacy.capturedTranscript
        case .livekit: return livekit.capturedTranscript
        }
    }

    var livekitNetworkMode: String? {
        guard activeEngine == .livekit else { return nil }
        return livekit.networkMode
    }

    var livekitNetworkTargetIp: String? {
        guard activeEngine == .livekit else { return nil }
        return livekit.networkTargetIp
    }

    var livekitNetworkClientIp: String? {
        guard activeEngine == .livekit else { return nil }
        return livekit.networkClientIp
    }

    var isLegacyState: VoicePipeline.State {
        legacy.state
    }

    var isLiveKitState: LiveKitVoicePipeline.State {
        livekit.state
    }

    /// Whether the state is "capturing" (legacy) or "active" (livekit)
    var isCapturing: Bool {
        switch activeEngine {
        case .legacy: return legacy.state == .capturing
        case .livekit: return livekit.state == .active
        }
    }

    /// Whether the state is "speaking"
    var isSpeaking: Bool {
        switch activeEngine {
        case .legacy: return legacy.state == .speaking
        case .livekit: return livekit.state == .speaking
        }
    }

    /// Whether the state is "error"
    var isError: Bool {
        switch activeEngine {
        case .legacy: return legacy.state == .error
        case .livekit: return livekit.state == .error
        }
    }

    /// Whether the state is "listeningForWake" (legacy) or "active" (livekit, not speaking)
    var isListeningForWake: Bool {
        switch activeEngine {
        case .legacy: return legacy.state == .listeningForWake
        case .livekit: return livekit.state == .active
        }
    }

    // MARK: - Debug

    var debugWakeWordEnabled: Bool {
        switch activeEngine {
        case .legacy: return legacy.debugWakeWordEnabled
        case .livekit: return livekit.debugWakeWordEnabled
        }
    }

    var debugWakeWordListening: Bool {
        switch activeEngine {
        case .legacy: return legacy.debugWakeWordListening
        case .livekit: return livekit.debugWakeWordListening
        }
    }

    var debugSpeechListening: Bool {
        switch activeEngine {
        case .legacy: return legacy.debugSpeechListening
        case .livekit: return livekit.debugSpeechListening
        }
    }

    var debugWsState: String {
        switch activeEngine {
        case .legacy: return legacy.debugWsState
        case .livekit: return livekit.debugWsState
        }
    }

    var debugWsError: String? {
        switch activeEngine {
        case .legacy: return legacy.debugWsError
        case .livekit: return livekit.debugWsError
        }
    }

    var debugLastEvent: String {
        switch activeEngine {
        case .legacy: return legacy.debugLastEvent
        case .livekit: return livekit.debugLastEvent
        }
    }

    var debugStreamDone: Bool {
        switch activeEngine {
        case .legacy: return legacy.debugStreamDone
        case .livekit: return livekit.debugStreamDone
        }
    }

    var debugSentenceCount: Int {
        switch activeEngine {
        case .legacy: return legacy.debugSentenceCount
        case .livekit: return livekit.debugSentenceCount
        }
    }

    var debugSpokenCount: Int {
        switch activeEngine {
        case .legacy: return legacy.debugSpokenCount
        case .livekit: return livekit.debugSpokenCount
        }
    }

    // MARK: - Forwarded Callbacks

    var onVoiceMessageSent: (@MainActor (String) -> Void)? {
        didSet {
            legacy.onVoiceMessageSent = onVoiceMessageSent
            livekit.onVoiceMessageSent = onVoiceMessageSent
        }
    }

    var onTranscription: (@MainActor (_ text: String, _ isUser: Bool, _ isFinal: Bool) -> Void)? {
        didSet {
            livekit.onTranscription = onTranscription
        }
    }

    var onConversationReady: (@MainActor (String) -> Void)? {
        didSet {
            livekit.onConversationReady = onConversationReady
        }
    }

    // MARK: - Actions

    func attach(webSocket: WebSocketClient, router: FrameRouter) {
        legacy.attach(webSocket: webSocket, router: router)
        livekit.attach(webSocket: webSocket, router: router)
    }

    func start() async {
        switch activeEngine {
        case .legacy: await legacy.start()
        case .livekit: await livekit.start()
        }
    }

    func stop() {
        legacy.stop()
        livekit.stop()
    }

    func mute() {
        // Mute should feel immediate: stop any ongoing speech first.
        interruptSpeaking()
        switch activeEngine {
        case .legacy: legacy.mute()
        case .livekit: livekit.mute()
        }
    }

    func unmute() {
        switch activeEngine {
        case .legacy: legacy.unmute()
        case .livekit: livekit.unmute()
        }
    }

    func tapToTalk() async {
        switch activeEngine {
        case .legacy: await legacy.tapToTalk()
        case .livekit: await livekit.tapToTalk()
        }
    }

    func interruptSpeaking() {
        switch activeEngine {
        case .legacy: legacy.interruptSpeaking()
        case .livekit: livekit.interruptSpeaking()
        }
    }

    func setConversationContext(conversationId: String?, agentId: String = "personal") {
        livekit.setConversationContext(conversationId: conversationId, agentId: agentId)
    }

    // MARK: - Engine Switching

    func switchEngine(to engine: EngineType) {
        guard engine != activeEngine else { return }

        // Stop current engine
        stop()

        // Switch
        activeEngine = engine
        UserDefaults.standard.set(engine.rawValue, forKey: "voiceEngine")

        // Start new engine
        Task { await start() }
    }
}
