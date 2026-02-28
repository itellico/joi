import SwiftUI
import SwiftData
#if os(iOS)
import PhotosUI
import UIKit
import UniformTypeIdentifiers
#endif
#if os(macOS)
import AppKit
#endif

struct ChatDebugSnapshot {
    let conversationId: String?
    let isStreaming: Bool
    let messages: [ChatUIMessage]
}

struct SourceChipDescriptor: Identifiable, Equatable {
    let id: String
    let title: String
    let symbol: String
    let color: Color
    var isActive: Bool
}

enum SourceChipCatalog {
    private struct Entry {
        let id: String
        let title: String
        let symbol: String
        let color: Color
        let keywords: [String]
    }

    private static let entries: [Entry] = [
        .init(id: "gmail", title: "Gmail", symbol: "envelope.fill", color: Color(hex: 0xFF4D2B), keywords: ["gmail", "email", "inbox", "mail"]),
        .init(id: "calendar", title: "Calendar", symbol: "calendar", color: Color(hex: 0xFF7A2A), keywords: ["calendar", "event", "schedule"]),
        .init(id: "contacts", title: "Contacts", symbol: "person.crop.circle.fill", color: Color(hex: 0xFF2F6B), keywords: ["contact", "people", "person"]),
        .init(id: "tasks", title: "Tasks", symbol: "checkmark.circle.fill", color: Color(hex: 0xFFB23A), keywords: ["task", "todo", "reminder"]),
        .init(id: "weather", title: "Weather", symbol: "cloud.sun.fill", color: Color(hex: 0xFF6A3D), keywords: ["weather", "forecast"]),
        .init(id: "maps", title: "Maps", symbol: "map.fill", color: Color(hex: 0xFF8B2F), keywords: ["map", "location", "place", "route"]),
        .init(id: "web", title: "Web", symbol: "globe", color: Color(hex: 0xFF3A78), keywords: ["web", "search", "browser", "http", "url", "site"]),
        .init(id: "slack", title: "Slack", symbol: "bubble.left.and.bubble.right.fill", color: Color(hex: 0xFF5C6D), keywords: ["slack"]),
        .init(id: "github", title: "GitHub", symbol: "chevron.left.slash.chevron.right", color: Color(hex: 0xFF6951), keywords: ["github", "git", "repo", "pull_request", "pr"]),
        .init(id: "notion", title: "Notion", symbol: "doc.text.fill", color: Color(hex: 0xFF9963), keywords: ["notion", "wiki", "doc"]),
        .init(id: "drive", title: "Drive", symbol: "folder.fill", color: Color(hex: 0xFF7440), keywords: ["drive", "file", "docs", "sheets"]),
        .init(id: "watch", title: "Watch", symbol: "applewatch", color: Color(hex: 0xFFB347), keywords: ["watch", "apple_watch"]),
        .init(id: "tools", title: "Tools", symbol: "hammer.fill", color: JOIColors.secondary, keywords: [])
    ]

    private static let providerEntries: [Entry] = [
        .init(id: "provider-openai", title: "OpenAI", symbol: "sparkles", color: JOIColors.primary, keywords: ["openai"]),
        .init(id: "provider-anthropic", title: "Anthropic", symbol: "brain.head.profile", color: JOIColors.tertiary, keywords: ["anthropic", "claude"]),
        .init(id: "provider-google", title: "Google", symbol: "circle.grid.2x2.fill", color: JOIColors.secondary, keywords: ["google", "gemini"]),
        .init(id: "provider-openrouter", title: "OpenRouter", symbol: "network", color: Color(hex: 0xFF6A4A), keywords: ["openrouter"])
    ]

    static func descriptor(forToolName toolName: String, isActive: Bool) -> SourceChipDescriptor {
        let normalized = normalize(toolName)
        let entry = entries.first { entry in
            entry.keywords.contains { normalized.contains($0) }
        } ?? entries.last!

        return SourceChipDescriptor(
            id: entry.id,
            title: entry.title,
            symbol: entry.symbol,
            color: entry.color,
            isActive: isActive)
    }

