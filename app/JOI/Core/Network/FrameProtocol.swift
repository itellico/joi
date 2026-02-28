import Foundation

enum FrameType: String, Codable, Sendable {
    // Chat
    case chatSend = "chat.send"
    case chatStream = "chat.stream"
    case chatDone = "chat.done"
    case chatError = "chat.error"
    case chatPlan = "chat.plan"
    case chatToolUse = "chat.tool_use"
    case chatToolResult = "chat.tool_result"
    case chatInterrupt = "chat.interrupt"

    // Session
    case sessionList = "session.list"
    case sessionLoad = "session.load"
    case sessionCreate = "session.create"
    case sessionData = "session.data"

    // Agent
    case agentList = "agent.list"
    case agentData = "agent.data"

    // PTY
    case ptySpawn = "pty.spawn"
    case ptyInput = "pty.input"
    case ptyOutput = "pty.output"
    case ptyResize = "pty.resize"
    case ptyKill = "pty.kill"
    case ptyList = "pty.list"
    case ptyData = "pty.data"
    case ptyExit = "pty.exit"

    // Logging & Reviews
    case logEntry = "log.entry"
    case reviewCreated = "review.created"
    case reviewResolved = "review.resolved"
    case reviewResolve = "review.resolve"

    // Channel
    case channelStatus = "channel.status"
    case channelQr = "channel.qr"
    case channelMessage = "channel.message"

    // Notifications
    case notificationPush = "notification.push"

    // AutoDev (ignored by JOI app UI but accepted to avoid noisy parse failures)
    case autodevStatus = "autodev.status"
    case autodevLog = "autodev.log"

    // System
    case systemStatus = "system.status"
    case systemPing = "system.ping"
    case systemPong = "system.pong"
}

struct Frame: Codable, Sendable {
    let type: FrameType
    var id: String?
    var data: AnyCodable?
    var error: String?
}

// MARK: - Chat Payloads

struct ChatSendData: Codable, Sendable {
    var conversationId: String?
    var agentId: String?
    let content: String
    var model: String?
    var mode: String?
    var proactive: Bool?
    var attachments: [ChatAttachment]?
    var replyToMessageId: String?
    var forwardOfMessageId: String?
    var mentions: [ChatMention]?
    var transcriberModel: String? = nil
}

struct ChatAttachment: Codable, Sendable {
    let type: String
    var url: String? = nil
    var data: String? = nil
    var name: String? = nil
    var mimeType: String? = nil
    var mediaId: String? = nil
    var size: Int? = nil
}

struct ChatMention: Codable, Sendable {
    var id: String?
    var value: String
    var label: String?
    var kind: String?
    var start: Int?
    var end: Int?
}

struct ChatStreamData: Codable, Sendable {
    var conversationId: String?
    var messageId: String?
    let delta: String
    var model: String?
}

struct ChatDoneData: Codable, Sendable {
    var conversationId: String?
    let messageId: String
    let content: String
    let model: String
    var provider: String?
    var toolModel: String?
    var toolProvider: String?
    var usage: ChatUsage?
    var latencyMs: Int?
    var ttftMs: Int?
    var costUsd: Double?
}

struct ChatUsage: Codable, Sendable {
    var inputTokens: Int
    var outputTokens: Int
    var voiceCache: ChatVoiceCache?

    enum CodingKeys: String, CodingKey {
        case inputTokens
        case outputTokens
        case voiceCache
    }

    init(inputTokens: Int, outputTokens: Int, voiceCache: ChatVoiceCache? = nil) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.voiceCache = voiceCache
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inputTokens = (try? container.decode(Int.self, forKey: .inputTokens)) ?? 0
        outputTokens = (try? container.decode(Int.self, forKey: .outputTokens)) ?? 0
        voiceCache = try? container.decode(ChatVoiceCache.self, forKey: .voiceCache)
    }
}

struct ChatVoiceCache: Codable, Sendable {
    var cacheHits: Int?
    var cacheMisses: Int?
    var cacheHitChars: Int?
    var cacheMissChars: Int?
    var cacheHitAudioBytes: Int?
    var cacheMissAudioBytes: Int?
    var segments: Int?
    var hitRate: Double?
}

struct ChatPlanData: Codable, Sendable {
    var conversationId: String?
    var steps: [String]
}

struct ChatToolUseData: Codable, Sendable {
    let conversationId: String
    let messageId: String
    let toolName: String
    let toolInput: AnyCodable
    let toolUseId: String
}

struct ChatToolResultData: Codable, Sendable {
    let conversationId: String
    let messageId: String
    let toolUseId: String
    let result: AnyCodable
}

// MARK: - Session Payloads

struct SessionListData: Codable, Sendable {
    let sessions: [SessionInfo]
}

struct SessionInfo: Codable, Sendable, Identifiable {
    let id: String
    let title: String?
    let agentId: String
    let messageCount: Int
    let lastMessage: String?
    let updatedAt: String
}

struct SessionLoadData: Codable, Sendable {
    let conversationId: String
}

struct SessionHistoryData: Codable, Sendable {
    let conversationId: String
    let messages: [SessionMessage]
}

struct SessionMessage: Codable, Sendable {
    let id: String
    let role: String
    let content: String?
    var toolCalls: AnyCodable?
    var toolResults: AnyCodable?
    var model: String?
    var provider: String?
    var toolModel: String?
    var toolProvider: String?
    var tokenUsage: ChatUsage?
    var attachments: [ChatAttachment]?
    var replyToMessageId: String?
    var forwardOfMessageId: String?
    var mentions: [ChatMention]?
    var forwardingMetadata: AnyCodable?
    var reactions: [String: [String]]?
    var pinned: Bool?
    var reported: Bool?
    var reportNote: String?
    var latencyMs: Int?
    var costUsd: Double?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case role
        case content
        case toolCalls = "tool_calls"
        case toolResults = "tool_results"
        case model
        case provider
        case toolModel = "tool_model"
        case toolProvider = "tool_provider"
        case tokenUsage = "token_usage"
        case attachments
        case replyToMessageId = "reply_to_message_id"
        case forwardOfMessageId = "forward_of_message_id"
        case mentions
        case forwardingMetadata = "forwarding_metadata"
        case reactions
        case pinned
        case reported
        case reportNote = "report_note"
        case latencyMs = "latency_ms"
        case costUsd = "cost_usd"
        case createdAt = "created_at"
    }
}

// MARK: - Frame Helpers

func makeFrame(type: FrameType, data: (any Encodable & Sendable)? = nil, id: String? = nil) -> String? {
    var dict: [String: Any] = ["type": type.rawValue]
    if let id { dict["id"] = id }
    if let data {
        let encoder = JSONEncoder()
        if let encoded = try? encoder.encode(data),
           let obj = try? JSONSerialization.jsonObject(with: encoded) {
            dict["data"] = obj
        }
    }
    guard let jsonData = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
    return String(data: jsonData, encoding: .utf8)
}

func parseFrame(raw: String) -> Frame? {
    guard let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Frame.self, from: data)
}

// MARK: - AnyCodable

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
