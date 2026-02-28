import AppIntents
import Foundation

struct AskJOIIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask JOI"
    static let description: IntentDescription = "Send a message to JOI and get a response."

    @Parameter(title: "Message")
    var message: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask JOI \(\.$message)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let response = try await sendAndWait(message: message)
        return .result(value: response, dialog: IntentDialog(stringLiteral: response))
    }

    private func sendAndWait(message: String) async throws -> String {
        let gatewayURL = await GatewayURLResolver.resolveStartupGatewayURL()
        GatewayURLResolver.persistGatewayURL(gatewayURL)

        guard let url = URL(string: gatewayURL) else {
            throw IntentError.gatewayUnavailable
        }

        let config = URLSessionConfiguration.default
        let session = URLSession(configuration: config)
        let ws = session.webSocketTask(with: url)
        ws.resume()

        defer {
            ws.cancel(with: .goingAway, reason: nil)
            session.invalidateAndCancel()
        }

        // Send chat.send frame
        let payload = ChatSendData(content: message)
        guard let frameText = makeFrame(type: .chatSend, data: payload) else {
            throw IntentError.encodingFailed
        }
        try await ws.send(.string(frameText))

        // Wait for chat.done (30s timeout)
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            let msg = try await ws.receive()
            switch msg {
            case .string(let text):
                if let frame = parseFrame(raw: text), frame.type == .chatDone {
                    if let data = frame.data,
                       let jsonData = try? JSONSerialization.data(withJSONObject: data.value),
                       let done = try? JSONDecoder().decode(ChatDoneData.self, from: jsonData) {
                        return done.content
                    }
                }
            default:
                break
            }
        }

        throw IntentError.timeout
    }

    enum IntentError: Error, CustomLocalizedStringResourceConvertible {
        case gatewayUnavailable
        case encodingFailed
        case timeout

        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .gatewayUnavailable: "Gateway unavailable"
            case .encodingFailed: "Failed to encode message"
            case .timeout: "JOI didn't respond in time"
            }
        }
    }
}

struct OpenJOIVoiceIntent: AppIntent {
    static let title: LocalizedStringResource = "Open JOI Voice"
    static let description: IntentDescription = "Open JOI in voice mode."
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        // The app will open and can check for this intent to auto-start voice mode
        return .result()
    }
}

struct JOIShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenJOIVoiceIntent(),
            phrases: [
                "Open \(.applicationName) voice",
                "Start \(.applicationName) voice mode",
            ],
            shortTitle: "Voice Mode",
            systemImageName: "mic.fill")
    }
}
