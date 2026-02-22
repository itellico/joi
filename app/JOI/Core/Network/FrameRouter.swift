import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class FrameRouter {
    private let log = Logger(subsystem: "com.joi.app", category: "FrameRouter")
    // Chat events
    var lastChatStream: ChatStreamData?
    var lastChatDone: ChatDoneData?
    var lastChatError: String?
    var lastChatPlan: ChatPlanData?
    var lastToolUse: ChatToolUseData?
    var lastToolResult: ChatToolResultData?

    // Session events
    var sessionList: [SessionInfo] = []
    var sessionHistory: SessionHistoryData?

    // System
    var systemConnected = false

    // Callbacks for view models to subscribe
    var onChatStream: (@MainActor (ChatStreamData) -> Void)?
    var onChatDone: (@MainActor (ChatDoneData) -> Void)?
    var onChatError: (@MainActor (String) -> Void)?
    var onChatPlan: (@MainActor (ChatPlanData) -> Void)?
    var onChatToolUse: (@MainActor (ChatToolUseData) -> Void)?
    var onChatToolResult: (@MainActor (ChatToolResultData) -> Void)?
    var onSessionData: (@MainActor (Frame) -> Void)?

    func route(_ frame: Frame) {
        switch frame.type {
        case .chatStream:
            guard let data = decode(ChatStreamData.self, from: frame.data) else { return }
            lastChatStream = data
            onChatStream?(data)

        case .chatDone:
            guard let data = decode(ChatDoneData.self, from: frame.data) else { return }
            lastChatDone = data
            onChatDone?(data)

        case .chatError:
            // Error message may be in data.error (gateway convention) or frame.error
            let dataError: String? = {
                guard let dict = frame.data?.value as? [String: Any] else { return nil }
                return dict["error"] as? String
            }()
            let errorMsg = dataError ?? frame.error ?? "Unknown chat error"
            lastChatError = errorMsg
            onChatError?(errorMsg)

        case .chatPlan:
            guard let data = decode(ChatPlanData.self, from: frame.data) else { return }
            lastChatPlan = data
            onChatPlan?(data)

        case .chatToolUse:
            if let data = decode(ChatToolUseData.self, from: frame.data) {
                lastToolUse = data
                onChatToolUse?(data)
            }

        case .chatToolResult:
            if let data = decode(ChatToolResultData.self, from: frame.data) {
                lastToolResult = data
                onChatToolResult?(data)
            }

        case .sessionData:
            handleSessionData(frame)

        case .systemStatus:
            systemConnected = true

        case .systemPong:
            break

        default:
            break
        }
    }

    private func handleSessionData(_ frame: Frame) {
        guard let data = frame.data else { return }

        // Try to decode as session list
        if let listData = decode(SessionListData.self, from: data) {
            sessionList = listData.sessions
        }

        // Try to decode as session history
        if let historyData = decode(SessionHistoryData.self, from: data) {
            sessionHistory = historyData
        }

        onSessionData?(frame)
    }

    private func decode<T: Decodable>(_ type: T.Type, from anyCodable: AnyCodable?) -> T? {
        guard let anyCodable else { return nil }
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: anyCodable.value)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(T.self, from: jsonData)
        } catch {
            log.error("Decode \(String(describing: T.self)) failed: \(error.localizedDescription)")
            return nil
        }
    }
}
