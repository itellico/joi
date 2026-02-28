import Foundation

/// Fetches LiveKit connection tokens from the JOI gateway.
actor TokenService {
    struct ConnectionDetails: Sendable {
        let serverUrl: String
        let token: String
        let roomName: String
        let conversationId: String?
        let networkMode: String?
        let networkTargetIp: String?
        let networkClientIp: String?
    }

    /// Fetch a LiveKit token from the gateway's REST endpoint.
    func fetchConnectionDetails(
        conversationId: String? = nil,
        agentId: String? = nil
    ) async throws -> ConnectionDetails {
        let primaryGatewayURL = await GatewayURLResolver.resolveStartupGatewayURL()
        GatewayURLResolver.persistGatewayURL(primaryGatewayURL)

        do {
            return try await requestConnectionDetails(
                gatewayWSURL: primaryGatewayURL,
                conversationId: conversationId,
                agentId: agentId
            )
        } catch {
            guard shouldRetryAfter(error: error) else { throw error }

            let refreshedGatewayURL = await GatewayURLResolver.resolveStartupGatewayURL(forceRefresh: true)
            guard refreshedGatewayURL != primaryGatewayURL else { throw error }

            GatewayURLResolver.persistGatewayURL(refreshedGatewayURL)
            return try await requestConnectionDetails(
                gatewayWSURL: refreshedGatewayURL,
                conversationId: conversationId,
                agentId: agentId
            )
        }
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
        let networkMode: String?
        let networkTargetIp: String?
        let networkClientIp: String?
    }

    private func requestConnectionDetails(
        gatewayWSURL: String,
        conversationId: String?,
        agentId: String?
    ) async throws -> ConnectionDetails {
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
        if let secret = UserDefaults.standard.string(forKey: "gatewaySecret"),
           !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        }

        var body: [String: String] = [:]
        body["participantName"] = "user"
        if let conversationId { body["conversationId"] = conversationId }
        if let agentId { body["agentId"] = agentId }
        body["networkMode"] = "auto"
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw TokenError.serverError(statusCode)
        }

        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        if let targetIP = decoded.networkTargetIp {
            GatewayURLResolver.registerResolvedNetworkTarget(targetIP, mode: decoded.networkMode)
        }

        return ConnectionDetails(
            serverUrl: decoded.serverUrl,
            token: decoded.token,
            roomName: decoded.roomName,
            conversationId: decoded.conversationId,
            networkMode: decoded.networkMode,
            networkTargetIp: decoded.networkTargetIp,
            networkClientIp: decoded.networkClientIp
        )
    }

    private func shouldRetryAfter(error: Error) -> Bool {
        if let tokenError = error as? TokenError {
            switch tokenError {
            case .invalidURL:
                return true
            case .serverError(let statusCode):
                // 5xx indicates temporary server/gateway route issues.
                return statusCode >= 500 && statusCode < 600
            }
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut, .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet, .cannotFindHost:
                return true
            default:
                return false
            }
        }

        return false
    }
}
