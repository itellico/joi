import SwiftUI
#if os(iOS)
import UIKit
#endif

struct SettingsView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(PushService.self) private var pushService
    @Environment(VoiceEngine.self) private var voiceEngine
    @AppStorage("gatewayURL") private var gatewayURL = ""
    @AppStorage("livekitNetworkMode") private var livekitNetworkMode = "auto"
    @AppStorage("recordingWindowStyle") private var recordingWindowStyle = "classic"
    @AppStorage("talkingStyle") private var talkingStyle = "default"
    @AppStorage("voiceAutoGainEnabled") private var voiceAutoGainEnabled = true
    @AppStorage("voiceNoiseSuppressionEnabled") private var voiceNoiseSuppressionEnabled = true
    @AppStorage("voiceSilenceRemovalEnabled") private var voiceSilenceRemovalEnabled = true
    @AppStorage("globalToggleShortcut") private var globalToggleShortcut = "Command+UpArrow"
    @AppStorage(ChatViewModel.audioTranscriberModelDefaultsKey)
    private var audioTranscriberModel = ChatViewModel.defaultAudioTranscriberModel
    @State private var editingURL = ""
    @State private var livekitConfig: LiveKitConfigInfo?
    @State private var livekitError: String?
    @State private var customPronunciations: [LocalVocabularyRule] = []
    @State private var isReconnectingGateway = false
    @State private var isRefreshingLiveKitConfig = false
    @State private var isStartingVoiceEngine = false
    @State private var isRequestingNotifications = false
    @State private var gatewayBusyMessage: String?
    #if os(iOS)
    @State private var connectivityDiagnostics: GatewayURLResolver.ConnectivityDiagnostics?
    @State private var isRunningConnectivityCheck = false
    @State private var connectivityActionMessage: String?
    #endif

    #if os(iOS)
    @Environment(\.dismiss) private var dismiss
    #endif

    #if os(macOS)
    @State private var selectedPane: SettingsPane = .home
    #endif

    var body: some View {
        Group {
            #if os(macOS)
            macSettings
            #else
            iosSettings
            #endif
        }
        .onAppear {
            if !audioTranscriberModelChoices.contains(audioTranscriberModel) {
                audioTranscriberModel = ChatViewModel.defaultAudioTranscriberModel
            }
            if livekitNetworkMode.lowercased() != "auto" {
                livekitNetworkMode = "auto"
            }
            enforceLiveKitEngine()
            customPronunciations = LocalVocabularyStore.load()
            let immediateGatewayURL = GatewayURLResolver.configuredGatewayURL()
            if gatewayURL != immediateGatewayURL {
                gatewayURL = immediateGatewayURL
                GatewayURLResolver.persistGatewayURL(immediateGatewayURL)
            }
            editingURL = gatewayURL
            Task { @MainActor in
                let resolvedGatewayURL = await GatewayURLResolver.resolveStartupGatewayURL()
                if gatewayURL != resolvedGatewayURL {
                    gatewayURL = resolvedGatewayURL
                    GatewayURLResolver.persistGatewayURL(resolvedGatewayURL)
                }
                editingURL = gatewayURL
                await fetchLiveKitConfig()
                #if os(iOS)
                await runConnectivityCheck()
                #endif
            }
        }
        .onChange(of: customPronunciations) { _, _ in
            LocalVocabularyStore.save(customPronunciations)
        }
        .onChange(of: livekitNetworkMode) { _, newValue in
            if newValue.lowercased() != "auto" {
                livekitNetworkMode = "auto"
                return
            }
            Task {
                await fetchLiveKitConfig()
                #if os(iOS)
                await runConnectivityCheck()
                #endif
            }
        }
    }

    #if os(iOS)
    private var iosSettings: some View {
        NavigationStack {
            Form {
                Section("Gateway") {
                    TextField("ws://...", text: $editingURL)
                        .font(.system(.body, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    LabeledContent("LiveKit Route", value: "Auto (device-detected)")
                    Text("On iPhone, localhost is ignored. JOI uses Mini Home/Road endpoints automatically.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        Task { @MainActor in
                            await reconnectGateway()
                        }
                    } label: {
                        actionButtonLabel(isReconnectingGateway ? "Reconnecting..." : "Reconnect", isLoading: isReconnectingGateway)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isReconnectingGateway)

                    Button {
                        Task { @MainActor in
                            await refreshLiveKitConfigFromButton()
                        }
                    } label: {
                        actionButtonLabel(isRefreshingLiveKitConfig ? "Refreshing..." : "Refresh LiveKit Config", isLoading: isRefreshingLiveKitConfig)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isReconnectingGateway || isRefreshingLiveKitConfig)

                    if let gatewayBusyMessage {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text(gatewayBusyMessage)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Connectivity Assistant") {
                    if let diagnostics = connectivityDiagnostics {
                        LabeledContent("Detected", value: diagnostics.detectedPathLabel)
                        LabeledContent("Recommended", value: diagnostics.recommendedMode.uppercased())
                        LabeledContent("Home Route", value: diagnostics.homeReachable ? "Reachable" : "Unreachable")
                        LabeledContent("Road Route", value: diagnostics.roadReachable ? "Reachable" : "Unreachable")
                        Text(diagnostics.guidance)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Checking home/road connectivity...")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button {
                        Task { @MainActor in
                            await runConnectivityCheck()
                        }
                    } label: {
                        actionButtonLabel("Run Connectivity Check", isLoading: isRunningConnectivityCheck)
                    }
                    .disabled(isRunningConnectivityCheck)

                    Button {
                        Task { @MainActor in
                            await applyRecommendedRoute()
                        }
                    } label: {
                        actionButtonLabel("Apply Recommended Route", isLoading: isReconnectingGateway)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isReconnectingGateway)

                    if connectivityNeedsRoadHelp {
                        Button("Open Tailscale") {
                            openTailscaleApp()
                        }
                        .buttonStyle(.bordered)

                        Button("Open VPN Settings") {
                            openVPNSettings()
                        }
                        .buttonStyle(.bordered)
                    }

                    if let connectivityActionMessage {
                        Text(connectivityActionMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Voice") {
                    LabeledContent("Engine", value: "LiveKit")
                    LabeledContent("Status", value: voiceEngine.statusText)
                    LabeledContent("LiveKit", value: liveKitConnectionLabel)
                    LabeledContent("Microphone", value: microphoneStatusLabel)
                    if let message = voiceEngine.errorMessage,
                       !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Picker("Voice Mode", selection: Binding(
                        get: { voiceEngine.livekit.voiceMode },
                        set: { voiceEngine.livekit.voiceMode = $0 }
                    )) {
                        Text("Always On").tag(LiveKitVoicePipeline.VoiceMode.alwaysOn)
                        Text("Wake Word").tag(LiveKitVoicePipeline.VoiceMode.wakeWord)
                    }
                    .pickerStyle(.segmented)

                    Button {
                        Task { @MainActor in
                            await toggleVoiceFromButton()
                        }
                    } label: {
                        actionButtonLabel(
                            voiceEngine.isActive ? "Stop Voice" : "Start Voice",
                            isLoading: isStartingVoiceEngine
                        )
                    }
                    .disabled(isStartingVoiceEngine)

                    Button(voiceEngine.isMuted ? "Unmute" : "Mute") {
                        if voiceEngine.isMuted {
                            voiceEngine.unmute()
                        } else {
                            voiceEngine.mute()
                        }
                    }

                    Picker("Talking Style", selection: $talkingStyle) {
                        Text("Default").tag("default")
                        Text("Transparent").tag("transparent")
                        Text("Warm").tag("warm")
                    }

                    Picker("Audio Transcriber", selection: $audioTranscriberModel) {
                        ForEach(audioTranscriberModelChoices, id: \.self) { model in
                            Text(transcriberModelLabel(for: model)).tag(model)
                        }
                    }
                    .pickerStyle(.menu)

                    Text("Used for audio-file attachments from chat input.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("LiveKit") {
                    Text("Reconnect/Refresh validates gateway route and config. Voice succeeds only when Start Voice connects to the LiveKit room.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let config = livekitConfig {
                        LabeledContent("Server", value: config.url.isEmpty ? "Not configured" : config.url)
                        if let mode = config.networkMode {
                            LabeledContent("Route Mode", value: mode.capitalized)
                        }
                        if let target = config.networkTargetIp, !target.isEmpty {
                            LabeledContent("Route Target", value: target)
                        }
                        LabeledContent("API Credentials", value: config.hasApiKey && config.hasApiSecret ? "Configured" : "Missing")
                        LabeledContent("STT", value: "\(config.sttProvider.capitalized) / \(config.sttModel)")
                        LabeledContent("Deepgram Key", value: config.hasDeepgramKey ? "Configured" : "Missing")
                        LabeledContent("TTS", value: "\(config.ttsProvider.capitalized) / \(config.ttsModel)")
                        LabeledContent("Cartesia Key", value: config.hasCartesiaKey ? "Configured" : "Missing")

                        if !config.ttsVoice.isEmpty {
                            LabeledContent("Voice ID", value: config.ttsVoice)
                        }
                        if let cacheEnabled = config.ttsCacheEnabled {
                            LabeledContent("TTS Cache", value: cacheEnabled ? "Enabled" : "Disabled")
                        }
                        if let cachePrefix = config.ttsCachePrefix, !cachePrefix.isEmpty {
                            LabeledContent("Cache Prefix", value: cachePrefix)
                        }
                        if let cacheTtl = config.ttsCacheRedisTtlSec {
                            LabeledContent("Cache TTL", value: "\(cacheTtl)s")
                        }
                    } else if let livekitError {
                        Text(livekitError)
                            .foregroundStyle(.red)
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Loading configuration...")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Connection") {
                    LabeledContent("WebSocket", value: connectionStateLabel)
                    if let error = webSocket.lastError, !error.isEmpty {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }

                Section("Notifications") {
                    LabeledContent("Permission", value: pushService.permissionGranted ? "Allowed" : "Not Allowed")
                    LabeledContent(
                        "APNs Registered",
                        value: pushService.pushCapabilityAvailable
                            ? (pushService.isRegistered ? "Yes" : "No")
                            : "Not supported on this runtime")
                    LabeledContent("Remote Push", value: pushService.pushCapabilityAvailable ? "Available" : "Unavailable")

                    if !pushService.pushCapabilityAvailable {
                        Text("Remote APNs is unavailable in this build/runtime. For production push, run JOI on a physical iPhone with push entitlements.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if let token = pushService.deviceToken {
                        LabeledContent("Token", value: String(token.prefix(20)) + "...")
                    }

                    if !pushService.permissionGranted {
                        Button {
                            Task { @MainActor in
                                await requestNotificationPermissionFromButton()
                            }
                        } label: {
                            actionButtonLabel("Enable Notifications", isLoading: isRequestingNotifications)
                        }
                        .disabled(isRequestingNotifications)
                    }

                    if let error = pushService.lastError, !error.isEmpty {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }

                Section("About") {
                    LabeledContent("App", value: "JOI")
                    LabeledContent("Version", value: appVersion())
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .preferredColorScheme(.dark)
        }
    }
    #endif

    #if os(macOS)
    private var macSettings: some View {
        NavigationSplitView {
            List(SettingsPane.allCases, selection: $selectedPane) { pane in
                Label(pane.title, systemImage: pane.symbol)
                    .font(JOITypography.bodyMedium)
                    .tag(pane)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .background(JOIColors.surface)
        } detail: {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    switch selectedPane {
                    case .home:
                        gatewaySection
                        connectionSection
                    case .recording:
                        recordingWindowSection
                        voiceSection
                    case .sound:
                        soundSection
                    case .vocabulary:
                        vocabularySection
                    case .shortcuts:
                        shortcutsSection
                    case .livekit:
                        liveKitSection
                    case .notifications:
                        notificationSection
                    case .about:
                        aboutSection
                    }
                }
                .padding(24)
            }
            .background(JOIColors.background)
        }
        .navigationSplitViewStyle(.balanced)
        .background(JOIColors.background)
    }
    #endif

    private var gatewaySection: some View {
        settingsCard(title: "Gateway") {
            TextField("ws://...", text: $editingURL)
                .textFieldStyle(.roundedBorder)
                .font(JOITypography.monoMedium)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()

            HStack(spacing: 10) {
                Button {
                    Task { @MainActor in
                        await reconnectGateway()
                    }
                } label: {
                    actionButtonLabel(isReconnectingGateway ? "Reconnecting..." : "Reconnect", isLoading: isReconnectingGateway)
                }
                .buttonStyle(.borderedProminent)
                .tint(JOIColors.primary)
                .disabled(isReconnectingGateway)

                Button {
                    Task { @MainActor in
                        await refreshLiveKitConfigFromButton()
                    }
                } label: {
                    actionButtonLabel(isRefreshingLiveKitConfig ? "Refreshing..." : "Refresh LiveKit Config", isLoading: isRefreshingLiveKitConfig)
                }
                .buttonStyle(.bordered)
                .disabled(isReconnectingGateway || isRefreshingLiveKitConfig)
            }

            settingRow(label: "LiveKit Route", value: "Auto (device-detected)")
        }
    }

    private var voiceSection: some View {
        settingsCard(title: "Voice", subtitle: "LiveKit cloud voice") {
            settingRow(label: "Engine", value: "LiveKit")
            settingRow(label: "Status", value: voiceEngine.statusText)
            settingRow(label: "LiveKit", value: liveKitConnectionLabel)
            settingRow(label: "Microphone", value: microphoneStatusLabel)

            Picker("Voice Mode", selection: Binding(
                get: { voiceEngine.livekit.voiceMode },
                set: { voiceEngine.livekit.voiceMode = $0 }
            )) {
                Text("Always On").tag(LiveKitVoicePipeline.VoiceMode.alwaysOn)
                Text("Wake Word").tag(LiveKitVoicePipeline.VoiceMode.wakeWord)
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                Button {
                    Task { @MainActor in
                        await toggleVoiceFromButton()
                    }
                } label: {
                    actionButtonLabel(
                        voiceEngine.isActive ? "Stop Voice" : "Start Voice",
                        isLoading: isStartingVoiceEngine
                    )
                }
                .buttonStyle(.borderedProminent)
                .tint(JOIColors.primary)
                .disabled(isStartingVoiceEngine)

                Button(voiceEngine.isMuted ? "Unmute" : "Mute") {
                    if voiceEngine.isMuted {
                        voiceEngine.unmute()
                    } else {
                        voiceEngine.mute()
                    }
                }
                .buttonStyle(.bordered)
            }

            Picker("Talking Style", selection: $talkingStyle) {
                Text("Default").tag("default")
                Text("Transparent").tag("transparent")
                Text("Warm").tag("warm")
            }
            #if os(iOS)
            .pickerStyle(.menu)
            #else
            .pickerStyle(.segmented)
            #endif

            Picker("Audio Transcriber", selection: $audioTranscriberModel) {
                ForEach(audioTranscriberModelChoices, id: \.self) { model in
                    Text(transcriberModelLabel(for: model)).tag(model)
                }
            }
            .pickerStyle(.menu)

            settingRow(label: "Transcriber", value: transcriberModelLabel(for: audioTranscriberModel))
        }
    }

    #if os(macOS)
    private var recordingWindowSection: some View {
        settingsCard(title: "Recording Window", subtitle: "Choose the JOI top-bar panel size") {
            Picker("Style", selection: selectedRecordingWindowStyle) {
                Text("Classic").tag(RecordingWindowStyle.classic)
                Text("Mini").tag(RecordingWindowStyle.mini)
                Text("None").tag(RecordingWindowStyle.none)
            }
            .pickerStyle(.segmented)

            Text("Classic is full chat. Mini is compact. None keeps only a slim panel.")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
        }
    }

    private var soundSection: some View {
        settingsCard(title: "Sound", subtitle: "Input and cleanup behavior") {
            settingRow(label: "Audio Output", value: "System Default")
            Toggle("Auto input gain", isOn: $voiceAutoGainEnabled)
            Toggle("Noise suppression", isOn: $voiceNoiseSuppressionEnabled)
            Toggle("Silence removal", isOn: $voiceSilenceRemovalEnabled)

            Text("These options are stored locally and shown in settings. Audio-pipeline integration is next.")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
        }
    }

    private var vocabularySection: some View {
        settingsCard(title: "Vocabulary", subtitle: "Custom pronunciations loaded from admin config") {
            if let config = livekitConfig {
                let rules = config.pronunciations ?? []
                if rules.isEmpty {
                    Text("No custom pronunciation rules configured.")
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textSecondary)
                } else {
                    ForEach(Array(rules.enumerated()), id: \.offset) { item in
                        let rule = item.element
                        HStack(spacing: 8) {
                            Text(rule.word)
                                .font(JOITypography.bodyMedium)
                                .foregroundStyle(JOIColors.textPrimary)
                            Image(systemName: "arrow.right")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(JOIColors.textTertiary)
                            Text(rule.replacement)
                                .font(JOITypography.bodyMedium)
                                .foregroundStyle(JOIColors.primary)
                            Spacer()
                        }
                    }
                }
            } else if let livekitError {
                Text(livekitError)
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.error)
            } else {
                ProgressView()
                    .controlSize(.small)
            }

            Button {
                Task { @MainActor in
                    await refreshLiveKitConfigFromButton()
                }
            } label: {
                actionButtonLabel("Reload From Admin", isLoading: isRefreshingLiveKitConfig)
            }
            .buttonStyle(.bordered)
            .disabled(isReconnectingGateway || isRefreshingLiveKitConfig)

            Divider()

            HStack {
                Text("Local Vocabulary")
                    .font(JOITypography.labelMedium)
                    .foregroundStyle(JOIColors.textPrimary)
                Spacer()
                Button("Add Entry") {
                    customPronunciations.append(LocalVocabularyRule())
                }
                .buttonStyle(.bordered)
            }

            if customPronunciations.isEmpty {
                Text("No local pronunciation entries yet.")
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.textSecondary)
            } else {
                ForEach($customPronunciations) { $rule in
                    HStack(spacing: 8) {
                        TextField("Word", text: $rule.word)
                            .textFieldStyle(.roundedBorder)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(JOIColors.textTertiary)
                        TextField("Pronounce As", text: $rule.replacement)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            customPronunciations.removeAll { $0.id == rule.id }
                        } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(JOIColors.error)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Text("Local entries are saved on this Mac and can be synced to backend config later.")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
        }
    }

    private var shortcutsSection: some View {
        settingsCard(title: "Keyboard Shortcuts", subtitle: "Global JOI toggle shortcut") {
            Picker("Toggle JOI", selection: selectedShortcutPreset) {
                Text("Command + Up Arrow").tag(ShortcutPreset.commandUpArrow)
                Text("Option + Space").tag(ShortcutPreset.optionSpace)
                Text("Command + Space").tag(ShortcutPreset.commandSpace)
            }
            .pickerStyle(.menu)

            Text("After changing this, close and reopen the top-bar panel to use the new shortcut.")
                .font(JOITypography.bodySmall)
                .foregroundStyle(JOIColors.textSecondary)
        }
    }
    #endif

    private var liveKitSection: some View {
        settingsCard(title: "LiveKit") {
            if let config = livekitConfig {
                settingRow(label: "Server", value: config.url.isEmpty ? "Not configured" : config.url)
                if let networkMode = config.networkMode {
                    settingRow(label: "Route Mode", value: networkMode.capitalized)
                }
                if let networkTargetIp = config.networkTargetIp, !networkTargetIp.isEmpty {
                    settingRow(label: "Route Target", value: networkTargetIp)
                }
                statusRow(label: "API Credentials", ok: config.hasApiKey && config.hasApiSecret)
                settingRow(label: "STT", value: "\(config.sttProvider.capitalized) / \(config.sttModel)")
                statusRow(label: "Deepgram Key", ok: config.hasDeepgramKey)
                settingRow(label: "TTS", value: "\(config.ttsProvider.capitalized) / \(config.ttsModel)")
                statusRow(label: "Cartesia Key", ok: config.hasCartesiaKey)

                if !config.ttsVoice.isEmpty {
                    settingRow(label: "Voice ID", value: config.ttsVoice)
                }

                if let cacheEnabled = config.ttsCacheEnabled {
                    statusRow(label: "TTS Cache", ok: cacheEnabled)
                }
                if let cachePrefix = config.ttsCachePrefix, !cachePrefix.isEmpty {
                    settingRow(label: "Cache Prefix", value: cachePrefix)
                }
                if let cacheTtl = config.ttsCacheRedisTtlSec {
                    settingRow(label: "Cache TTL", value: "\(cacheTtl)s")
                }
            } else if let livekitError {
                Label(livekitError, systemImage: "exclamationmark.triangle.fill")
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.error)
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading configuration...")
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textSecondary)
                }
            }
        }
    }

    private var connectionSection: some View {
        settingsCard(title: "Connection") {
            HStack {
                Text("WebSocket")
                    .font(JOITypography.bodyMedium)
                    .foregroundStyle(JOIColors.textPrimary)
                Spacer()
                ConnectionStatusPill(state: webSocket.state)
            }

            if let error = webSocket.lastError, !error.isEmpty {
                Text(error)
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.error)
            }
        }
    }

    private var notificationSection: some View {
        settingsCard(title: "Notifications") {
            statusRow(label: "Permission", ok: pushService.permissionGranted)
            if pushService.pushCapabilityAvailable {
                statusRow(label: "APNs Registered", ok: pushService.isRegistered)
            } else {
                settingRow(label: "APNs Registered", value: "Not supported on this runtime")
            }
            settingRow(
                label: "Remote Push",
                value: pushService.pushCapabilityAvailable ? "Available" : "Unavailable")

            if let token = pushService.deviceToken {
                settingRow(label: "Token", value: String(token.prefix(20)) + "...")
            }

            if !pushService.permissionGranted {
                Button {
                    Task { @MainActor in
                        await requestNotificationPermissionFromButton()
                    }
                } label: {
                    actionButtonLabel("Enable Notifications", isLoading: isRequestingNotifications)
                }
                .buttonStyle(.bordered)
                .disabled(isRequestingNotifications)
            }

            if let error = pushService.lastError, !error.isEmpty {
                Text(error)
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.error)
            }
        }
    }

    private var aboutSection: some View {
        settingsCard(title: "About") {
            settingRow(label: "App", value: "JOI")
            settingRow(label: "Version", value: appVersion())
        }
    }

    private func settingsCard<Content: View>(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(JOITypography.labelLarge)
                    .foregroundStyle(JOIColors.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textSecondary)
                }
            }

            content()
        }
        .padding(16)
        .background(JOIColors.surface.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(JOIColors.borderSubtle, lineWidth: 1))
    }

    private func settingRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(JOITypography.bodyMedium)
                .foregroundStyle(JOIColors.textSecondary)
            Spacer()
            Text(value)
                .font(JOITypography.bodyMedium)
                .foregroundStyle(JOIColors.textPrimary)
                .lineLimit(1)
                .multilineTextAlignment(.trailing)
        }
    }

    private func statusRow(label: String, ok: Bool) -> some View {
        HStack {
            Text(label)
                .font(JOITypography.bodyMedium)
                .foregroundStyle(JOIColors.textSecondary)
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(ok ? Color.green : JOIColors.error)
                    .frame(width: 8, height: 8)
                Text(ok ? "Configured" : "Missing")
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(ok ? JOIColors.textPrimary : JOIColors.error)
            }
        }
    }

    #if os(macOS)
    private var selectedRecordingWindowStyle: Binding<RecordingWindowStyle> {
        Binding(
            get: { RecordingWindowStyle(rawValue: recordingWindowStyle) ?? .classic },
            set: { recordingWindowStyle = $0.rawValue })
    }

    private var selectedShortcutPreset: Binding<ShortcutPreset> {
        Binding(
            get: { ShortcutPreset(rawValue: globalToggleShortcut) ?? .commandUpArrow },
            set: { globalToggleShortcut = $0.rawValue })
    }
    #endif

    private func enforceLiveKitEngine() {
        if voiceEngine.activeEngine != .livekit {
            voiceEngine.switchEngine(to: .livekit)
        }
    }

    @MainActor
    private func reconnectGateway() async {
        guard !isReconnectingGateway else { return }
        isReconnectingGateway = true
        gatewayBusyMessage = "Reconnecting gateway..."
        let startedAt = Date()
        defer {
            gatewayBusyMessage = nil
            isReconnectingGateway = false
        }

        let manualURL = editingURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if let normalized = GatewayURLResolver.normalizedManualGatewayURL(manualURL) {
            gatewayURL = normalized
        } else {
            gatewayURL = GatewayURLResolver.configuredGatewayURL()
        }
        GatewayURLResolver.persistGatewayURL(gatewayURL)
        editingURL = gatewayURL
        webSocket.disconnect()
        webSocket.connect(to: gatewayURL)
        await fetchLiveKitConfig()
        #if os(iOS)
        await runConnectivityCheck()
        #endif
        await ensureMinimumBusyTime(since: startedAt)
    }

    @MainActor
    private func refreshLiveKitConfigFromButton() async {
        guard !isRefreshingLiveKitConfig else { return }
        isRefreshingLiveKitConfig = true
        gatewayBusyMessage = "Refreshing LiveKit config..."
        let startedAt = Date()
        defer {
            gatewayBusyMessage = nil
            isRefreshingLiveKitConfig = false
        }
        await fetchLiveKitConfig()
        #if os(iOS)
        await runConnectivityCheck()
        #endif
        await ensureMinimumBusyTime(since: startedAt)
    }

    @MainActor
    private func toggleVoiceFromButton() async {
        if voiceEngine.isActive {
            voiceEngine.stop()
            return
        }
        guard !isStartingVoiceEngine else { return }
        isStartingVoiceEngine = true
        defer { isStartingVoiceEngine = false }
        await voiceEngine.start()
    }

    @MainActor
    private func requestNotificationPermissionFromButton() async {
        guard !isRequestingNotifications else { return }
        isRequestingNotifications = true
        let startedAt = Date()
        defer { isRequestingNotifications = false }
        await pushService.requestPermission()
        await ensureMinimumBusyTime(since: startedAt)
    }

    @MainActor
    private func fetchLiveKitConfig() async {
        livekitError = nil
        do {
            livekitConfig = try await LiveKitConfigService.fetchConfig(
                gatewayURL: gatewayURL,
                networkMode: livekitNetworkMode
            )
        } catch {
            livekitError = error.localizedDescription
        }
    }

    #if os(iOS)
    private var connectivityNeedsRoadHelp: Bool {
        guard let diagnostics = connectivityDiagnostics else { return false }
        switch diagnostics.recommendation {
        case .enableTailscale:
            return true
        default:
            return false
        }
    }

    @MainActor
    private func runConnectivityCheck() async {
        guard !isRunningConnectivityCheck else { return }
        isRunningConnectivityCheck = true
        defer { isRunningConnectivityCheck = false }
        connectivityDiagnostics = await GatewayURLResolver.diagnoseConnectivity()
    }

    @MainActor
    private func applyRecommendedRoute() async {
        guard !isReconnectingGateway else { return }
        if connectivityDiagnostics == nil {
            await runConnectivityCheck()
        }
        guard let diagnostics = connectivityDiagnostics else { return }

        isReconnectingGateway = true
        gatewayBusyMessage = "Applying \(diagnostics.recommendedMode.uppercased()) route..."
        let startedAt = Date()
        defer {
            gatewayBusyMessage = nil
            isReconnectingGateway = false
        }

        gatewayURL = diagnostics.recommendedGatewayURL
        editingURL = gatewayURL
        GatewayURLResolver.persistGatewayURL(gatewayURL)
        webSocket.disconnect()
        webSocket.connect(to: gatewayURL)
        await fetchLiveKitConfig()
        await runConnectivityCheck()
        if let latest = connectivityDiagnostics {
            connectivityActionMessage = "Using \(latest.recommendedMode.uppercased()) route: \(latest.detectedPathLabel)"
        }
        await ensureMinimumBusyTime(since: startedAt)
    }

    @MainActor
    private func openTailscaleApp() {
        Task { @MainActor in
            let opened = await openFirstAvailableURL(from: [
                "tailscale://",
                "tailscale://up",
                "https://apps.apple.com/app/tailscale/id1475387142",
            ])
            if opened {
                connectivityActionMessage = "Opened Tailscale."
            } else {
                connectivityActionMessage = "Could not open Tailscale. Install it from the App Store."
            }
        }
    }

    @MainActor
    private func openVPNSettings() {
        Task { @MainActor in
            let opened = await openFirstAvailableURL(from: [
                "App-Prefs:root=VPN",
                "App-Prefs:root=General&path=VPN",
                "prefs:root=VPN",
                "prefs:root=General&path=VPN",
            ])
            if opened {
                connectivityActionMessage = "Opened iOS settings. Enable Tailscale VPN and return to JOI."
            } else {
                connectivityActionMessage = "Open iOS Settings > VPN manually, then return and run connectivity check."
            }
        }
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
    #endif

    @ViewBuilder
    private func actionButtonLabel(_ title: String, isLoading: Bool) -> some View {
        HStack(spacing: 8) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
            }
            Text(title)
        }
    }

    private var liveKitConnectionLabel: String {
        switch voiceEngine.state {
        case "connecting":
            return "Connecting"
        case "active", "speaking":
            return "Connected"
        case "error":
            return "Error"
        default:
            return "Offline"
        }
    }

    private var microphoneStatusLabel: String {
        if voiceEngine.isMuted {
            return "Off"
        }
        return (voiceEngine.state == "active" || voiceEngine.state == "speaking" || voiceEngine.state == "connecting")
            ? "On"
            : "Off"
    }

    private var audioTranscriberModelChoices: [String] {
        [
            "mlx-community/whisper-small-mlx",
            "mlx-community/whisper-medium-mlx",
            "mlx-community/whisper-large-v3-mlx",
        ]
    }

    private func transcriberModelLabel(for model: String) -> String {
        switch model {
        case "mlx-community/whisper-small-mlx":
            return "Whisper Small (MLX)"
        case "mlx-community/whisper-medium-mlx":
            return "Whisper Medium (MLX)"
        case "mlx-community/whisper-large-v3-mlx":
            return "Whisper Large V3 (MLX)"
        default:
            return model
        }
    }

    @MainActor
    private func ensureMinimumBusyTime(since startedAt: Date, minimumSeconds: TimeInterval = 0.7) async {
        let elapsed = Date().timeIntervalSince(startedAt)
        guard elapsed < minimumSeconds else { return }
        let remaining = minimumSeconds - elapsed
        try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var connectionStateLabel: String {
        switch webSocket.state {
        case .connected:
            return "Connected"
        case .connecting:
            return "Connecting"
        case .reconnecting:
            return "Reconnecting"
        case .disconnected:
            return "Offline"
        }
    }
}

