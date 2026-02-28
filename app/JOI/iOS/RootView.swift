import SwiftUI
#if os(iOS)
import UIKit
#endif

@MainActor
struct RootView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("gatewayURL") private var gatewayURL = ""

    @State private var selectedConversationId: String?
    @State private var showSettings = false
    @State private var showDrawer = false
    @State private var sourceChips: [SourceChipDescriptor] = []
    @State private var connectivityDiagnostics: GatewayURLResolver.ConnectivityDiagnostics?
    @State private var connectivityHintMessage: String?
    @State private var isRunningConnectivityCheck = false
    @State private var isRunningConnectivityRecovery = false
    @State private var lastConnectivityCheckAt = Date.distantPast

    var body: some View {
        ZStack(alignment: .leading) {
            backgroundLayer

            VStack(spacing: 0) {
                topBar

                if webSocket.state != .connected || webSocket.lastError != nil {
                    ConnectionBanner(state: webSocket.state, error: webSocket.lastError)
                        .withStartupGrace()
                }

                if shouldShowRoadModeAssistBanner {
                    roadModeAssistBanner
                        .padding(.horizontal, 12)
                        .padding(.top, 6)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                ChatView(
                    conversationId: selectedConversationId,
                    onSnapshotChange: { snapshot in
                        sourceChips = SourceChipCatalog.topBarSources(
                            from: snapshot.messages,
                            isStreaming: snapshot.isStreaming)
                    },
                    onNewConversation: {
                        selectedConversationId = nil
                    }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            if showDrawer {
                Color.black.opacity(0.46)
                    .ignoresSafeArea()
                    .onTapGesture {
                        closeDrawer()
                    }
                    .transition(.opacity)

                IOSConversationDrawer(
                    selectedConversationId: $selectedConversationId,
                    width: drawerWidth,
                    onClose: {
                        closeDrawer()
                    },
                    onOpenSettings: {
                        closeDrawer()
                        showSettings = true
                    }
                )
                .environment(webSocket)
                .environment(router)
                .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.spring(response: 0.28, dampingFraction: 0.9), value: showDrawer)
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .onAppear {
            requestSessionList()
            Task { @MainActor in
                await refreshConnectivityDiagnostics(force: true)
            }
        }
        .onChange(of: showDrawer) { _, isOpen in
            if isOpen {
                requestSessionList()
            }
        }
        .onChange(of: webSocket.state) { _, newState in
            if newState != .connected {
                Task { @MainActor in
                    await refreshConnectivityDiagnostics(force: false)
                }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { @MainActor in
                    await reconnectUsingResolvedGateway(forceRouteRefresh: true)
                    await refreshConnectivityDiagnostics(force: true)
                }
            }
        }
        .tint(JOIColors.primary)
    }

    private var drawerWidth: CGFloat {
        min(max(288, sceneWidth * 0.82), 360)
    }

    private var sceneWidth: CGFloat {
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first else {
            return 390
        }
        if #available(iOS 26.0, *) {
            return windowScene.coordinateSpace.bounds.width
        }
        return windowScene.screen.bounds.width
    }

    private var backgroundLayer: some View {
        LinearGradient(
            colors: [
                JOIColors.background,
                Color(hex: 0x2A130D),
                Color(hex: 0x3D1A10)
            ],
            startPoint: .topLeading,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var topBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 14) {
                chromeButton(systemName: "line.3.horizontal") {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                        showDrawer = true
                    }
                }

                Spacer(minLength: 8)

                VStack(spacing: 1) {
                    Text("JOI 4.6")
                        .font(.system(size: 27, weight: .semibold, design: .serif))
                        .foregroundStyle(JOIColors.textPrimary)

                    Text(statusSubtitle)
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(JOIColors.textSecondary)
                }

                Spacer(minLength: 8)

                chromeButton(systemName: voiceModeIconName, isActive: isVoiceModeButtonActive) {
                    Task { @MainActor in
                        if voiceEngine.isActive {
                            voiceEngine.stop()
                        } else {
                            await voiceEngine.start()
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 4)

            if !sourceChips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(sourceChips) { chip in
                            SourceTopBarChip(descriptor: chip)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .scrollIndicators(.hidden)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeOut(duration: 0.22), value: sourceChips)
        .padding(.bottom, 8)
    }

    private func chromeButton(systemName: String, isActive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(isActive ? JOIColors.secondary : JOIColors.textSecondary)
                .frame(width: 34, height: 34)
                .background(
                    Circle()
                        .fill((isActive ? JOIColors.secondary.opacity(0.16) : JOIColors.surface.opacity(0.84)))
                )
                .overlay(
                    Circle()
                        .stroke((isActive ? JOIColors.secondary.opacity(0.38) : JOIColors.border.opacity(0.7)), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var isVoiceModeButtonActive: Bool {
        voiceEngine.isActive && !voiceEngine.isMuted
    }

    private var voiceModeIconName: String {
        isVoiceModeButtonActive ? "mic.fill" : "mic"
    }

    private var statusSubtitle: String {
        if voiceEngine.isError {
            return withRoute("Voice reconnect needed")
        }
        if voiceEngine.isMuted {
            return withRoute("Mic Off")
        }
        switch voiceEngine.state {
        case "speaking":
            return withRoute("Speaking")
        case "active":
            return withRoute("Mic On")
        case "connecting":
            return withRoute("Mic Connecting")
        default:
            return withRoute("Mic Off")
        }
    }

    private func withRoute(_ text: String) -> String {
        if let modeRaw = voiceEngine.livekitNetworkMode?.trimmingCharacters(in: .whitespacesAndNewlines),
           !modeRaw.isEmpty {
            return "\(text) - \(modeRaw.uppercased())"
        }

        let inferredMode = GatewayURLResolver.inferredCurrentRouteMode()
            ?? inferredModeFromGateway
        guard let inferredMode, !inferredMode.isEmpty else {
            return text
        }
        return "\(text) - \(inferredMode.uppercased())"
    }

    private var inferredModeFromGateway: String? {
        guard let host = URL(string: gatewayURL)?.host?.lowercased() else {
            return nil
        }
        if host == "localhost" || host == "::1" || host.hasPrefix("127.") {
            return "local"
        }
        if host.hasPrefix("192.168.") || host.hasPrefix("10.") {
            return "home"
        }
        let octets = host.split(separator: ".")
        if octets.count == 4,
           let first = Int(octets[0]),
           let second = Int(octets[1]),
           first == 100,
           second >= 64,
           second <= 127 {
            return "road"
        }
        if host.hasSuffix(".ts.net") {
            return "road"
        }
        return nil
    }

    private var shouldShowRoadModeAssistBanner: Bool {
        guard let diagnostics = connectivityDiagnostics else { return false }
        return diagnostics.recommendation == .enableTailscale
    }

    private var roadModeAssistBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "network.slash")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.orange)
                Text("Road mode needs Tailscale VPN")
                    .font(JOITypography.labelMedium)
                    .foregroundStyle(JOIColors.textPrimary)
                Spacer(minLength: 6)
                if isRunningConnectivityCheck {
                    ProgressView()
                        .controlSize(.small)
                }
                if isRunningConnectivityRecovery {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            Text(connectivityDiagnostics?.guidance ?? "Enable Tailscale VPN for road access.")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)

            HStack(spacing: 8) {
                Button("Open Tailscale") {
                    openTailscaleFromBanner()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)

                Button("VPN Settings") {
                    openVPNSettingsFromBanner()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Button("Retry") {
                    retryConnectivityFromBanner()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isRunningConnectivityCheck || isRunningConnectivityRecovery)
            }

            if let connectivityHintMessage {
                Text(connectivityHintMessage)
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.textSecondary)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(hex: 0x2A1C12).opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.orange.opacity(0.45), lineWidth: 1)
        )
    }

    @MainActor
    private func refreshConnectivityDiagnostics(force: Bool) async {
        guard !isRunningConnectivityCheck else { return }
        if !force, Date().timeIntervalSince(lastConnectivityCheckAt) < 8 {
            return
        }
        isRunningConnectivityCheck = true
        defer {
            isRunningConnectivityCheck = false
            lastConnectivityCheckAt = Date()
        }
        let diagnostics = await GatewayURLResolver.diagnoseConnectivity()
        connectivityDiagnostics = diagnostics
        if diagnostics.recommendation != .enableTailscale {
            connectivityHintMessage = nil
        }
    }

    @MainActor
    private func openTailscaleFromBanner() {
        Task { @MainActor in
            let opened = await openFirstAvailableURL(from: [
                "tailscale://",
                "tailscale://up",
                "https://apps.apple.com/app/tailscale/id1475387142",
            ])
            if opened {
                connectivityHintMessage = "Opened Tailscale. Enable VPN if needed, then return to JOI."
            } else {
                connectivityHintMessage = "Tailscale app was not found. Opening VPN settings."
                await openVPNSettingsFromBannerInternal()
            }
        }
    }

    @MainActor
    private func openVPNSettingsFromBanner() {
        Task { @MainActor in
            await openVPNSettingsFromBannerInternal()
            await refreshConnectivityDiagnostics(force: true)
        }
    }

    @MainActor
    private func openVPNSettingsFromBannerInternal() async {
        let opened = await openFirstAvailableURL(from: [
            "App-Prefs:root=VPN",
            "App-Prefs:root=General&path=VPN",
            "prefs:root=VPN",
            "prefs:root=General&path=VPN",
        ])
        if opened {
            connectivityHintMessage = "Opened iOS Settings. Enable Tailscale VPN and return to JOI."
        } else {
            connectivityHintMessage = "Open iOS Settings > VPN manually, then tap Retry."
        }
    }

    @MainActor
    private func retryConnectivityFromBanner() {
        Task { @MainActor in
            guard !isRunningConnectivityRecovery else { return }
            isRunningConnectivityRecovery = true
            defer { isRunningConnectivityRecovery = false }
            await reconnectUsingResolvedGateway(forceRouteRefresh: true)
            await refreshConnectivityDiagnostics(force: true)
        }
    }

    @MainActor
    private func reconnectUsingResolvedGateway(forceRouteRefresh: Bool) async {
        let previousGateway = GatewayURLResolver.configuredGatewayURL()
        let resolvedGateway = await GatewayURLResolver.resolveStartupGatewayURL(forceRefresh: forceRouteRefresh)

        if gatewayURL != resolvedGateway || previousGateway != resolvedGateway {
            gatewayURL = resolvedGateway
            GatewayURLResolver.persistGatewayURL(resolvedGateway)
        }

        if previousGateway == resolvedGateway,
           webSocket.state == .connected || webSocket.state == .connecting || webSocket.state == .reconnecting {
            return
        }

        webSocket.disconnect()
        webSocket.connect(to: resolvedGateway)
    }

    @MainActor
    private func openFirstAvailableURL(from rawURLs: [String]) async -> Bool {
        for raw in rawURLs {
            guard let url = URL(string: raw) else { continue }
            let opened = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                UIApplication.shared.open(url, options: [:]) { success in
                    continuation.resume(returning: success)
                }
            }
            if opened {
                return true
            }
        }
        return false
    }

    private func closeDrawer() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            showDrawer = false
        }
    }

    private func requestSessionList() {
        webSocket.send(type: .sessionList)
    }
}