    static func descriptor(forProvider provider: String, isActive: Bool) -> SourceChipDescriptor? {
        let normalized = normalize(provider)
        guard let entry = providerEntries.first(where: { entry in
            entry.keywords.contains { normalized.contains($0) }
        }) else {
            return nil
        }

        return SourceChipDescriptor(
            id: entry.id,
            title: entry.title,
            symbol: entry.symbol,
            color: entry.color,
            isActive: isActive)
    }

    static func topBarSources(from messages: [ChatUIMessage], isStreaming: Bool, limit: Int = 5) -> [SourceChipDescriptor] {
        var byId: [String: SourceChipDescriptor] = [:]
        var order: [String] = []

        for message in messages.reversed() {
            for tool in message.toolCalls.reversed() {
                let pending = tool.result == nil && !tool.isError
                let descriptor = descriptor(
                    forToolName: tool.name,
                    isActive: pending && (message.isStreaming || isStreaming))
                merge(descriptor, into: &byId, order: &order)
            }

            if let provider = message.provider,
               !provider.isEmpty,
               let providerDescriptor = descriptor(forProvider: provider, isActive: false) {
                merge(providerDescriptor, into: &byId, order: &order)
            }
        }

        let active = order.filter { byId[$0]?.isActive == true }
        let inactive = order.filter { byId[$0]?.isActive != true }
        return Array((active + inactive).prefix(limit)).compactMap { byId[$0] }
    }

    private static func merge(
        _ descriptor: SourceChipDescriptor,
        into byId: inout [String: SourceChipDescriptor],
        order: inout [String]
    ) {
        if var existing = byId[descriptor.id] {
            existing.isActive = existing.isActive || descriptor.isActive
            byId[descriptor.id] = existing
            return
        }
        byId[descriptor.id] = descriptor
        order.append(descriptor.id)
    }

    private static func normalize(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

struct SourceFaviconDot: View {
    let descriptor: SourceChipDescriptor
    var size: CGFloat = 14
    @State private var rippleScale: CGFloat = 1.0
    @State private var rippleOpacity: Double = 0.0
    @State private var orbitPhase = false

    var body: some View {
        ZStack {
            if descriptor.isActive {
                Circle()
                    .stroke(descriptor.color.opacity(rippleOpacity), lineWidth: 1.2)
                    .scaleEffect(rippleScale)
                    .frame(width: size, height: size)

                Circle()
                    .trim(from: 0.05, to: 0.24)
                    .stroke(descriptor.color.opacity(0.82), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
                    .rotationEffect(.degrees(orbitPhase ? 360 : 0))
                    .frame(width: size + 4, height: size + 4)
                    .animation(.linear(duration: 1.45).repeatForever(autoreverses: false), value: orbitPhase)
            }

            Circle()
                .fill(descriptor.color.opacity(0.22))

            Circle()
                .fill(descriptor.color.opacity(0.95))
                .padding(size * 0.18)

            Image(systemName: descriptor.symbol)
                .font(.system(size: size * 0.43, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.94))
        }
        .frame(width: size, height: size)
        .overlay(
            Circle()
                .stroke(descriptor.color.opacity(descriptor.isActive ? 0.78 : 0.35), lineWidth: descriptor.isActive ? 1.2 : 0.8))
        .shadow(
            color: descriptor.color.opacity(descriptor.isActive ? 0.70 : 0.14),
            radius: descriptor.isActive ? 8 : 2,
            x: 0,
            y: descriptor.isActive ? 1.6 : 0)
        .onAppear {
            if descriptor.isActive {
                startRipple()
                orbitPhase = true
            }
        }
        .onChange(of: descriptor.isActive) { _, isActive in
            if isActive {
                startRipple()
                orbitPhase = true
            } else {
                rippleScale = 1.0
                rippleOpacity = 0.0
                orbitPhase = false
            }
        }
    }

    private func startRipple() {
        rippleScale = 1.0
        rippleOpacity = 0.6
        withAnimation(.easeOut(duration: 1.5).repeatForever(autoreverses: false)) {
            rippleScale = 2.8
            rippleOpacity = 0.0
        }
    }
}

struct SourceTopBarChip: View {
    let descriptor: SourceChipDescriptor

    var body: some View {
        HStack(spacing: 6) {
            SourceFaviconDot(descriptor: descriptor, size: 13)

            Text(descriptor.title)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .lineLimit(1)

            SourceVoiceBars(color: descriptor.color, isActive: descriptor.isActive)
        }
        .foregroundStyle(descriptor.isActive ? JOIColors.textPrimary : JOIColors.textSecondary.opacity(0.85))
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(descriptor.color.opacity(descriptor.isActive ? 0.24 : 0.08))
                .shadow(color: descriptor.color.opacity(descriptor.isActive ? 0.45 : 0), radius: 6, x: 0, y: 0)
        )
        .overlay(
            Capsule()
                .stroke(descriptor.color.opacity(descriptor.isActive ? 0.45 : 0.15), lineWidth: 0.8)
        )
        .scaleEffect(descriptor.isActive ? 1.02 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: descriptor.isActive)
    }
}

private struct SourceVoiceBars: View {
    let color: Color
    let isActive: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.12)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 1.5) {
                ForEach(0..<3, id: \.self) { index in
                    let wave = abs(sin(t * 6.6 + Double(index) * 0.9))
                    let base = isActive ? 4.4 : 3.0
                    let amplitude = isActive ? 5.8 : 1.6
                    RoundedRectangle(cornerRadius: 1.2, style: .continuous)
                        .fill(color.opacity(isActive ? 0.95 : 0.45))
                        .frame(width: 2.2, height: base + wave * amplitude)
                }
            }
            .frame(height: 10)
        }
    }
}

