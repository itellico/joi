import SwiftUI
#if os(iOS)
import UIKit
#endif

@MainActor
struct RootView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine
    @State private var selectedConversationId: String?
    @State private var showSettings = false
    @State private var widgetMode: AssistantWidgetMode = .closed

    var body: some View {
        GeometryReader { proxy in
            NavigationSplitView {
                ConversationsView(selectedConversationId: $selectedConversationId)
                    .toolbar {
                        ToolbarItem(placement: .automatic) {
                            Button(action: { showSettings = true }) {
                                Image(systemName: "gear")
                            }
                        }
                    }
            } detail: {
                VStack(spacing: 0) {
                    ConnectionBanner(state: webSocket.state, error: webSocket.lastError)
                        .withStartupGrace()

                    Spacer()

                    VStack(spacing: 10) {
                        JOIAvatarImage(
                            style: (voiceEngine.isActive && !voiceEngine.isMuted) ? .firestorm : .transparent,
                            activityLevel: voiceEngine.isActive ? max(0.18, voiceEngine.micLevel) : 0.10,
                            isActive: voiceEngine.isActive && !voiceEngine.isMuted,
                            showPulseRings: !(voiceEngine.isActive && !voiceEngine.isMuted)
                        )
                            .frame(width: 58, height: 58)

                        Text("JOI")
                            .font(JOITypography.headlineSmall)
                            .foregroundStyle(JOIColors.textPrimary)

                        Text("Tap the chat bubble in the bottom-right to talk.")
                            .font(JOITypography.bodySmall)
                            .foregroundStyle(JOIColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(JOIColors.surface.opacity(0.7))
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(JOIColors.borderSubtle, lineWidth: 1))
                    .padding(.horizontal, 24)

                    Spacer()
                }
                .background(JOIColors.background)
                .toolbar {
                    ToolbarItem(placement: .automatic) {
                        ConnectionStatusPill(state: webSocket.state)
                    }
                }
            }
            .tint(JOIColors.primary)
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .overlay(alignment: .bottomTrailing) {
                IOSAssistantWidget(
                    mode: $widgetMode,
                    selectedConversationId: $selectedConversationId,
                    size: proxy.size
                )
                .environment(webSocket)
                .environment(router)
                .environment(voiceEngine)
                .padding(.trailing, 14)
                .padding(.bottom, 10)
            }
        }
        .onChange(of: selectedConversationId) { _, newId in
            guard newId != nil, widgetMode == .closed else { return }
            withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                widgetMode = .panel
            }
        }
    }
}

private enum AssistantWidgetMode {
    case closed
    case panel
    case expanded
}

