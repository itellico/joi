import Foundation
import Observation
import SwiftData
import OSLog

struct ChatUIToolCall: Identifiable {
    let id: String
    var name: String
    var input: AnyCodable?
    var result: AnyCodable?
    var isError: Bool
    var startedAt: Date?
    var durationMs: Int?
}

struct ChatUIMessage: Identifiable {
    var id: String
    var role: String
    var content: String
    var model: String?
    var provider: String?
    var toolModel: String?
    var toolProvider: String?
    var plannedSteps: [String] = []
    var toolCalls: [ChatUIToolCall] = []
    var usage: ChatUsage?
    var latencyMs: Int?
    var ttftMs: Int?
    var streamStartedAt: Date?
    var costUsd: Double?
    var attachments: [ChatAttachment] = []
    var replyToMessageId: String?
    var forwardOfMessageId: String?
    var mentions: [ChatMention] = []
    var forwardingMetadata: AnyCodable?
    var reactions: [String: [String]] = [:]
    var pinned: Bool = false
    var reported: Bool = false
    var reportNote: String?
    var isStreaming: Bool
    var isError: Bool
    let createdAt: Date
    /// Gateway's authoritative message ID (for persistence), may differ from `id`
    var gatewayMessageId: String?
}

struct ChatComposerTarget {
    let messageId: String
    let role: String
    let preview: String
}

@MainActor
@Observable
final class ChatViewModel {
    static let reactionActorId = "joi-user"
    static let quickReactionEmojis = ["❤️", "🔥", "👍", "😂", "👎", "🥰"]
    static let audioTranscriberModelDefaultsKey = "audioTranscriberModel"
    static let defaultAudioTranscriberModel = "mlx-community/whisper-small-mlx"

    var messages: [ChatUIMessage] = []
    var activeConversationId: String?
    var isStreaming = false
    var inputText = ""
    var replyTarget: ChatComposerTarget?
    var forwardTarget: ChatComposerTarget?
    var pendingAttachmentPreviewData: Data?
    var pendingAttachmentName: String?
    var selectedMessageIds: Set<String> = []

    private struct PendingChatSend {
        let conversationId: String?
        let content: String
        let attachments: [ChatAttachment]?
        let replyToMessageId: String?
        let forwardOfMessageId: String?
        let mentions: [ChatMention]?
        let transcriberModel: String?
    }

    private var webSocket: WebSocketClient?
    private var router: FrameRouter?
    private var modelContext: ModelContext?
    private let log = Logger(subsystem: "com.joi.app", category: "ChatVM")
    private var voiceSyncTask: Task<Void, Never>?
    private var streamingMessageId: String?
    private var streamStartedAt: Date?
    private var firstTokenMs: Int?
    private var pendingSends: [PendingChatSend] = []
    private var pendingAttachment: ChatAttachment?

    private struct ReactionToggleResponse: Decodable {
        let messageId: String
        let reactions: [String: [String]]?
    }

    private struct PinToggleResponse: Decodable {
        let messageId: String
        let pinned: Bool
    }

    func attach(webSocket: WebSocketClient, router: FrameRouter, modelContext: ModelContext) {
        self.webSocket = webSocket
        self.router = router
        self.modelContext = modelContext

        log.info("ChatViewModel attached (ws=\(webSocket.isConnected))")

        router.onChatStream = { [weak self] data in
            self?.handleStream(data)
        }
        router.onChatDone = { [weak self] data in
            self?.handleDone(data)
        }
        router.onChatError = { [weak self] error in
            self?.handleError(error)
        }
        router.onChatPlan = { [weak self] data in
            self?.handlePlan(data)
        }
        router.onChatToolUse = { [weak self] data in
            self?.handleToolUse(data)
        }
        router.onChatToolResult = { [weak self] data in
            self?.handleToolResult(data)
        }
        router.onSessionData = { [weak self] frame in
            self?.handleSessionHistory(frame)
        }
    }

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachment = pendingAttachment
        let replyTo = replyTarget?.messageId
        let forwardOf = forwardTarget?.messageId
        let mentionPayload = extractMentions(from: text)
        let selectedTranscriberModel = normalizedTranscriberModel(
            UserDefaults.standard.string(forKey: Self.audioTranscriberModelDefaultsKey)
        )
        guard !text.isEmpty || attachment != nil || forwardOf != nil else { return }
        guard let webSocket else { return }
        inputText = ""