struct LocalVocabularyRule: Codable, Identifiable, Equatable {
    var id = UUID()
    var word = ""
    var replacement = ""
}

enum LocalVocabularyStore {
    private static let storageKey = "customPronunciationsJSON"

    static func load() -> [LocalVocabularyRule] {
        guard let json = UserDefaults.standard.string(forKey: storageKey),
              let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([LocalVocabularyRule].self, from: data)
        else {
            return []
        }
        return sanitize(decoded)
    }

    static func save(_ rules: [LocalVocabularyRule]) {
        let sanitized = sanitize(rules)
        guard let data = try? JSONEncoder().encode(sanitized),
              let json = String(data: data, encoding: .utf8)
        else {
            return
        }
        UserDefaults.standard.set(json, forKey: storageKey)
    }

    static func apply(to text: String) -> String {
        guard !text.isEmpty else { return text }
        let rules = load()
        guard !rules.isEmpty else { return text }

        var transformed = text
        for rule in rules {
            transformed = replaceAll(
                in: transformed,
                word: rule.word,
                replacement: rule.replacement
            )
        }
        return transformed
    }

    private static func sanitize(_ rules: [LocalVocabularyRule]) -> [LocalVocabularyRule] {
        rules.compactMap { rule in
            let word = rule.word.trimmingCharacters(in: .whitespacesAndNewlines)
            let replacement = rule.replacement.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !word.isEmpty, !replacement.isEmpty else { return nil }
            return LocalVocabularyRule(id: rule.id, word: word, replacement: replacement)
        }
    }

