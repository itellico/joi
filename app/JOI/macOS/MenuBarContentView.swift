import SwiftUI
import SwiftData

struct MenuBarContentView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine
    @State private var currentView: PanelView = .chat
    @State private var selectedConversationId: String?

    enum PanelView {
        case chat
        case conversations
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar

            Divider()
                .background(JOIColors.divider)

            ConnectionBanner(state: webSocket.state, error: webSocket.lastError)
                .withStartupGrace()

            if currentView == .chat {
                quickActionStrip

                Divider()
                    .background(JOIColors.divider)
            }

            // Content — ZStack preserves ChatView state.
            ZStack {
                ChatView(conversationId: selectedConversationId)
                    .opacity(currentView == .chat ? 1 : 0)
                    .allowsHitTesting(currentView == .chat)

                if currentView == .conversations {
                    MenuBarConversationsPanel(
                        selectedId: $selectedConversationId,
                        onSelect: { currentView = .chat })
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JOIColors.background)
        .onReceive(NotificationCenter.default.publisher(for: .joiOpenHistory)) { _ in
            currentView = .conversations
            webSocket.send(type: .sessionList)
        }
        .onReceive(NotificationCenter.default.publisher(for: .joiOpenChat)) { _ in
            currentView = .chat
        }
    }

    @ViewBuilder
    private var headerBar: some View {
        HStack(spacing: 10) {
            if currentView != .chat {
                Button(action: { currentView = .chat }) {
                    Label("Chat", systemImage: "chevron.left")
                        .font(JOITypography.labelMedium)
                        .foregroundStyle(JOIColors.primary)
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 8) {
                    JOIAvatarImage(
                        style: .transparent,
                        activityLevel: voiceEngine.isActive ? max(0.20, voiceEngine.micLevel) : 0.10,
                        isActive: voiceEngine.isActive && !voiceEngine.isMuted,
                        showPulseRings: false
                    )
                    .frame(width: 15, height: 15)

                    Text("JOI")
                        .font(JOITypography.headlineSmall)
                        .foregroundStyle(JOIColors.textPrimary)
                }
            }

            Spacer()

            ConnectionStatusPill(state: webSocket.state)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(JOIColors.surface)
    }

    private var quickActionStrip: some View {
        HStack(spacing: 8) {
            quickActionButton(
                title: voiceEngine.isActive ? "JOI Off" : "JOI On",
                symbol: voiceEngine.isActive ? "power.circle.fill" : "power.circle",
                active: voiceEngine.isActive
            ) {
                if voiceEngine.isActive {
                    voiceEngine.stop()
                } else {
                    Task { @MainActor in
                        await voiceEngine.start()
                    }
                }
            }

            quickActionButton(
                title: voiceEngine.isMuted ? "Unmute" : "Mute",
                symbol: voiceEngine.isMuted ? "mic.slash.fill" : "mic.fill",
                active: !voiceEngine.isMuted
            ) {
                if voiceEngine.isMuted {
                    voiceEngine.unmute()
                } else {
                    voiceEngine.mute()
                }
            }

            quickActionButton(
                title: "Conversations",
                symbol: "clock",
                active: currentView == .conversations
            ) {
                currentView = .conversations
            }

            SettingsLink {
                quickActionLabel(title: "Settings", symbol: "gearshape")
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(JOIColors.surfaceVariant.opacity(0.55))
    }

    private func quickActionButton(
        title: String,
        symbol: String,
        active: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            quickActionLabel(title: title, symbol: symbol, active: active)
        }
        .buttonStyle(.plain)
    }

    private func quickActionLabel(title: String, symbol: String, active: Bool = false) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
            Text(title)
                .font(JOITypography.labelSmall)
        }
        .foregroundStyle(active ? JOIColors.primary : JOIColors.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(active ? JOIColors.primary.opacity(0.12) : JOIColors.surface))
    }
}

// MARK: - Conversations Panel

private struct MenuBarConversationsPanel: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Binding var selectedId: String?
    var onSelect: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if router.sessionList.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 36))
                        .foregroundStyle(JOIColors.textTertiary)
                    Text("No conversations yet")
                        .font(JOITypography.bodyMedium)
                        .foregroundStyle(JOIColors.textSecondary)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        Button(action: {
                            selectedId = nil
                            onSelect()
                        }) {
                            HStack(spacing: 8) {
                                Image(systemName: "plus.circle.fill")
                                    .foregroundStyle(JOIColors.primary)
                                Text("New Conversation")
                                    .font(JOITypography.labelMedium)
                                    .foregroundStyle(JOIColors.primary)
                                Spacer()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.plain)

                        Divider()
                            .background(JOIColors.divider)

                        ForEach(router.sessionList) { session in
                            Button(action: {
                                selectedId = session.id
                                onSelect()
                            }) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(session.title ?? "Untitled")
                                        .font(JOITypography.bodyMedium)
                                        .foregroundStyle(JOIColors.textPrimary)
                                        .lineLimit(1)

                                    if let lastMessage = session.lastMessage {
                                        Text(lastMessage)
                                            .font(JOITypography.bodySmall)
                                            .foregroundStyle(JOIColors.textSecondary)
                                            .lineLimit(2)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(
                                    selectedId == session.id
                                        ? JOIColors.primary.opacity(0.08)
                                        : Color.clear)
                            }
                            .buttonStyle(.plain)

                            Divider()
                                .padding(.leading, 16)
                                .background(JOIColors.divider)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JOIColors.background)
        .onAppear {
            webSocket.send(type: .sessionList)
        }
    }
}
