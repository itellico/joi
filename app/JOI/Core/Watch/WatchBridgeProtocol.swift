import Foundation

enum WatchBridgeMessageType: String {
    case command
    case status
}

enum WatchBridgeCommand: String, CaseIterable {
    case requestStatus = "request_status"
    case startVoice = "start_voice"
    case stopVoice = "stop_voice"
    case tapToTalk = "tap_to_talk"
    case pressToTalkStart = "press_to_talk_start"
    case pressToTalkEnd = "press_to_talk_end"
    case interrupt = "interrupt"
    case mute = "mute"
    case unmute = "unmute"
}

struct WatchBridgeStatusSnapshot: Equatable, Sendable {
    let voiceState: String
    let statusText: String
    let isActive: Bool
    let isMuted: Bool
    let capturedTranscript: String?
    let errorMessage: String?
    let updatedAt: TimeInterval
}

enum WatchBridgePayload {
    static let messageType = "messageType"
    static let command = "command"
    static let voiceState = "voiceState"
    static let statusText = "statusText"
    static let isActive = "isActive"
    static let isMuted = "isMuted"
    static let capturedTranscript = "capturedTranscript"
    static let errorMessage = "errorMessage"
    static let updatedAt = "updatedAt"

    static func command(_ command: WatchBridgeCommand) -> [String: Any] {
        [
            messageType: WatchBridgeMessageType.command.rawValue,
            self.command: command.rawValue,
        ]
    }

    static func status(_ snapshot: WatchBridgeStatusSnapshot) -> [String: Any] {
        var payload: [String: Any] = [
            messageType: WatchBridgeMessageType.status.rawValue,
            voiceState: snapshot.voiceState,
            statusText: snapshot.statusText,
            isActive: snapshot.isActive,
            isMuted: snapshot.isMuted,
            updatedAt: snapshot.updatedAt,
        ]
        if let capturedTranscript = snapshot.capturedTranscript, !capturedTranscript.isEmpty {
            payload[self.capturedTranscript] = capturedTranscript
        }
        if let errorMessage = snapshot.errorMessage, !errorMessage.isEmpty {
            payload[self.errorMessage] = errorMessage
        }
        return payload
    }

    static func parseCommand(from payload: [String: Any]) -> WatchBridgeCommand? {
        guard payload[messageType] as? String == WatchBridgeMessageType.command.rawValue else {
            return nil
        }
        guard let raw = payload[command] as? String else {
            return nil
        }
        return WatchBridgeCommand(rawValue: raw)
    }

    static func parseStatus(from payload: [String: Any]) -> WatchBridgeStatusSnapshot? {
        guard payload[messageType] as? String == WatchBridgeMessageType.status.rawValue else {
            return nil
        }
        guard
            let voiceState = payload[self.voiceState] as? String,
            let statusText = payload[self.statusText] as? String,
            let isActive = payload[self.isActive] as? Bool,
            let isMuted = payload[self.isMuted] as? Bool
        else {
            return nil
        }

        let capturedTranscript = payload[self.capturedTranscript] as? String
        let errorMessage = payload[self.errorMessage] as? String
        let updatedAt = payload[self.updatedAt] as? TimeInterval ?? Date().timeIntervalSince1970

        return WatchBridgeStatusSnapshot(
            voiceState: voiceState,
            statusText: statusText,
            isActive: isActive,
            isMuted: isMuted,
            capturedTranscript: capturedTranscript,
            errorMessage: errorMessage,
            updatedAt: updatedAt
        )
    }
}