        log.info("Sending message: '\(text.prefix(50))' (ws=\(webSocket.isConnected))")

        // Optimistic user bubble
        let displayText: String
        if text.isEmpty {
            if forwardOf != nil {
                displayText = "Forwarded message."
            } else if let attachment {
                let label = attachmentDisplayLabel(for: attachment)
                if let pendingAttachmentName {
                    displayText = "Sent \(label): \(pendingAttachmentName)."
                } else {
                    displayText = "Sent \(label)."
                }
            } else {
                displayText = pendingAttachmentName.map { "Sent attachment: \($0)" } ?? "Sent an attachment."
            }
        } else if let pendingAttachmentName {
            displayText = "\(text)\n\n[Attachment: \(pendingAttachmentName)]"
        } else {
            displayText = text
        }

        let userMsg = ChatUIMessage(
            id: UUID().uuidString,
            role: "user",
            content: displayText,
            attachments: attachment.map { [$0] } ?? [],
            replyToMessageId: replyTo,
            forwardOfMessageId: forwardOf,
            mentions: mentionPayload,
            isStreaming: false,
            isError: false,
            createdAt: .now)
        messages.append(userMsg)

        let outgoingContent: String
        if text.isEmpty, let attachment {
            outgoingContent = defaultPrompt(for: attachment, transcriberModel: selectedTranscriberModel)
        } else {
            outgoingContent = text
        }
        let outgoingTranscriberModel: String?
        if let attachment,
           attachment.type.lowercased().contains("audio") || attachment.type.lowercased().contains("voice") {
            outgoingTranscriberModel = selectedTranscriberModel
        } else {
            outgoingTranscriberModel = nil
        }

        pendingSends.append(PendingChatSend(
            conversationId: activeConversationId,
            content: outgoingContent,
            attachments: attachment.map { [$0] },
            replyToMessageId: replyTo,
            forwardOfMessageId: forwardOf,
            mentions: mentionPayload.isEmpty ? nil : mentionPayload,
            transcriberModel: outgoingTranscriberModel))

        pendingAttachment = nil
        pendingAttachmentPreviewData = nil
        pendingAttachmentName = nil
        replyTarget = nil
        forwardTarget = nil

