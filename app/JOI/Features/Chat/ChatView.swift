import SwiftUI
import SwiftData

struct ChatDebugSnapshot {
    let conversationId: String?
    let isStreaming: Bool
    let messages: [ChatUIMessage]
}

struct ChatView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine
    @Environment(\.modelContext) private var modelContext

    @State private var viewModel = ChatViewModel()

    #if os(iOS)
    @Environment(PhoneWatchBridge.self) private var phoneWatchBridge
    @State private var showVoice = false
    #endif

    var conversationId: String?
    var showLiveTranscriptBubble = true
    var onSnapshotChange: ((ChatDebugSnapshot) -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            #if os(macOS)
            // Compact voice status indicator
            VoiceStatusBar(engine: voiceEngine)
            #endif

            // Messages
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        // Live voice transcription as a temporary bubble
                        if showLiveTranscriptBubble,
                           voiceEngine.isCapturing,
                           !voiceEngine.capturedTranscript.isEmpty {
                            MessageBubble(message: ChatUIMessage(
                                id: "voice-transcript",
                                role: "user",
                                content: voiceEngine.capturedTranscript,
                                isStreaming: true,
                                isError: false,
                                createdAt: .now))
                            .id("voice-transcript")
                        }

                        if viewModel.isStreaming,
                           let last = viewModel.messages.last,
                           !last.isStreaming {
                            MessageBubble(message: ChatUIMessage(
                                id: "streaming-placeholder",
                                role: "assistant",
                                content: "",
                                isStreaming: true,
                                isError: false,
                                createdAt: .now))
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                }
                .scrollIndicators(.hidden)
                .onChange(of: viewModel.messages.count) {
                    if let lastId = viewModel.messages.last?.id {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
                .onChange(of: voiceEngine.capturedTranscript) {
                    if voiceEngine.isCapturing {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo("voice-transcript", anchor: .bottom)
                        }
                    }
                }
            }

            // Input — text-only
            ChatInput(
                text: $viewModel.inputText,
                isStreaming: viewModel.isStreaming,
                onSend: { viewModel.send() })
        }
        .background(JOIColors.background)
        .onAppear {
            viewModel.attach(webSocket: webSocket, router: router, modelContext: modelContext)
            emitSnapshot()
            voiceEngine.onVoiceMessageSent = { [viewModel] text in
                viewModel.addVoiceMessage(text)
            }
            voiceEngine.onTranscription = { [viewModel] _, _, isFinal in
                guard isFinal else { return }
                viewModel.scheduleVoiceSync()
            }
            voiceEngine.onConversationReady = { [viewModel] conversationId in
                viewModel.syncVoiceConversation(id: conversationId)
            }
            if let conversationId {
                viewModel.loadConversation(id: conversationId)
            }
            voiceEngine.setConversationContext(
                conversationId: viewModel.activeConversationId,
                agentId: "personal"
            )
        }
        .onChange(of: conversationId) { _, newId in
            if let newId {
                viewModel.loadConversation(id: newId)
            } else {
                viewModel.newConversation()
            }
            voiceEngine.setConversationContext(
                conversationId: viewModel.activeConversationId,
                agentId: "personal"
            )
        }
        .onChange(of: viewModel.activeConversationId) { _, newId in
            emitSnapshot()
            voiceEngine.setConversationContext(conversationId: newId, agentId: "personal")
        }
        .onChange(of: viewModel.messages.count) { _, _ in
            emitSnapshot()
        }
        .onChange(of: viewModel.isStreaming) { _, _ in
            emitSnapshot()
        }
        .onChange(of: webSocket.isConnected) { _, _ in
            viewModel.handleConnectionStateChange(webSocket.state)
        }
        #if os(iOS)
        .onChange(of: voiceEngine.state) { _, _ in
            phoneWatchBridge.publishStatusSnapshot(from: voiceEngine)
        }
        .onChange(of: voiceEngine.statusText) { _, _ in
            phoneWatchBridge.publishStatusSnapshot(from: voiceEngine)
        }
        .onChange(of: voiceEngine.isMuted) { _, _ in
            phoneWatchBridge.publishStatusSnapshot(from: voiceEngine)
        }
        .onChange(of: voiceEngine.errorMessage) { _, _ in
            phoneWatchBridge.publishStatusSnapshot(from: voiceEngine)
        }
        .onChange(of: voiceEngine.capturedTranscript) { _, _ in
            phoneWatchBridge.publishStatusSnapshot(from: voiceEngine)
        }
        #endif
        .onDisappear {
            voiceEngine.onVoiceMessageSent = nil
            voiceEngine.onTranscription = nil
            voiceEngine.onConversationReady = nil
            emitSnapshot()
        }
        #if os(iOS)
        .sheet(isPresented: $showVoice) {
            VoiceSheet()
                .environment(voiceEngine)
        }
        #endif
    }

    private func emitSnapshot() {
        onSnapshotChange?(ChatDebugSnapshot(
            conversationId: viewModel.activeConversationId,
            isStreaming: viewModel.isStreaming,
            messages: viewModel.messages))
    }
}

