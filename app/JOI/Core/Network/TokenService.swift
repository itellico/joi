import Foundation

/// Fetches LiveKit connection tokens from the JOI gateway.
actor TokenService {
    struct ConnectionDetails: Sendable {
        let serverUrl: String
        let token: String
        let roomName: String
        let conversationId: String?
    }

    /// Fetch a LiveKit token from the gateway's REST endpoint.
    func fetchConnectionDetails(
        conversationId: String? = nil,
        agentId: String? = nil
    ) async throws -> ConnectionDetails {
        let gatewayWSURL = UserDefaults.standard.string(forKey: "gatewayURL")
            ?? "ws://localhost:3100/ws"

        // Convert ws:// URL to http:// for REST calls
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")

        guard let url = URL(string: "\(baseURL)/api/livekit/token") else {
            throw TokenError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: String] = [:]
        body["participantName"] = "user"
        if let conversationId { body["conversationId"] = conversationId }
        if let agentId { body["agentId"] = agentId }

        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw TokenError.serverError(statusCode)
        }

        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)

        return ConnectionDetails(
            serverUrl: decoded.serverUrl,
            token: decoded.token,
            roomName: decoded.roomName,
            conversationId: decoded.conversationId
        )
    }

    enum TokenError: LocalizedError {
        case invalidURL
        case serverError(Int)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Invalid gateway URL"
            case .serverError(let code):
                return "Token request failed (HTTP \(code))"
            }
        }
    }

    private struct TokenResponse: Decodable {
        let serverUrl: String
        let token: String
        let roomName: String
        let conversationId: String?
    }
}