        if webSocket.isConnected {
            flushPendingSendsIfPossible()
        } else {
            log.warning("Queued send while websocket is \(String(describing: webSocket.state))")
            appendConnectionError("JOI is reconnecting. Message queued and will send automatically.")
        }
    }

    func setReplyTarget(from message: ChatUIMessage) {
        forwardTarget = nil
        replyTarget = ChatComposerTarget(
            messageId: message.id,
            role: message.role,
            preview: summarizedMessage(message))
    }

    func setForwardTarget(from message: ChatUIMessage) {
        replyTarget = nil
        forwardTarget = ChatComposerTarget(
            messageId: message.id,
            role: message.role,
            preview: summarizedMessage(message))
    }

    func clearReplyTarget() {
        replyTarget = nil
    }

    func clearForwardTarget() {
        forwardTarget = nil
    }

    func toggleReaction(messageId: String, emoji: String) {
        let normalizedEmoji = emoji.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmoji.isEmpty else { return }

        Task { [weak self] in
            await self?.sendReactionToggle(messageId: messageId, emoji: normalizedEmoji)
        }
    }

    func togglePin(messageId: String) {
        Task { [weak self] in
            await self?.sendPinToggle(messageId: messageId)
        }
    }

    func reportMessage(messageId: String, note: String?) {
        Task { [weak self] in
            await self?.sendReport(messageId: messageId, note: note)
        }
    }

    func deleteMessage(messageId: String) {
        Task { [weak self] in
            await self?.sendDeleteMessage(messageId: messageId)
        }
    }

    func toggleMessageSelection(_ messageId: String) {
        if selectedMessageIds.contains(messageId) {
            selectedMessageIds.remove(messageId)
        } else {
            selectedMessageIds.insert(messageId)
        }
    }

    func clearSelectedMessages() {
        selectedMessageIds.removeAll()
    }

    func selectOnly(messageId: String) {
        selectedMessageIds = [messageId]
    }

    func deleteSelectedMessages() {
        let ids = selectedMessageIds
        guard !ids.isEmpty else { return }
        selectedMessageIds.removeAll()
        Task { [weak self] in
            for messageId in ids {
                await self?.sendDeleteMessage(messageId: messageId)
            }
        }
    }

    /// Add a user message bubble for voice-originated messages (already sent by VoicePipeline)
    func addVoiceMessage(_ text: String) {
        let userMsg = ChatUIMessage(
            id: UUID().uuidString,
            role: "user",
            content: text,
            isStreaming: false,
            isError: false,
            createdAt: .now)
        messages.append(userMsg)
        startStreamingTurn()
    }

    func loadConversation(id: String) {
        voiceSyncTask?.cancel()
        voiceSyncTask = nil
        pendingSends.removeAll()
        replyTarget = nil
        forwardTarget = nil
        selectedMessageIds.removeAll()
        activeConversationId = id
        messages = []
        resetStreamingState()
        requestSessionHistory(conversationId: id)
    }

    func refreshConversation() {
        guard let activeConversationId else { return }
        requestSessionHistory(conversationId: activeConversationId)
    }

    /// Keep voice UI and stored history in sync after final transcripts arrive.
    func scheduleVoiceSync() {
        guard let conversationId = activeConversationId else { return }
        voiceSyncTask?.cancel()

        // Fast refresh for immediate UI feedback.
        requestSessionHistory(conversationId: conversationId)

        // Retry once after persistence lag on gateway/worker side.
        voiceSyncTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard let self, !Task.isCancelled else { return }
            guard self.activeConversationId == conversationId else { return }
            self.requestSessionHistory(conversationId: conversationId)
        }
    }

    func syncVoiceConversation(id: String) {
        if activeConversationId != id {
            activeConversationId = id
        }
        scheduleVoiceSync()
    }

    func newConversation() {
        voiceSyncTask?.cancel()
        voiceSyncTask = nil
        pendingSends.removeAll()
        replyTarget = nil
        forwardTarget = nil
        pendingAttachment = nil
        pendingAttachmentPreviewData = nil
        pendingAttachmentName = nil
        selectedMessageIds.removeAll()
        activeConversationId = nil
        messages = []
        resetStreamingState()
    }

    func setPendingImageAttachment(data: Data, mimeType: String, fileName: String, previewData: Data) {
        setPendingAttachment(
            type: "image",
            data: data,
            mimeType: mimeType,
            fileName: fileName,
            previewData: previewData
        )
    }

    func setPendingAttachment(
        type: String,
        data: Data,
        mimeType: String,
        fileName: String,
        previewData: Data? = nil
    ) {
        pendingAttachment = ChatAttachment(
            type: type,
            data: "data:\(mimeType);base64,\(data.base64EncodedString())",
            name: fileName,
            mimeType: mimeType,
            size: data.count
        )
        pendingAttachmentPreviewData = previewData
        pendingAttachmentName = fileName
    }

    func clearPendingAttachment() {
        pendingAttachment = nil
        pendingAttachmentPreviewData = nil
        pendingAttachmentName = nil
    }

    func handleConnectionStateChange(_ state: WebSocketClient.ConnectionState) {
        if state == .connected {
            flushPendingSendsIfPossible()
            return
        }
        guard isStreaming else { return }

        log.warning("Cancelling pending stream due to websocket state change: \(String(describing: state))")
        isStreaming = false

        if let streamingMessageId,
           let idx = messages.firstIndex(where: { $0.id == streamingMessageId }) {
            messages[idx].isStreaming = false
            if messages[idx].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                messages[idx].role = "error"
                messages[idx].isError = true
                messages[idx].content = "Connection dropped before JOI could answer."
            }
        }

        resetStreamingState()
    }

    // MARK: - Handlers

    private func requestSessionHistory(conversationId: String) {
        let payload = SessionLoadData(conversationId: conversationId)
        webSocket?.send(type: .sessionLoad, data: payload)
    }

    private func handleStream(_ data: ChatStreamData) {
        guard syncConversationContext(incomingConversationId: data.conversationId) else { return }

        captureFirstTokenIfNeeded()
        let targetMessageId = data.messageId ?? streamingMessageId
        let idx = ensureStreamingAssistantMessage(preferredMessageId: targetMessageId)

        messages[idx].content += stripInternalTags(data.delta)
        messages[idx].model = data.model ?? messages[idx].model
        messages[idx].isStreaming = true
        messages[idx].ttftMs = messages[idx].ttftMs ?? firstTokenMs
        messages[idx].streamStartedAt = messages[idx].streamStartedAt ?? streamStartedAt
    }

    private func handleDone(_ data: ChatDoneData) {
        guard syncConversationContext(incomingConversationId: data.conversationId) else { return }

        log.info("Chat done: \(data.messageId) (\(data.content.count) chars)")
        isStreaming = false

        let latencyMs = data.latencyMs ?? streamElapsedMs
        let ttftMs = data.ttftMs ?? firstTokenMs
        let matchId = data.messageId
        let streamId = streamingMessageId

        if let idx = messages.firstIndex(where: { $0.id == matchId || $0.id == streamId }) {
            messages[idx].id = matchId
            messages[idx].gatewayMessageId = matchId
            messages[idx].content = stripInternalTags(data.content)
            messages[idx].model = data.model
            messages[idx].provider = data.provider
            messages[idx].toolModel = data.toolModel
            messages[idx].toolProvider = data.toolProvider
            messages[idx].usage = data.usage
            messages[idx].latencyMs = latencyMs
            messages[idx].ttftMs = ttftMs
            messages[idx].costUsd = data.costUsd
            messages[idx].isStreaming = false
            messages[idx].streamStartedAt = streamStartedAt
        } else {
            let msg = ChatUIMessage(
                id: matchId,
                role: "assistant",
                content: stripInternalTags(data.content),
                model: data.model,
                provider: data.provider,
                toolModel: data.toolModel,
                toolProvider: data.toolProvider,
                usage: data.usage,
                latencyMs: latencyMs,
                ttftMs: ttftMs,
                streamStartedAt: streamStartedAt,
                costUsd: data.costUsd,
                isStreaming: false,
                isError: false,
                createdAt: .now,
                gatewayMessageId: matchId)
            messages.append(msg)
        }

        resetStreamingState()

        // Persist to SwiftData
        persistMessage(id: data.messageId, role: "assistant", content: data.content, model: data.model)
        flushPendingSendsIfPossible()
    }

    private func handleError(_ error: String) {
        log.error("Chat error: \(error)")
        isStreaming = false
        resetStreamingState()
        let msg = ChatUIMessage(
            id: UUID().uuidString,
            role: "error",
            content: error,
            isStreaming: false,
            isError: true,
            createdAt: .now)
        messages.append(msg)
        flushPendingSendsIfPossible()
    }

    private func appendConnectionError(_ message: String) {
        if messages.last?.role == "error", messages.last?.content == message {
            return
        }
        let msg = ChatUIMessage(
            id: UUID().uuidString,
            role: "error",
            content: message,
            isStreaming: false,
            isError: true,
            createdAt: .now)
        messages.append(msg)
    }

    private func handlePlan(_ data: ChatPlanData) {
        guard syncConversationContext(incomingConversationId: data.conversationId) else { return }
        let incomingSteps = data.steps
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !incomingSteps.isEmpty else { return }

        let idx = ensureStreamingAssistantMessage(preferredMessageId: nil)
        var merged = messages[idx].plannedSteps
        for step in incomingSteps where !merged.contains(step) {
            merged.append(step)
        }
        messages[idx].plannedSteps = merged
    }

    private func handleToolUse(_ data: ChatToolUseData) {
        guard syncConversationContext(incomingConversationId: data.conversationId) else { return }
        let idx = ensureStreamingAssistantMessage(preferredMessageId: data.messageId)
        guard !messages[idx].toolCalls.contains(where: { $0.id == data.toolUseId }) else { return }

        messages[idx].toolCalls.append(ChatUIToolCall(
            id: data.toolUseId,
            name: data.toolName,
            input: data.toolInput,
            result: nil,
            isError: false,
            startedAt: .now,
            durationMs: nil))
    }

    private func handleToolResult(_ data: ChatToolResultData) {
        guard syncConversationContext(incomingConversationId: data.conversationId) else { return }
        guard let messageIndex = messages.lastIndex(where: { message in
            message.toolCalls.contains(where: { $0.id == data.toolUseId })
        }) else { return }
        guard let toolIndex = messages[messageIndex].toolCalls.firstIndex(where: { $0.id == data.toolUseId }) else { return }

        var toolCall = messages[messageIndex].toolCalls[toolIndex]
        let resultValue = data.result.value
        toolCall.result = data.result
        toolCall.isError = isToolErrorPayload(resultValue)
        if let startedAt = toolCall.startedAt, toolCall.durationMs == nil {
            toolCall.durationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000.0))
        }
        messages[messageIndex].toolCalls[toolIndex] = toolCall
    }

    private func handleSessionHistory(_ frame: Frame) {
        guard let history = decodeSessionHistory(from: frame) else { return }

        guard history.conversationId == activeConversationId else { return }

        // Build a map of tool results keyed by tool_use_id from role="tool" rows.
        var toolResultById: [String: AnyCodable] = [:]
        for raw in history.messages where raw.role == "tool" {
            for (toolUseId, result) in decodeToolResults(raw.toolResults) {
                toolResultById[toolUseId] = result
            }
        }

        messages = history.messages
            .filter { $0.role != "tool" }
            .map { msg in
                ChatUIMessage(
                    id: msg.id,
                    role: msg.role,
                    content: msg.content ?? "",
                    model: msg.model,
                    provider: msg.provider,
                    toolModel: msg.toolModel,
                    toolProvider: msg.toolProvider,
                    plannedSteps: [],
                    toolCalls: decodeToolCalls(msg.toolCalls, resultMap: toolResultById),
                    usage: msg.tokenUsage,
                    latencyMs: msg.latencyMs,
                    ttftMs: nil,
                    streamStartedAt: nil,
                    costUsd: msg.costUsd,
                    attachments: msg.attachments ?? [],
                    replyToMessageId: msg.replyToMessageId,
                    forwardOfMessageId: msg.forwardOfMessageId,
                    mentions: msg.mentions ?? [],
                    forwardingMetadata: msg.forwardingMetadata,
                    reactions: msg.reactions ?? [:],
                    pinned: msg.pinned ?? false,
                    reported: msg.reported ?? false,
                    reportNote: msg.reportNote,
                    isStreaming: false,
                    isError: false,
                    createdAt: parseDate(msg.createdAt),
                    gatewayMessageId: msg.id)
        }
        selectedMessageIds.removeAll()
        resetStreamingState()
        isStreaming = false
    }

    private func persistMessage(id: String, role: String, content: String, model: String?) {
        guard let modelContext, let conversationId = activeConversationId else { return }

        let message = Message(id: id, role: role, content: content, model: model)

        let descriptor = FetchDescriptor<Conversation>(predicate: #Predicate { $0.id == conversationId })
        if let conversation = try? modelContext.fetch(descriptor).first {
            message.conversation = conversation
            conversation.lastMessage = String(content.prefix(100))
            conversation.updatedAt = .now
        }

        modelContext.insert(message)
        try? modelContext.save()
    }

    private func startStreamingTurn() {
        isStreaming = true
        streamStartedAt = .now
        firstTokenMs = nil
        streamingMessageId = nil
    }

    private func flushPendingSendsIfPossible() {
        guard !isStreaming else { return }
        guard let webSocket, webSocket.isConnected else { return }
        guard !pendingSends.isEmpty else { return }

        let next = pendingSends.removeFirst()
        let payload = ChatSendData(
            conversationId: next.conversationId,
            content: next.content,
            attachments: next.attachments,
            replyToMessageId: next.replyToMessageId,
            forwardOfMessageId: next.forwardOfMessageId,
            mentions: next.mentions,
            transcriberModel: next.transcriberModel)
        webSocket.send(type: .chatSend, data: payload)
        startStreamingTurn()
    }

    private func attachmentDisplayLabel(for attachment: ChatAttachment) -> String {
        let type = attachment.type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if type.contains("image") || type.contains("photo") {
            return "image"
        }
        if type.contains("audio") || type.contains("voice") {
            return "audio"
        }
        if type.contains("pdf") || type.contains("doc") || type.contains("text") {
            return "document"
        }
        return "attachment"
    }

    private func defaultPrompt(for attachment: ChatAttachment, transcriberModel: String?) -> String {
        let type = attachment.type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if type.contains("image") || type.contains("photo") {
            return "Please analyze the attached image."
        }
        if type.contains("audio") || type.contains("voice") {
            if let transcriberModel {
                return "Please transcribe and summarize the attached audio using \(transcriberModel)."
            }
            return "Please transcribe and summarize the attached audio."
        }
        return "Please analyze the attached file."
    }

    private func normalizedTranscriberModel(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.count > 120 {
            return String(trimmed.prefix(120))
        }
        return trimmed
    }

    private func resetStreamingState() {
        streamingMessageId = nil
        streamStartedAt = nil
        firstTokenMs = nil
    }

    private var streamElapsedMs: Int? {
        guard let streamStartedAt else { return nil }
        return max(0, Int(Date().timeIntervalSince(streamStartedAt) * 1000.0))
    }

    private func captureFirstTokenIfNeeded() {
        guard firstTokenMs == nil, let streamStartedAt else { return }
        firstTokenMs = max(0, Int(Date().timeIntervalSince(streamStartedAt) * 1000.0))
    }

    private func syncConversationContext(incomingConversationId: String?) -> Bool {
        guard let incomingConversationId else { return true }
        if let activeConversationId, incomingConversationId != activeConversationId {
            return false
        }
        if activeConversationId == nil {
            activeConversationId = incomingConversationId
            log.info("Conversation started: \(incomingConversationId)")
        }
        return true
    }

    @discardableResult
    private func ensureStreamingAssistantMessage(preferredMessageId: String?) -> Int {
        if streamStartedAt == nil {
            streamStartedAt = .now
        }
        isStreaming = true

        if let preferredMessageId,
           let idx = messages.firstIndex(where: { $0.id == preferredMessageId }) {
            messages[idx].isStreaming = true
            messages[idx].streamStartedAt = messages[idx].streamStartedAt ?? streamStartedAt
            streamingMessageId = preferredMessageId
            return idx
        }

        if let streamingMessageId,
           let idx = messages.firstIndex(where: { $0.id == streamingMessageId }) {
            if let preferredMessageId {
                messages[idx].id = preferredMessageId
                self.streamingMessageId = preferredMessageId
            }
            messages[idx].isStreaming = true
            messages[idx].streamStartedAt = messages[idx].streamStartedAt ?? streamStartedAt
            return idx
        }

        if let idx = messages.lastIndex(where: { $0.role == "assistant" && $0.isStreaming }) {
            if let preferredMessageId {
                messages[idx].id = preferredMessageId
                streamingMessageId = preferredMessageId
            } else {
                streamingMessageId = messages[idx].id
            }
            messages[idx].streamStartedAt = messages[idx].streamStartedAt ?? streamStartedAt
            return idx
        }

        let messageId = preferredMessageId ?? UUID().uuidString
        let msg = ChatUIMessage(
            id: messageId,
            role: "assistant",
            content: "",
            model: nil,
            provider: nil,
            toolModel: nil,
            toolProvider: nil,
            plannedSteps: [],
            toolCalls: [],
            usage: nil,
            latencyMs: nil,
            ttftMs: nil,
            streamStartedAt: streamStartedAt,
            costUsd: nil,
            isStreaming: true,
            isError: false,
            createdAt: .now,
            gatewayMessageId: nil)
        messages.append(msg)
        streamingMessageId = messageId
        return messages.count - 1
    }

    private func decodeSessionHistory(from frame: Frame) -> SessionHistoryData? {
        guard let data = frame.data,
              let jsonData = try? JSONSerialization.data(withJSONObject: data.value)
        else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(SessionHistoryData.self, from: jsonData)
    }

    private func extractMentions(from text: String) -> [ChatMention] {
        let source = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else { return [] }
        guard let regex = try? NSRegularExpression(pattern: "(^|\\s)@([A-Za-z0-9._-]{2,64})") else {
            return []
        }

        let nsSource = source as NSString
        let fullRange = NSRange(location: 0, length: nsSource.length)
        var mentions: [ChatMention] = []
        var seen = Set<String>()
        regex.enumerateMatches(in: source, options: [], range: fullRange) { match, _, stop in
            guard let match else { return }
            guard match.numberOfRanges >= 3 else { return }
            let handleRange = match.range(at: 2)
            guard handleRange.location != NSNotFound else { return }
            let value = nsSource.substring(with: handleRange).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return }
            let key = value.lowercased()
            guard !seen.contains(key) else { return }
            seen.insert(key)
            let mentionStart = max(0, handleRange.location - 1)
            mentions.append(ChatMention(
                id: nil,
                value: value,
                label: nil,
                kind: "unknown",
                start: mentionStart,
                end: handleRange.location + handleRange.length))
            if mentions.count >= 32 {
                stop.pointee = true
            }
        }
        return mentions
    }

    private func summarizedMessage(_ message: ChatUIMessage) -> String {
        let source = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            return message.role == "assistant" ? "Assistant message" : "Message"
        }
        let compact = source.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        if compact.count <= 120 { return compact }
        return "\(compact.prefix(117))..."
    }

    private func decodeToolCalls(
        _ raw: AnyCodable?,
        resultMap: [String: AnyCodable]
    ) -> [ChatUIToolCall] {
        guard let list = raw?.value as? [[String: Any]] else { return [] }

        return list.compactMap { item in
            guard let id = item["id"] as? String,
                  let name = item["name"] as? String
            else { return nil }

            let input = item["input"].map { AnyCodable($0) }
            let result = resultMap[id]
            let isError = result.map { isToolErrorPayload($0.value) } ?? false

            return ChatUIToolCall(
                id: id,
                name: name,
                input: input,
                result: result,
                isError: isError,
                startedAt: nil,
                durationMs: nil)
        }
    }

    private func decodeToolResults(_ raw: AnyCodable?) -> [String: AnyCodable] {
        guard let list = raw?.value as? [[String: Any]] else { return [:] }
        var map: [String: AnyCodable] = [:]

        for item in list {
            guard let toolUseId = item["tool_use_id"] as? String else { continue }
            let rawContent = item["content"]

            if let jsonString = rawContent as? String,
               let jsonData = jsonString.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: jsonData) {
                map[toolUseId] = AnyCodable(json)
                continue
            }
            if let rawContent {
                map[toolUseId] = AnyCodable(rawContent)
            }
        }
        return map
    }

    private func parseDate(_ iso: String) -> Date {
        if let parsed = Self.iso8601WithFractional.date(from: iso) {
            return parsed
        }
        if let parsed = Self.iso8601Basic.date(from: iso) {
            return parsed
        }
        return .now
    }

    private func sendReactionToggle(messageId: String, emoji: String) async {
        let gatewayWSURL = GatewayURLResolver.configuredGatewayURL()
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")

        guard let url = URL(string: "\(baseURL)/api/messages/\(messageId)/reactions") else {
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: String] = [
            "emoji": emoji,
            "actorId": Self.reactionActorId,
        ]
        request.httpBody = try? JSONEncoder().encode(payload)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return
            }
            let decoded = try JSONDecoder().decode(ReactionToggleResponse.self, from: data)
            let nextReactions = decoded.reactions ?? [:]
            if let idx = messages.firstIndex(where: { $0.id == decoded.messageId || $0.gatewayMessageId == decoded.messageId }) {
                messages[idx].reactions = nextReactions
            }
        } catch {
            // Keep reaction toggles best-effort and non-blocking for chat flow.
        }
    }

    private func sendPinToggle(messageId: String) async {
        let gatewayWSURL = GatewayURLResolver.configuredGatewayURL()
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")
        guard let url = URL(string: "\(baseURL)/api/messages/\(messageId)/pin") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            let decoded = try JSONDecoder().decode(PinToggleResponse.self, from: data)
            if let idx = messages.firstIndex(where: { $0.id == decoded.messageId || $0.gatewayMessageId == decoded.messageId }) {
                messages[idx].pinned = decoded.pinned
            }
        } catch {
            // Keep pin toggles best-effort and non-blocking for chat flow.
        }
    }

    private func sendReport(messageId: String, note: String?) async {
        let gatewayWSURL = GatewayURLResolver.configuredGatewayURL()
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")
        guard let url = URL(string: "\(baseURL)/api/messages/\(messageId)/report") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let trimmedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let payload: [String: String] = trimmedNote.isEmpty ? [:] : ["note": trimmedNote]
        request.httpBody = try? JSONEncoder().encode(payload)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            if let idx = messages.firstIndex(where: { $0.id == messageId || $0.gatewayMessageId == messageId }) {
                messages[idx].reported = true
                if !trimmedNote.isEmpty {
                    messages[idx].reportNote = trimmedNote
                }
            }
        } catch {
            // Keep report actions best-effort and non-blocking for chat flow.
        }
    }

    private func sendDeleteMessage(messageId: String) async {
        let gatewayWSURL = GatewayURLResolver.configuredGatewayURL()
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")
        guard let url = URL(string: "\(baseURL)/api/messages/\(messageId)") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            let removedIds = messages
                .filter { $0.id == messageId || $0.gatewayMessageId == messageId }
                .map(\.id)
            messages.removeAll { message in
                message.id == messageId || message.gatewayMessageId == messageId
            }
            for id in removedIds {
                selectedMessageIds.remove(id)
            }
            selectedMessageIds.remove(messageId)
        } catch {
            // Keep delete actions best-effort and non-blocking for chat flow.
        }
    }

    private func isToolErrorPayload(_ value: Any) -> Bool {
        guard let dict = value as? [String: Any] else { return false }
        return dict["error"] != nil
    }

    private func stripInternalTags(_ text: String) -> String {
        var cleaned = text.replacingOccurrences(
            of: "<think>[\\s\\S]*?</think>\\s*",
            with: "",
            options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(
            of: "<think>[\\s\\S]*$",
            with: "",
            options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(
            of: "\\[(happy|thinking|surprised|sad|excited|curious|amused|playful|warm|gentle|earnest|confident|thoughtful|serious|empathetic)\\]\\s*",
            with: "",
            options: [.regularExpression, .caseInsensitive])
        return cleaned
    }

    private static let iso8601WithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601Basic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
