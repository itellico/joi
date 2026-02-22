import SwiftUI

struct SettingsView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(PushService.self) private var pushService
    @Environment(VoiceEngine.self) private var voiceEngine
    @AppStorage("gatewayURL") private var gatewayURL = "ws://localhost:3100/ws"
    @AppStorage("recordingWindowStyle") private var recordingWindowStyle = "classic"
    @AppStorage("talkingStyle") private var talkingStyle = "default"
    @AppStorage("voiceAutoGainEnabled") private var voiceAutoGainEnabled = true
    @AppStorage("voiceNoiseSuppressionEnabled") private var voiceNoiseSuppressionEnabled = true
    @AppStorage("voiceSilenceRemovalEnabled") private var voiceSilenceRemovalEnabled = true
    @AppStorage("globalToggleShortcut") private var globalToggleShortcut = "Command+UpArrow"
    @State private var editingURL = ""
    @State private var livekitConfig: LiveKitConfigInfo?
    @State private var livekitError: String?
    @State private var customPronunciations: [LocalVocabularyRule] = []

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
            editingURL = gatewayURL
            enforceLiveKitEngine()
            customPronunciations = LocalVocabularyStore.load()
            Task { await fetchLiveKitConfig() }
        }
        .onChange(of: customPronunciations) { _, _ in
            LocalVocabularyStore.save(customPronunciations)
        }
    }

    #if os(iOS)
    private var iosSettings: some View {
        NavigationStack {
            Form {
                gatewaySection
                voiceSection
                liveKitSection
                connectionSection
                notificationSection
                aboutSection
            }
            .scrollContentBackground(.hidden)
            .background(JOIColors.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
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
                Button("Reconnect") {
                    gatewayURL = editingURL.trimmingCharacters(in: .whitespacesAndNewlines)
                    webSocket.disconnect()
                    webSocket.connect(to: gatewayURL)
                    Task { await fetchLiveKitConfig() }
                }
                .buttonStyle(.borderedProminent)
                .tint(JOIColors.primary)

                Button("Refresh LiveKit Config") {
                    Task { await fetchLiveKitConfig() }
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var voiceSection: some View {
        settingsCard(title: "Voice", subtitle: "LiveKit cloud voice") {
            settingRow(label: "Engine", value: "LiveKit")
            settingRow(label: "Status", value: voiceEngine.statusText)

            Picker("Voice Mode", selection: Binding(
                get: { voiceEngine.livekit.voiceMode },
                set: { voiceEngine.livekit.voiceMode = $0 }
            )) {
                Text("Always On").tag(LiveKitVoicePipeline.VoiceMode.alwaysOn)
                Text("Wake Word").tag(LiveKitVoicePipeline.VoiceMode.wakeWord)
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                Button(voiceEngine.isActive ? "Stop Voice" : "Start Voice") {
                    if voiceEngine.isActive {
                        voiceEngine.stop()
                    } else {
                        Task { @MainActor in
                            await voiceEngine.start()
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(JOIColors.primary)

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

            Button("Reload From Admin") {
                Task { await fetchLiveKitConfig() }
            }
            .buttonStyle(.bordered)

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
            statusRow(label: "APNs Registered", ok: pushService.isRegistered)

            if let token = pushService.deviceToken {
                settingRow(label: "Token", value: String(token.prefix(20)) + "...")
            }

            if !pushService.permissionGranted {
                Button("Enable Notifications") {
                    Task { await pushService.requestPermission() }
                }
                .buttonStyle(.bordered)
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

    private func fetchLiveKitConfig() async {
        livekitError = nil
        do {
            livekitConfig = try await LiveKitConfigService.fetchConfig(gatewayURL: gatewayURL)
        } catch {
            livekitError = error.localizedDescription
        }
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
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
    static func fetchConfig(gatewayURL: String) async throws -> LiveKitConfigInfo {
        var base = gatewayURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
        if base.hasSuffix("/ws") {
            base = String(base.dropLast(3))
        }

        guard let url = URL(string: "\(base)/api/livekit/config") else {
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