struct ChatView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Environment(VoiceEngine.self) private var voiceEngine
    @Environment(\.modelContext) private var modelContext

    @State private var viewModel = ChatViewModel()

    #if os(iOS)
    @Environment(PhoneWatchBridge.self) private var phoneWatchBridge
    @State private var showPhotoPicker = false
    @State private var showAttachmentOptions = false
    @State private var showDocumentImporter = false
    @State private var showAudioImporter = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    #endif

    var conversationId: String?
    var showLiveTranscriptBubble = true
    var onSnapshotChange: ((ChatDebugSnapshot) -> Void)? = nil
    var onNewConversation: (() -> Void)? = nil

    private var composeContextLabel: String? {
        if let replyTarget = viewModel.replyTarget {
            return "Replying to \(replyTarget.role)"
        }
        if let forwardTarget = viewModel.forwardTarget {
            return "Forwarding \(forwardTarget.role)"
        }
        return nil
    }

    private var composeContextPreview: String? {
        viewModel.replyTarget?.preview ?? viewModel.forwardTarget?.preview
    }

    var body: some View {
        #if os(iOS)
        iosBody
        #else
        baseBody
        #endif
    }

    private var mainLayout: some View {
        VStack(spacing: 0) {
            #if os(macOS)
            // Compact voice status indicator
            VoiceStatusBar(engine: voiceEngine)
            #endif

            if shouldShowEmptyState {
                emptyState
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                messagesScrollView
            }

            if !viewModel.selectedMessageIds.isEmpty {
                selectionToolbar
            }

            chatInputSection
        }
    }

    @ViewBuilder
    private var chatInputSection: some View {
        #if os(iOS)
        ChatInput(
            text: $viewModel.inputText,
            isStreaming: viewModel.isStreaming,
            onSend: { viewModel.send() },
            composeContextLabel: composeContextLabel,
            composeContextPreview: composeContextPreview,
            allowContextOnlySend: viewModel.forwardTarget != nil,
            onClearComposeContext: {
                viewModel.clearReplyTarget()
                viewModel.clearForwardTarget()
            },
            onAddAction: {
                showAttachmentOptions = true
            },
            onMicAction: {
                showAudioImporter = true
            },
            isMicActive: false,
            attachmentPreview: viewModel.pendingAttachmentPreviewData.flatMap(UIImage.init(data:)),
            attachmentName: viewModel.pendingAttachmentName,
            onRemoveAttachment: {
                viewModel.clearPendingAttachment()
            })
        #else
        ChatInput(
            text: $viewModel.inputText,
            isStreaming: viewModel.isStreaming,
            onSend: { viewModel.send() },
            composeContextLabel: composeContextLabel,
            composeContextPreview: composeContextPreview,
            allowContextOnlySend: viewModel.forwardTarget != nil,
            onClearComposeContext: {
                viewModel.clearReplyTarget()
                viewModel.clearForwardTarget()
            },
            onAddAction: {
                if let onNewConversation {
                    onNewConversation()
                } else {
                    viewModel.newConversation()
                }
            },
            onMicAction: {
                Task { @MainActor in
                    await voiceEngine.tapToTalk()
                }
            })
        #endif
    }

    private var baseBody: some View {
        mainLayout
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
            .onDisappear {
                voiceEngine.onVoiceMessageSent = nil
                voiceEngine.onTranscription = nil
                voiceEngine.onConversationReady = nil
                emitSnapshot()
            }
    }

    #if os(iOS)
    private var iosBody: some View {
        baseBody
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
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    await handleSelectedPhoto(newItem)
                    await MainActor.run {
                        selectedPhotoItem = nil
                    }
                }
            }
            .confirmationDialog("Add Attachment", isPresented: $showAttachmentOptions, titleVisibility: .visible) {
                Button("Photo Library") {
                    showPhotoPicker = true
                }
                Button("Files (PDF, Docs, etc)") {
                    showDocumentImporter = true
                }
                Button("Audio File (Transcribe)") {
                    showAudioImporter = true
                }
                Button("Cancel", role: .cancel) {}
            }
            .fileImporter(
                isPresented: $showDocumentImporter,
                allowedContentTypes: [.item],
                allowsMultipleSelection: false
            ) { result in
                Task {
                    await handleImportedFiles(result, preferredType: .file)
                }
            }
            .fileImporter(
                isPresented: $showAudioImporter,
                allowedContentTypes: [.audio],
                allowsMultipleSelection: false
            ) { result in
                Task {
                    await handleImportedFiles(result, preferredType: .audio)
                }
            }
            .photosPicker(
                isPresented: $showPhotoPicker,
                selection: $selectedPhotoItem,
                matching: .images)
    }
    #endif

    private var shouldShowEmptyState: Bool {
        let hasLiveVoiceBubble = showLiveTranscriptBubble
            && voiceEngine.isCapturing
            && !voiceEngine.capturedTranscript.isEmpty
        return viewModel.messages.isEmpty
            && !viewModel.isStreaming
            && !hasLiveVoiceBubble
    }

    private var messagesScrollView: some View {
        let messagesById = Dictionary(uniqueKeysWithValues: viewModel.messages.map { ($0.id, $0) })
        return ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(
                            message: message,
                            replyPreview: message.replyToMessageId.flatMap { replyId in
                                messagesById[replyId].map { previewSource in
                                    previewSource.content.trimmingCharacters(in: .whitespacesAndNewlines)
                                }
                            },
                            onReply: { source in
                                viewModel.setReplyTarget(from: source)
                            },
                            onForward: { source in
                                viewModel.setForwardTarget(from: source)
                            },
                            onToggleReaction: { source, emoji in
                                viewModel.toggleReaction(messageId: source.id, emoji: emoji)
                            },
                            onPin: { source in
                                viewModel.togglePin(messageId: source.id)
                            },
                            onReport: { source in
                                viewModel.reportMessage(messageId: source.id, note: "Reported from chat")
                            },
                            onDelete: { source in
                                viewModel.deleteMessage(messageId: source.id)
                            },
                            onSelect: { source in
                                viewModel.toggleMessageSelection(source.id)
                            },
                            onSelectOnly: { source in
                                viewModel.selectOnly(messageId: source.id)
                            },
                            isSelected: viewModel.selectedMessageIds.contains(message.id),
                            selectionMode: !viewModel.selectedMessageIds.isEmpty
                            )
                            .id(message.id)
                    }

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
            .joiHideScrollChrome()
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
    }

    private var emptyState: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 0)

            VStack(spacing: 14) {
                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(JOIColors.secondary)

                Text("Speak or type what you need next")
                    .font(.system(size: 44, weight: .semibold, design: .serif))
                    .foregroundStyle(JOIColors.textPrimary.opacity(0.92))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                    .padding(.horizontal, 18)
            }

            Spacer(minLength: 42)
        }
        .padding(.horizontal, 24)
    }

    private var selectionToolbar: some View {
        HStack(spacing: 8) {
            Text("\(viewModel.selectedMessageIds.count) selected")
                .font(JOITypography.labelSmall)
                .foregroundStyle(JOIColors.textSecondary)

            Spacer(minLength: 6)

            Button("Delete") {
                viewModel.deleteSelectedMessages()
            }
            .buttonStyle(.plain)
            .foregroundStyle(JOIColors.error)

            Button("Clear") {
                viewModel.clearSelectedMessages()
            }
            .buttonStyle(.plain)
            .foregroundStyle(JOIColors.textSecondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(JOIColors.surfaceVariant.opacity(0.75))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(JOIColors.border.opacity(0.6), lineWidth: 1)
        )
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    #if os(iOS)
    private func handleSelectedPhoto(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard let payload = prepareImagePayload(from: data) else { return }
            await MainActor.run {
                viewModel.setPendingImageAttachment(
                    data: payload.uploadData,
                    mimeType: payload.mimeType,
                    fileName: payload.fileName,
                    previewData: payload.previewData)
            }
        } catch {
            // Intentionally ignore picker failures in UI.
        }
    }

    private enum ImportedAttachmentKind {
        case file
        case audio
    }

    private struct ImportedFilePayload {
        let attachmentType: String
        let data: Data
        let previewData: Data?
        let mimeType: String
        let fileName: String
    }

    private func handleImportedFiles(
        _ result: Result<[URL], Error>,
        preferredType: ImportedAttachmentKind
    ) async {
        guard case .success(let urls) = result, let fileURL = urls.first else {
            return
        }
        await handleImportedFileURL(fileURL, preferredType: preferredType)
    }

    private func handleImportedFileURL(_ fileURL: URL, preferredType: ImportedAttachmentKind) async {
        let hasSecurityScope = fileURL.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope {
                fileURL.stopAccessingSecurityScopedResource()
            }
        }

        guard let payload = prepareFilePayload(from: fileURL, preferredType: preferredType) else {
            return
        }

        await MainActor.run {
            if payload.attachmentType == "image", let previewData = payload.previewData {
                viewModel.setPendingImageAttachment(
                    data: payload.data,
                    mimeType: payload.mimeType,
                    fileName: payload.fileName,
                    previewData: previewData
                )
            } else {
                viewModel.setPendingAttachment(
                    type: payload.attachmentType,
                    data: payload.data,
                    mimeType: payload.mimeType,
                    fileName: payload.fileName,
                    previewData: payload.previewData
                )
            }

            if payload.attachmentType == "audio",
               viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                viewModel.inputText = transcriptionPromptForSelectedModel()
            }
        }
    }

    private func prepareFilePayload(
        from fileURL: URL,
        preferredType: ImportedAttachmentKind
    ) -> ImportedFilePayload? {
        do {
            let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
            guard !data.isEmpty else { return nil }
            guard data.count <= 20_000_000 else { return nil }

            let values = try? fileURL.resourceValues(forKeys: [.contentTypeKey, .nameKey])
            let contentType = values?.contentType ?? UTType(filenameExtension: fileURL.pathExtension)
            let rawName = values?.name ?? fileURL.lastPathComponent
            let fileName = rawName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "attachment-\(Int(Date().timeIntervalSince1970))"
                : rawName

            let isImage = preferredType == .file && (contentType?.conforms(to: .image) == true)
            if isImage,
               let payload = prepareImagePayload(from: data, preferredFileName: fileName) {
                return ImportedFilePayload(
                    attachmentType: "image",
                    data: payload.uploadData,
                    previewData: payload.previewData,
                    mimeType: payload.mimeType,
                    fileName: payload.fileName
                )
            }

            let isAudio = preferredType == .audio || (contentType?.conforms(to: .audio) == true)
            let mimeType = contentType?.preferredMIMEType ?? fallbackMIMEType(for: fileURL)
            return ImportedFilePayload(
                attachmentType: isAudio ? "audio" : "file",
                data: data,
                previewData: nil,
                mimeType: mimeType,
                fileName: fileName
            )
        } catch {
            return nil
        }
    }

    private func fallbackMIMEType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "pdf":
            return "application/pdf"
        case "txt":
            return "text/plain"
        case "md":
            return "text/markdown"
        case "json":
            return "application/json"
        case "wav":
            return "audio/wav"
        case "mp3":
            return "audio/mpeg"
        case "m4a":
            return "audio/mp4"
        default:
            return "application/octet-stream"
        }
    }

    private func prepareImagePayload(
        from originalData: Data,
        preferredFileName: String? = nil
    ) -> (uploadData: Data, previewData: Data, mimeType: String, fileName: String)? {
        guard let image = UIImage(data: originalData) else { return nil }
        let resized = image.joiResized(maxDimension: 1600) ?? image
        var quality: CGFloat = 0.82
        var uploadData = resized.jpegData(compressionQuality: quality) ?? originalData

        while uploadData.count > 1_500_000, quality > 0.4 {
            quality -= 0.1
            if let compressed = resized.jpegData(compressionQuality: quality) {
                uploadData = compressed
            } else {
                break
            }
        }

        let previewImage = resized.joiResized(maxDimension: 320) ?? resized
        let previewData = previewImage.jpegData(compressionQuality: 0.65) ?? uploadData
        var fileName = preferredFileName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if fileName?.isEmpty != false {
            fileName = "photo-\(Int(Date().timeIntervalSince1970)).jpg"
        }
        if let currentName = fileName,
           !currentName.lowercased().hasSuffix(".jpg"),
           !currentName.lowercased().hasSuffix(".jpeg") {
            fileName = "\(currentName).jpg"
        }
        return (uploadData, previewData, "image/jpeg", fileName ?? "photo.jpg")
    }

    private func transcriptionPromptForSelectedModel() -> String {
        let raw = UserDefaults.standard.string(forKey: ChatViewModel.audioTranscriberModelDefaultsKey)
            ?? ChatViewModel.defaultAudioTranscriberModel
        let model = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if model.isEmpty {
            return "Please transcribe and summarize this audio."
        }
        return "Please transcribe and summarize this audio using \(model)."
    }
    #endif

    private func emitSnapshot() {
        onSnapshotChange?(ChatDebugSnapshot(
            conversationId: viewModel.activeConversationId,
            isStreaming: viewModel.isStreaming,
            messages: viewModel.messages))
    }
}

#if os(iOS)
private extension UIImage {
    func joiResized(maxDimension: CGFloat) -> UIImage? {
        let maxSide = max(size.width, size.height)
        guard maxSide > maxDimension, maxSide > 0 else { return self }

        let scale = maxDimension / maxSide
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
#endif

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

extension View {
    @ViewBuilder
    func joiHideScrollChrome() -> some View {
        #if os(macOS)
        background(MacScrollChromeHider())
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct MacScrollChromeHider: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            configureScrollView(from: view)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            configureScrollView(from: nsView)
        }
    }

    private func configureScrollView(from view: NSView) {
        guard let scrollView = findScrollView(startingAt: view) else { return }
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
    }

    private func findScrollView(startingAt view: NSView?) -> NSScrollView? {
        var current = view
        while let node = current {
            if let scrollView = node as? NSScrollView {
                return scrollView
            }
            current = node.superview
        }
        return nil
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