@MainActor
private struct IOSConversationDrawer: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router

    @Binding var selectedConversationId: String?
    let width: CGFloat
    let onClose: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            navStrip
            recentsHeader

            if router.sessionList.isEmpty {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(router.sessionList) { session in
                            row(for: session)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }

            footer
        }
        .frame(width: width)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            LinearGradient(
                colors: [Color(hex: 0x18191E), Color(hex: 0x15161B)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(Color.white.opacity(0.06))
                .frame(width: 1)
        }
        .onAppear {
            webSocket.send(type: .sessionList)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("JOI")
                .font(.system(size: 34, weight: .semibold, design: .serif))
                .foregroundStyle(JOIColors.textPrimary)

            Spacer()

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(JOIColors.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(
                        Circle()
                            .fill(JOIColors.surface.opacity(0.85))
                    )
                    .overlay(
                        Circle()
                            .stroke(JOIColors.border.opacity(0.7), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var navStrip: some View {
        VStack(spacing: 8) {
            DrawerNavButton(systemName: "bubble.left.and.bubble.right", title: "Chats") {
                onClose()
            }
            DrawerNavButton(systemName: "gearshape", title: "Settings") {
                onOpenSettings()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var recentsHeader: some View {
        HStack {
            Text("Recents")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textTertiary)
            Spacer()
            ConnectionStatusPill(state: webSocket.state)
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 10)
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 28))
                .foregroundStyle(JOIColors.textTertiary)
            Text("No conversations yet")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
            Spacer(minLength: 10)
        }
    }

    private var footer: some View {
        HStack {
            Button(action: {
                selectedConversationId = nil
                onClose()
            }) {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("New Chat")
                        .lineLimit(1)
                }
                .font(JOITypography.labelMedium)
                .foregroundStyle(JOIColors.textOnPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(JOIColors.secondary)
                )
            }
            .buttonStyle(.plain)

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func row(for session: SessionInfo) -> some View {
        Button(action: {
            selectedConversationId = session.id
            onClose()
        }) {
            VStack(alignment: .leading, spacing: 5) {
                Text(session.title ?? "Untitled")
                    .font(JOITypography.bodyLarge)
                    .foregroundStyle(JOIColors.textPrimary)
                    .lineLimit(1)

                if let lastMessage = session.lastMessage, !lastMessage.isEmpty {
                    Text(lastMessage)
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textSecondary)
                        .lineLimit(1)
                }

                Text(relativeTime(session.updatedAt))
                    .font(JOITypography.labelSmall)
                    .foregroundStyle(JOIColors.textTertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                selectedConversationId == session.id
                    ? JOIColors.primary.opacity(0.12)
                    : Color.clear
            )
        }
        .buttonStyle(.plain)
    }

    private func relativeTime(_ raw: String) -> String {
        guard let date = parseISODate(raw) else { return "Recently" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func parseISODate(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }
}

private struct DrawerNavButton: View {
    let systemName: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemName)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(JOIColors.textSecondary)
                    .frame(width: 18)
                Text(title)
                    .font(JOITypography.bodyLarge)
                    .foregroundStyle(JOIColors.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(JOIColors.surface.opacity(0.55))
            )
        }
        .buttonStyle(.plain)
    }
}