@MainActor
private struct IOSAssistantWidget: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine

    @Binding var mode: AssistantWidgetMode
    @Binding var selectedConversationId: String?

    let size: CGSize
    @State private var showHistory = false
    @State private var debugCopied = false
    @State private var snapshot: ChatDebugSnapshot = .empty
    @State private var pendingDeleteSession: SessionInfo?
    @State private var isDeletingConversation = false
    @State private var deletingConversationId: String?
    @State private var historyError: String?

    var body: some View {
        Group {
            if mode == .closed {
                bubbleButton
                    .transition(.scale.combined(with: .opacity))
            } else {
                panel
                    .transition(
                        .move(edge: .trailing)
                            .combined(with: .move(edge: .bottom))
                            .combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.9), value: mode)
        .onChange(of: mode) { _, newMode in
            if newMode == .closed {
                showHistory = false
            } else if newMode == .expanded, showHistory {
                requestSessionList()
            }
        }
        .onChange(of: showHistory) { _, shouldShow in
            guard shouldShow else { return }
            if mode == .panel {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                    mode = .expanded
                }
            }
            requestSessionList()
        }
        .alert("Delete Conversation?", isPresented: deleteAlertBinding) {
            Button("Cancel", role: .cancel) {
                pendingDeleteSession = nil
            }
            Button("Delete", role: .destructive) {
                guard let session = pendingDeleteSession else { return }
                Task { @MainActor in
                    await deleteConversation(id: session.id)
                }
            }
        } message: {
            let title = pendingDeleteSession?.title ?? "Untitled"
            Text("This will permanently remove '\(title)' and all its messages.")
        }
        .alert("Conversation Action Failed", isPresented: historyErrorBinding) {
            Button("OK", role: .cancel) {
                historyError = nil
            }
        } message: {
            Text(historyError ?? "Unknown error")
        }
    }

    private var bubbleButton: some View {
        Button {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                mode = .panel
            }
        } label: {
            JOIAvatarImage(
                style: bubbleOrbStyle,
                activityLevel: bubbleOrbLevel,
                isActive: voiceEngine.isActive && !voiceEngine.isMuted,
                showPulseRings: bubbleOrbStyle != .firestorm
            )
            .frame(width: 58, height: 58)
            .padding(6)
            .background(
                Circle()
                    .fill(JOIColors.surfaceHigh.opacity(0.85))
            )
            .overlay(
                Circle()
                    .stroke(JOIColors.primary.opacity(0.28), lineWidth: 1.4)
            )
        }
        .buttonStyle(.plain)
        .shadow(
            color: JOIColors.primary.opacity(voiceEngine.isActive ? 0.4 : 0.22),
            radius: voiceEngine.isActive ? 16 : 12,
            y: 8)
        .accessibilityLabel("Open JOI chat")
    }

    private var panel: some View {
        VStack(spacing: 0) {
            panelHeader

            Divider()
                .background(JOIColors.divider)

            if voiceEngine.isCapturing,
               !voiceEngine.capturedTranscript.isEmpty {
                liveTranscriptStrip

                Divider()
                    .background(JOIColors.divider)
            }

            panelContent
        }
        .frame(
            width: panelCurrentWidth,
            height: panelCurrentHeight)
        .background(JOIColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: mode == .panel ? 22 : 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: mode == .panel ? 22 : 18, style: .continuous)
                .stroke(JOIColors.borderSubtle, lineWidth: 1))
        .shadow(color: .black.opacity(0.34), radius: 20, y: 12)
    }

    @ViewBuilder
    private var panelContent: some View {
        if showHistory && mode == .expanded && panelCurrentWidth >= 560 {
            HStack(spacing: 0) {
                chatColumn

                Divider()
                    .background(JOIColors.divider)

                historyColumn
                    .frame(width: historyPaneWidth)
            }
        } else if showHistory {
            VStack(spacing: 0) {
                historyColumn
                    .frame(height: min(220, panelCurrentHeight * 0.42))

                Divider()
                    .background(JOIColors.divider)

                chatColumn
            }
        } else {
            chatColumn
        }
    }

    private var chatColumn: some View {
        ChatView(
            conversationId: selectedConversationId,
            showLiveTranscriptBubble: false,
            onSnapshotChange: { newSnapshot in
                let previousCount = snapshot.messages.count
                snapshot = newSnapshot
                selectedConversationId = newSnapshot.conversationId
                if showHistory,
                   mode == .expanded,
                   !newSnapshot.isStreaming,
                   previousCount != newSnapshot.messages.count {
                    requestSessionList()
                }
            }
        )
    }

    private var historyColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("History")
                    .font(JOITypography.labelMedium)
                    .foregroundStyle(JOIColors.textSecondary)

                Spacer()

                headerButton(systemName: "arrow.clockwise") {
                    requestSessionList()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(JOIColors.surfaceVariant.opacity(0.35))

            Divider()
                .background(JOIColors.divider)

            if router.sessionList.isEmpty {
                VStack(spacing: 10) {
                    Spacer()
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 18))
                        .foregroundStyle(JOIColors.textTertiary.opacity(0.9))
                    Text("No conversations yet")
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textTertiary)
                    Spacer()
                }
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(router.sessionList) { session in
                            historyRow(session)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .background(JOIColors.surface.opacity(0.96))
    }

    private var bubbleOrbLevel: Double {
        guard voiceEngine.isActive && !voiceEngine.isMuted else { return 0.10 }
        return max(0.20, voiceEngine.micLevel)
    }

    private var bubbleOrbStyle: JOIAvatarImage.Style {
        if voiceEngine.isSpeaking || voiceEngine.isCapturing || (voiceEngine.isActive && !voiceEngine.isMuted) {
            return .firestorm
        }
        return .transparent
    }

    private func historyRow(_ session: SessionInfo) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title ?? "Untitled")
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.textPrimary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text("\(session.messageCount) msgs")
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(JOIColors.textTertiary)
                    Text(relativeTime(session.updatedAt))
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(JOIColors.textTertiary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 6)

            Button {
                pendingDeleteSession = session
            } label: {
                Group {
                    if deletingConversationId == session.id {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(JOIColors.error.opacity(0.85))
                            .scaleEffect(0.72)
                    } else {
                        Image(systemName: "trash")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(JOIColors.error.opacity(0.9))
                    }
                }
                .frame(width: 24, height: 24)
                .background(JOIColors.error.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isDeletingConversation)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            selectedConversationId = session.id
            if mode == .closed {
                mode = .panel
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            activeConversationId == session.id
                ? JOIColors.primary.opacity(0.1)
                : Color.clear)
    }

    private var liveTranscriptStrip: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(JOIColors.primary)

            Text(voiceEngine.capturedTranscript)
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(JOIColors.surfaceVariant.opacity(0.5))
    }

    private var panelHeader: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                JOIAvatarImage(
                    style: bubbleOrbStyle,
                    activityLevel: bubbleOrbLevel,
                    isActive: voiceEngine.isActive && !voiceEngine.isMuted,
                    showPulseRings: bubbleOrbStyle != .firestorm
                )
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 1) {
                    Text("JOI")
                        .font(JOITypography.labelLarge)
                        .foregroundStyle(JOIColors.textPrimary)

                    Text(voiceSubtitle)
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(
                            voiceEngine.isError
                                ? JOIColors.error.opacity(0.9)
                                : (voiceEngine.isActive ? JOIColors.primary : JOIColors.textSecondary))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 6)

            if !snapshot.messages.isEmpty {
                headerButton(
                    systemName: debugCopied ? "checkmark" : "ladybug.fill",
                    active: debugCopied)
                {
                    copyDebugPayload()
                }
            }

            headerButton(
                systemName: "clock.arrow.circlepath",
                active: showHistory)
            {
                showHistory.toggle()
            }

            if voiceEngine.isActive {
                headerButton(
                    systemName: voiceEngine.isMuted ? "mic.slash.fill" : "mic.fill",
                    active: !voiceEngine.isMuted)
                {
                    if voiceEngine.isMuted {
                        voiceEngine.unmute()
                    } else {
                        voiceEngine.mute()
                    }
                }
            }

            headerButton(
                systemName: voiceEngine.isActive ? "waveform.circle.fill" : "waveform.circle",
                active: voiceEngine.isActive)
            {
                if voiceEngine.isActive {
                    voiceEngine.stop()
                } else {
                    Task { @MainActor in
                        await voiceEngine.start()
                    }
                }
            }
            .disabled(webSocket.state != .connected)

            headerButton(systemName: "plus") {
                selectedConversationId = nil
            }

            headerButton(
                systemName: mode == .panel
                    ? "arrow.up.left.and.arrow.down.right"
                    : "arrow.down.right.and.arrow.up.left")
            {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                    mode = mode == .panel ? .expanded : .panel
                }
            }

            headerButton(systemName: "xmark") {
                withAnimation(.spring(response: 0.26, dampingFraction: 0.9)) {
                    mode = .closed
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(JOIColors.surfaceVariant.opacity(0.72))
    }

    private func headerButton(
        systemName: String,
        active: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active ? JOIColors.primary : JOIColors.textSecondary)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(active ? JOIColors.primary.opacity(0.12) : JOIColors.surface))
        }
        .buttonStyle(.plain)
    }

    private var panelWidth: CGFloat {
        min(420, max(260, size.width - 24))
    }

    private var panelHeight: CGFloat {
        min(max(320, (size.height - 24) * 0.76), max(320, size.height - 12))
    }

    private var expandedWidth: CGFloat {
        max(260, size.width - 12)
    }

    private var expandedHeight: CGFloat {
        max(260, size.height - 12)
    }

    private var panelCurrentWidth: CGFloat {
        mode == .panel ? panelWidth : expandedWidth
    }

    private var panelCurrentHeight: CGFloat {
        mode == .panel ? panelHeight : expandedHeight
    }

    private var historyPaneWidth: CGFloat {
        min(260, max(170, panelCurrentWidth * 0.38))
    }

    private var activeConversationId: String? {
        selectedConversationId ?? snapshot.conversationId
    }

    private func requestSessionList() {
        webSocket.send(type: .sessionList)
    }

    private var deleteAlertBinding: Binding<Bool> {
        Binding(
            get: { pendingDeleteSession != nil },
            set: { shouldShow in
                if !shouldShow { pendingDeleteSession = nil }
            }
        )
    }

    private var historyErrorBinding: Binding<Bool> {
        Binding(
            get: { historyError != nil },
            set: { shouldShow in
                if !shouldShow { historyError = nil }
            }
        )
    }

    @MainActor
    private func deleteConversation(id: String) async {
        guard !isDeletingConversation else { return }
        guard let url = conversationDeleteURL(id: id) else {
            historyError = "Invalid gateway URL configuration."
            pendingDeleteSession = nil
            return
        }

        isDeletingConversation = true
        deletingConversationId = id
        defer {
            isDeletingConversation = false
            deletingConversationId = nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                historyError = "Invalid server response."
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                if let body, !body.isEmpty {
                    historyError = "Delete failed (\(http.statusCode)): \(body)"
                } else {
                    historyError = "Delete failed (\(http.statusCode))."
                }
                return
            }

            if selectedConversationId == id {
                selectedConversationId = nil
            }
            pendingDeleteSession = nil
            requestSessionList()
        } catch {
            historyError = error.localizedDescription
        }
    }

    private func conversationDeleteURL(id: String) -> URL? {
        let wsURL = UserDefaults.standard.string(forKey: "gatewayURL")
            ?? "ws://localhost:3100/ws"
        guard var comps = URLComponents(string: wsURL) else { return nil }
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id

        if comps.scheme == "ws" {
            comps.scheme = "http"
        } else if comps.scheme == "wss" {
            comps.scheme = "https"
        }

        var basePath = comps.path
        if basePath.hasSuffix("/ws") {
            basePath = String(basePath.dropLast(3))
        }
        if basePath.hasSuffix("/") && basePath.count > 1 {
            basePath.removeLast()
        }
        if basePath.isEmpty || basePath == "/" {
            comps.path = "/api/conversations/\(encodedId)"
        } else {
            comps.path = basePath + "/api/conversations/\(encodedId)"
        }
        return comps.url
    }

    private func relativeTime(_ iso: String) -> String {
        guard let date = Self.iso8601.date(from: iso) else { return "now" }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: .now)
    }

    private func copyDebugPayload() {
        var payload: [String: Any] = [
            "conversationId": activeConversationId as Any,
            "wsState": connectionLabel(webSocket.state),
            "voice": [
                "state": voiceEngine.state,
                "statusText": voiceEngine.statusText,
                "isMuted": voiceEngine.isMuted,
                "isActive": voiceEngine.isActive
            ],
            "messages": snapshot.messages.map { messagePayload($0) }
        ]
        if let error = voiceEngine.errorMessage, !error.isEmpty {
            payload["voiceError"] = error
        }

        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.prettyPrinted, .sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else { return }

        #if os(iOS)
        UIPasteboard.general.string = text
        #endif

        debugCopied = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            debugCopied = false
        }
    }

    private func messagePayload(_ message: ChatUIMessage) -> [String: Any] {
        var payload: [String: Any] = [
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "isStreaming": message.isStreaming,
            "isError": message.isError,
            "createdAt": Self.iso8601.string(from: message.createdAt)
        ]
        if let model = message.model {
            payload["model"] = model
        }
        if let provider = message.provider {
            payload["provider"] = provider
        }
        if let toolModel = message.toolModel {
            payload["toolModel"] = toolModel
        }
        if let toolProvider = message.toolProvider {
            payload["toolProvider"] = toolProvider
        }
        if !message.plannedSteps.isEmpty {
            payload["plannedSteps"] = message.plannedSteps
        }
        if !message.toolCalls.isEmpty {
            payload["toolCalls"] = message.toolCalls.map { call in
                var item: [String: Any] = [
                    "id": call.id,
                    "name": call.name,
                    "isError": call.isError
                ]
                if let duration = call.durationMs {
                    item["durationMs"] = duration
                }
                if let startedAt = call.startedAt {
                    item["startedAt"] = Self.iso8601.string(from: startedAt)
                }
                if let input = call.input?.value {
                    item["input"] = input
                }
                if let result = call.result?.value {
                    item["result"] = result
                }
                return item
            }
        }
        if let usage = message.usage {
            var usagePayload: [String: Any] = [
                "inputTokens": usage.inputTokens,
                "outputTokens": usage.outputTokens
            ]
            if let cache = usage.voiceCache {
                var cachePayload: [String: Any] = [:]
                if let cacheHits = cache.cacheHits { cachePayload["cacheHits"] = cacheHits }
                if let cacheMisses = cache.cacheMisses { cachePayload["cacheMisses"] = cacheMisses }
                if let segments = cache.segments { cachePayload["segments"] = segments }
                if let hitRate = cache.hitRate { cachePayload["hitRate"] = hitRate }
                if !cachePayload.isEmpty {
                    usagePayload["voiceCache"] = cachePayload
                }
            }
            payload["usage"] = usagePayload
        }
        if let latencyMs = message.latencyMs {
            payload["latencyMs"] = latencyMs
        }
        if let ttftMs = message.ttftMs {
            payload["ttftMs"] = ttftMs
        }
        if let costUsd = message.costUsd {
            payload["costUsd"] = costUsd
        }
        if let gatewayId = message.gatewayMessageId {
            payload["gatewayMessageId"] = gatewayId
        }
        return payload
    }

    private func connectionLabel(_ state: WebSocketClient.ConnectionState) -> String {
        switch state {
        case .connected:
            return "connected"
        case .connecting:
            return "connecting"
        case .reconnecting:
            return "reconnecting"
        case .disconnected:
            return "disconnected"
        }
    }

    private var voiceSubtitle: String {
        if voiceEngine.isError {
            return voiceEngine.errorMessage ?? "Voice error"
        }
        if !voiceEngine.isActive {
            return "Personal Assistant"
        }
        if voiceEngine.isMuted {
            return "Muted"
        }
        if voiceEngine.isSpeaking {
            return "Speaking..."
        }
        if voiceEngine.isCapturing {
            return "Listening..."
        }
        return voiceEngine.statusText
    }

    private static let iso8601 = ISO8601DateFormatter()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()
}

private extension ChatDebugSnapshot {
    static let empty = ChatDebugSnapshot(
        conversationId: nil,
        isStreaming: false,
        messages: [])
}