    private static func replaceAll(in text: String, word: String, replacement: String) -> String {
        let escapedWord = NSRegularExpression.escapedPattern(for: word)
        let hasWordChars = word.rangeOfCharacter(from: .alphanumerics) != nil
        let pattern = hasWordChars ? "(?i)\\b\(escapedWord)\\b" : "(?i)\(escapedWord)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return text
        }
        let escapedReplacement = replacement
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "$", with: "\\$")
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(
            in: text,
            range: range,
            withTemplate: escapedReplacement
        )
    }
}

#if os(macOS)
private enum SettingsPane: String, CaseIterable, Identifiable {
    case home
    case recording
    case sound
    case vocabulary
    case shortcuts
    case livekit
    case notifications
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .recording: return "Recording"
        case .sound: return "Sound"
        case .vocabulary: return "Vocabulary"
        case .shortcuts: return "Shortcuts"
        case .livekit: return "LiveKit"
        case .notifications: return "Notifications"
        case .about: return "About"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .recording: return "waveform.circle"
        case .sound: return "speaker.wave.2"
        case .vocabulary: return "text.book.closed"
        case .shortcuts: return "keyboard"
        case .livekit: return "server.rack"
        case .notifications: return "bell.badge"
        case .about: return "info.circle"
        }
    }
}

