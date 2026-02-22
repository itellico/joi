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
    var isStreaming: Bool
    var isError: Bool
    let createdAt: Date
    /// Gateway's authoritative message ID (for persistence), may differ from `id`
    var gatewayMessageId: String?
}

@MainActor
@Observable
final class ChatViewModel {
    var messages: [ChatUIMessage] = []
    var activeConversationId: String?
    var isStreaming = false
    var inputText = ""

    private struct PendingChatSend {
        let conversationId: String?
        let content: String
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
        guard !text.isEmpty else { return }
        guard let webSocket else { return }
        inputText = ""

        log.info("Sending message: '\(text.prefix(50))' (ws=\(webSocket.isConnected))")

        // Optimistic user bubble
        let userMsg = ChatUIMessage(
            id: UUID().uuidString,
            role: "user",
            content: text,
            isStreaming: false,
            isError: false,
            createdAt: .now)
        messages.append(userMsg)

        pendingSends.append(PendingChatSend(
            conversationId: activeConversationId,
            content: text))

        if webSocket.isConnected {
            flushPendingSendsIfPossible()
        } else {
            log.warning("Queued send while websocket is \(String(describing: webSocket.state))")
            appendConnectionError("JOI is reconnecting. Message queued and will send automatically.")
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
        activeConversationId = nil
        messages = []
        resetStreamingState()
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
                    isStreaming: false,
                    isError: false,
                    createdAt: parseDate(msg.createdAt),
                    gatewayMessageId: msg.id)
        }
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
            content: next.content)
        webSocket.send(type: .chatSend, data: payload)
        startStreamingTurn()
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