// MARK: - Voice Status Bar (macOS)

#if os(macOS)
private struct VoiceStatusBar: View {
    let engine: VoiceEngine
    private let avatarSize: CGFloat = 62
    @State private var showDebug = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Button {
                    if engine.isSpeaking {
                        engine.interruptSpeaking()
                    } else if !engine.isCapturing {
                        Task { await engine.tapToTalk() }
                    }
                } label: {
                    JOIAvatarImage(
                        style: orbStyle,
                        activityLevel: orbLevel,
                        isActive: orbIsActive,
                        showPulseRings: orbStyle != .firestorm
                    )
                    .frame(width: avatarSize, height: avatarSize)
                    .overlay(
                        Circle()
                            .fill(Color.black.opacity(engine.isMuted ? 0.18 : 0))
                    )
                    .shadow(color: orbStroke.opacity(orbIsActive ? 0.36 : 0.12), radius: orbIsActive ? 13 : 6)
                }
                .buttonStyle(.plain)
                .frame(width: avatarSize + 22, height: avatarSize + 22)
                .contentShape(Circle())

                // Status text + hint
                VStack(alignment: .leading, spacing: 3) {
                    Text(engine.statusText)
                        .font(JOITypography.bodyMedium)
                        .foregroundStyle(statusColor)

                    if engine.isCapturing {
                        Text(engine.capturedTranscript.isEmpty ? "Speak now..." : engine.capturedTranscript)
                            .font(JOITypography.labelSmall)
                            .foregroundStyle(JOIColors.textSecondary)
                            .lineLimit(2)
                    } else if engine.isSpeaking {
                        Text("Tap avatar to interrupt")
                            .font(JOITypography.labelSmall)
                            .foregroundStyle(JOIColors.textTertiary)
                    } else if engine.isError {
                        Text(engine.errorMessage ?? "")
                            .font(JOITypography.labelSmall)
                            .foregroundStyle(JOIColors.error.opacity(0.7))
                            .lineLimit(1)
                    } else if engine.isActive && !engine.isMuted {
                        Text("Tap avatar to talk")
                            .font(JOITypography.labelSmall)
                            .foregroundStyle(JOIColors.textTertiary)
                    }
                }

                Spacer()

                // Debug toggle
                Button {
                    showDebug.toggle()
                } label: {
                    Image(systemName: "ladybug")
                        .font(.system(size: 10))
                        .foregroundStyle(showDebug ? JOIColors.primary : JOIColors.textTertiary.opacity(0.5))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            // Debug overlay
            if showDebug {
                VoiceDebugOverlay(engine: engine)
            }
        }
        .background(JOIColors.surface.opacity(0.6))
        .animation(.easeInOut(duration: 0.2), value: engine.state)
        .animation(.easeInOut(duration: 0.2), value: engine.isMuted)
    }

    private var orbIsActive: Bool {
        (engine.isActive && !engine.isMuted) || engine.isSpeaking
    }

    private var orbLevel: Double {
        if engine.isSpeaking {
            return max(0.62, engine.micLevel)
        }
        if engine.isActive && !engine.isMuted {
            return max(0.20, engine.micLevel)
        }
        return 0.08
    }

    private var orbStyle: JOIAvatarImage.Style {
        if engine.isSpeaking || engine.isCapturing || (engine.isActive && !engine.isMuted) {
            return .firestorm
        }
        return .transparent
    }

    private var orbStroke: Color {
        if engine.isError { return JOIColors.error }
        if engine.isMuted { return JOIColors.textTertiary }
        if orbIsActive { return JOIColors.textPrimary }
        return JOIColors.textSecondary
    }

    private var statusColor: Color {
        if engine.isError { return JOIColors.error }
        if engine.isMuted { return JOIColors.textTertiary }
        return JOIColors.textPrimary
    }
}

private struct VoiceDebugOverlay: View {
    let engine: VoiceEngine
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Row 1: Pipeline state
            HStack(spacing: 0) {
                debugLabel("engine", engine.activeEngine.rawValue, color: .cyan)
                debugLabel("state", engine.state, color: stateColor)
                debugLabel("mic", String(format: "%.3f", engine.micLevel))
                if engine.isMuted { debugLabel("MUTED", "", color: .red) }
                if let emotion = engine.currentEmotion {
                    debugLabel("emotion", emotion, color: .purple)
                }
            }