private enum RecordingWindowStyle: String, CaseIterable {
    case classic
    case mini
    case none
}

private enum ShortcutPreset: String, CaseIterable {
    case commandUpArrow = "Command+UpArrow"
    case optionSpace = "Option+Space"
    case commandSpace = "Command+Space"
}
#endif

// MARK: - LiveKit Config Model & Service

struct LiveKitConfigInfo: Codable {
    let url: String
    let networkMode: String?
    let networkTargetIp: String?
    let networkClientIp: String?
    let sttProvider: String
    let sttModel: String
    let ttsProvider: String
    let ttsModel: String
    let ttsVoice: String
    let hasDeepgramKey: Bool
    let hasCartesiaKey: Bool
    let hasApiKey: Bool
    let hasApiSecret: Bool
    let pronunciations: [LiveKitPronunciationRule]?
    let ttsCacheEnabled: Bool?
    let ttsCachePrefix: String?
    let ttsCacheRedisTtlSec: Int?
}

struct LiveKitPronunciationRule: Codable {
    let word: String
    let replacement: String
    let ipa: String?
}

enum LiveKitConfigService {
    static func fetchConfig(gatewayURL: String, networkMode: String = "auto") async throws -> LiveKitConfigInfo {
        var base = gatewayURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
        if base.hasSuffix("/ws") {
            base = String(base.dropLast(3))
        }

        guard var components = URLComponents(string: "\(base)/api/livekit/config") else {
            throw URLError(.badURL)
        }
        let normalizedMode = networkMode.lowercased()
        if normalizedMode == "auto" || normalizedMode == "home" || normalizedMode == "road" {
            components.queryItems = [URLQueryItem(name: "networkMode", value: normalizedMode)]
        }
        guard let url = components.url else {
            throw URLError(.badURL)
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(LiveKitConfigInfo.self, from: data)
    }
}