            // Row 2: Connection
            HStack(spacing: 0) {
                debugLabel("ws", engine.debugWsState, color: wsColor)
                if let err = engine.debugWsError {
                    Text(" err=\(err.prefix(40))")
                        .foregroundStyle(JOIColors.error)
                }
            }

            // Row 3: Services
            HStack(spacing: 0) {
                debugLabel("wake", engine.debugWakeWordEnabled ? (engine.debugWakeWordListening ? "ON" : "enabled") : "off",
                           color: engine.debugWakeWordListening ? .green : .gray)
                debugLabel("speech", engine.debugSpeechListening ? "ON" : "off",
                           color: engine.debugSpeechListening ? .green : .gray)
            }

            // Row 4: Streaming state + copy button
            HStack(spacing: 0) {
                debugLabel("event", engine.debugLastEvent)
                if engine.debugStreamDone {
                    debugLabel("streamDone", "true", color: .green)
                }
                if engine.debugSentenceCount > 0 {
                    debugLabel("sents", "\(engine.debugSentenceCount)")
                }
                if engine.debugSpokenCount > 0 {
                    debugLabel("spoken", "\(engine.debugSpokenCount)")
                }

                Spacer()

                // Copy log button
                Button {
                    let logText = VoiceDebugLog.shared.formatted()
                    #if os(macOS)
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText, forType: .string)
                    #endif
                    copied = true
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copied = false
                    }
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        Text(copied ? "Copied!" : "Copy Log")
                    }
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(copied ? JOIColors.success : JOIColors.primary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(JOIColors.surfaceVariant)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                .buttonStyle(.plain)
            }
        }
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(JOIColors.textTertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    private func debugLabel(_ key: String, _ value: String, color: Color = JOIColors.textTertiary) -> some View {
        HStack(spacing: 2) {
            Text(key + ":")
                .foregroundStyle(JOIColors.textTertiary.opacity(0.6))
            Text(value)
                .foregroundStyle(color)
        }
        .padding(.trailing, 8)
    }

    private var stateColor: Color {
        switch engine.state {
        case "idle": return .gray
        case "listeningForWake", "active": return JOIColors.primary
        case "capturing": return .green
        case "processing", "connecting": return .yellow
        case "speaking": return .orange
        case "error": return .red
        default: return .gray
        }
    }

    private var wsColor: Color {
        switch engine.debugWsState {
        case "connected": return .green
        case "connecting", "reconnecting": return .yellow
        default: return .red
        }
    }
}
#endif

// MARK: - iOS Voice Sheet (replacement for VoiceView)

#if os(iOS)
private struct VoiceSheet: View {
    @Environment(VoiceEngine.self) private var engine

    private let avatarSize: CGFloat = 120

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            JOIAvatarImage(
                style: orbStyle,
                activityLevel: orbLevel,
                isActive: orbIsActive,
                showPulseRings: orbStyle != .firestorm
            )
            .frame(width: avatarSize, height: avatarSize)
            .shadow(color: JOIColors.primary.opacity(orbIsActive ? 0.26 : 0.08), radius: orbIsActive ? 18 : 10)
            .onTapGesture {
                if engine.isSpeaking {
                    engine.interruptSpeaking()
                }
            }

            Text(engine.statusText)
                .font(JOITypography.labelMedium)
                .foregroundStyle(engine.isError ? JOIColors.error : JOIColors.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(engine.isError ? JOIColors.error.opacity(0.12) : JOIColors.surfaceVariant)
                .clipShape(Capsule())

            Spacer()

            Button(action: {
                if engine.isActive { engine.stop() }
                else { Task { await engine.start() } }
            }) {
                HStack(spacing: 8) {
                    Image(systemName: engine.isActive ? "mic.slash.fill" : "mic.fill")
                    Text(engine.isActive ? "Stop Voice" : "Start Voice")
                }
                .font(JOITypography.labelLarge)
                .foregroundStyle(engine.isActive ? JOIColors.error : JOIColors.primary)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background((engine.isActive ? JOIColors.error : JOIColors.primary).opacity(0.12))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JOIColors.background)
        .animation(.easeInOut(duration: 0.2), value: engine.state)
    }

    private var orbIsActive: Bool {
        (engine.isActive && !engine.isMuted) || engine.isSpeaking
    }

    private var orbLevel: Double {
        if engine.isSpeaking { return max(0.62, engine.micLevel) }
        if engine.isActive && !engine.isMuted { return max(0.20, engine.micLevel) }
        return 0.08
    }

    private var orbStyle: JOIAvatarImage.Style {
        if engine.isSpeaking || engine.isCapturing || (engine.isActive && !engine.isMuted) {
            return .firestorm
        }
        return .transparent
    }
}
#endif
