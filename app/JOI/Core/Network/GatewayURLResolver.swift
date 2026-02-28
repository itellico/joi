import Foundation

enum GatewayURLResolver {
    private static let gatewayURLKey = "gatewayURL"
    private static let gatewayHomeURLKey = "gatewayHomeURL"
    private static let gatewayRoadURLKey = "gatewayRoadURL"
    private static let gatewayPublicURLKey = "gatewayPublicURL"
    private static let gatewaySecretKey = "gatewaySecret"
    private static let liveKitNetworkModeKey = "livekitNetworkMode"

    private static let localDefault = "ws://127.0.0.1:3100/ws"
    private static let homeInfoPlistKey = "JOI_GATEWAY_HOME_URL"
    private static let roadInfoPlistKey = "JOI_GATEWAY_ROAD_URL"
    private static let homeFallbackCandidates = [
        "ws://mini:3100/ws",
        "ws://mini.local:3100/ws",
        "ws://marcuss-mini:3100/ws",
        "ws://marcuss-mini.local:3100/ws",
    ]
    private static let roadFallbackCandidates = [
        "ws://marcuss-mini:3100/ws",
        "ws://marcuss-mini.local:3100/ws",
        "ws://mini:3100/ws",
        "ws://mini.local:3100/ws",
    ]
    private static let publicGatewayDefault = "https://joi.itellico.org"

#if os(iOS)
    enum ConnectivityRecommendation: String, Sendable {
        case preferHome
        case homeOnly
        case roadOnly
        case enableTailscale
        case gatewayUnavailable
    }

    struct ConnectivityDiagnostics: Sendable {
        let checkedAt: Date
        let configuredMode: String
        let activeGatewayURL: String
        let homeGatewayURL: String
        let roadGatewayURL: String
        let homeReachable: Bool
        let roadReachable: Bool
        let recommendedGatewayURL: String
        let recommendedMode: String
        let recommendation: ConnectivityRecommendation
        let guidance: String

        var detectedPathLabel: String {
            switch (homeReachable, roadReachable) {
            case (true, true):
                return "Local LAN + Tailscale"
            case (true, false):
                return "Local LAN"
            case (false, true):
                return "Tailscale"
            case (false, false):
                return "Unavailable"
            }
        }
    }

    static func diagnoseConnectivity(userDefaults: UserDefaults = .standard) async -> ConnectivityDiagnostics {
        let activeGatewayURL = configuredGatewayURL(userDefaults: userDefaults)
        var homeURL = homeGatewayURL(userDefaults)
        var roadURL = roadGatewayURL(userDefaults)
        let configuredMode = configuredNetworkMode(userDefaults)

        async let activeProbe = endpointIsReachable(activeGatewayURL)
        async let homeProbe = endpointIsReachable(homeURL)
        async let roadProbe = endpointIsReachable(roadURL)
        var homeReachable = await homeProbe
        var roadReachable = await roadProbe

        if !homeReachable,
           let discoveredHome = await discoverHomeGatewayURL(
               userDefaults: userDefaults,
               currentHomeURL: homeURL
           ) {
            homeURL = discoveredHome
            homeReachable = await endpointIsReachable(homeURL)
        }

        if !roadReachable,
           let discoveredRoad = await discoverRoadGatewayURL(
               userDefaults: userDefaults,
               currentRoadURL: roadURL
           ) {
            roadURL = discoveredRoad
            roadReachable = await endpointIsReachable(roadURL)
        }

        let activeReachable = await activeProbe
        if activeReachable,
           let activeHost = URL(string: activeGatewayURL)?.host?.lowercased() {
            if isLikelyTailscaleHost(activeHost) {
                roadReachable = true
                roadURL = activeGatewayURL
            } else if isPrivateLANHost(activeHost) || isLoopbackHost(activeHost) || isNamedLocalHost(activeHost) {
                homeReachable = true
                homeURL = activeGatewayURL
            }
        }

        let recommendedMode: String
        let recommendedGatewayURL: String
        let recommendation: ConnectivityRecommendation
        let guidance: String

        switch (homeReachable, roadReachable) {
        case (true, true):
            recommendedMode = "home"
            recommendedGatewayURL = homeURL
            recommendation = .preferHome
            guidance = "Mini is reachable on both LAN and Tailscale. JOI will prefer local LAN."
        case (true, false):
            recommendedMode = "home"
            recommendedGatewayURL = homeURL
            recommendation = .homeOnly
            guidance = "Mini is reachable on local LAN. If you leave home, enable Tailscale and retry."
        case (false, true):
            recommendedMode = "road"
            recommendedGatewayURL = roadURL
            recommendation = .roadOnly
            guidance = "LAN endpoint is offline, but Tailscale route works. JOI will use road mode."
        case (false, false):
            let roadPreferred = configuredMode == "road" || isLikelyTailscaleEndpoint(activeGatewayURL)
            if isLikelyTailscaleEndpoint(roadURL), roadPreferred {
                recommendedMode = "road"
                recommendedGatewayURL = roadURL
                recommendation = .enableTailscale
                guidance = "Neither route responded. If you're away from home, open Tailscale or VPN settings."
            } else {
                recommendedMode = roadPreferred ? "road" : "home"
                recommendedGatewayURL = roadPreferred ? roadURL : homeURL
                recommendation = .gatewayUnavailable
                guidance = "Neither LAN nor road route responded. Check Mini reachability and route settings, then tap Retry."
            }
        }

        return ConnectivityDiagnostics(
            checkedAt: Date(),
            configuredMode: configuredMode,
            activeGatewayURL: activeGatewayURL,
            homeGatewayURL: homeURL,
            roadGatewayURL: roadURL,
            homeReachable: homeReachable,
            roadReachable: roadReachable,
            recommendedGatewayURL: recommendedGatewayURL,
            recommendedMode: recommendedMode,
            recommendation: recommendation,
            guidance: guidance
        )
    }
#endif

    static func configuredGatewayURL(userDefaults: UserDefaults = .standard) -> String {
        if let stored = sanitizedURL(userDefaults.string(forKey: gatewayURLKey)),
           shouldUseStoredURL(stored) {
            return stored
        }
        return fallbackGatewayURL(userDefaults: userDefaults)
    }

    static func resolveStartupGatewayURL(
        userDefaults: UserDefaults = .standard,
        forceRefresh: Bool = false
    ) async -> String {
        if let stored = sanitizedURL(userDefaults.string(forKey: gatewayURLKey)),
           shouldUseStoredURL(stored),
           !forceRefresh {
#if os(iOS) && !targetEnvironment(simulator)
            if await endpointIsReachable(stored) {
                return stored
            }
#else
            return stored
#endif
        }

#if os(iOS) && !targetEnvironment(simulator)
        var currentHomeURL = homeGatewayURL(userDefaults)
        let currentRoadURL = roadGatewayURL(userDefaults)
        let mode = configuredNetworkMode(userDefaults)

        if mode == "home" {
            if await endpointIsReachable(currentHomeURL) {
                return currentHomeURL
            }
            if let discoveredHomeURL = await discoverHomeGatewayURL(
                userDefaults: userDefaults,
                currentHomeURL: currentHomeURL
            ) {
                currentHomeURL = discoveredHomeURL
                return discoveredHomeURL
            }
            if let discoveredRoadURL = await discoverRoadGatewayURL(
                userDefaults: userDefaults,
                currentRoadURL: currentRoadURL
            ) {
                return discoveredRoadURL
            }
            return currentHomeURL
        }

        if mode == "road" {
            if await endpointIsReachable(currentRoadURL) {
                return currentRoadURL
            }
            if let discoveredRoadURL = await discoverRoadGatewayURL(
                userDefaults: userDefaults,
                currentRoadURL: currentRoadURL
            ) {
                return discoveredRoadURL
            }
            if let discoveredHomeURL = await discoverHomeGatewayURL(
                userDefaults: userDefaults,
                currentHomeURL: currentHomeURL
            ) {
                return discoveredHomeURL
            }
            return currentRoadURL
        }

        // auto mode
        if await endpointIsReachable(currentHomeURL) {
            return currentHomeURL
        }

        if let discoveredHomeURL = await discoverHomeGatewayURL(
            userDefaults: userDefaults,
            currentHomeURL: currentHomeURL
        ) {
            currentHomeURL = discoveredHomeURL
            return discoveredHomeURL
        }

        if await endpointIsReachable(currentRoadURL) {
            return currentRoadURL
        }

        if let discoveredRoadURL = await discoverRoadGatewayURL(
            userDefaults: userDefaults,
            currentRoadURL: currentRoadURL
        ) {
            return discoveredRoadURL
        }

        return currentHomeURL
#else
        return fallbackGatewayURL(userDefaults: userDefaults)
#endif
    }

    static func persistGatewayURL(_ urlString: String, userDefaults: UserDefaults = .standard) {
        let normalized = sanitizedURL(urlString) ?? urlString
        userDefaults.set(normalized, forKey: gatewayURLKey)
    }

    static func registerResolvedNetworkTarget(
        _ targetIP: String,
        mode: String?,
        userDefaults: UserDefaults = .standard
    ) {
        guard isIPv4Literal(targetIP) else { return }
        let gatewayURL = "ws://\(targetIP):3100/ws"
        persistGatewayURL(gatewayURL, userDefaults: userDefaults)

        let normalizedMode = mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedMode == "road" {
            userDefaults.set(gatewayURL, forKey: gatewayRoadURLKey)
        } else if normalizedMode == "home" {
            userDefaults.set(gatewayURL, forKey: gatewayHomeURLKey)
        }
    }

    static func normalizedManualGatewayURL(_ rawValue: String) -> String? {
        sanitizedURL(rawValue)
    }

    static func inferredCurrentRouteMode(userDefaults: UserDefaults = .standard) -> String? {
        let currentGateway = configuredGatewayURL(userDefaults: userDefaults)
        guard let host = URL(string: currentGateway)?.host?.lowercased() else {
            return nil
        }

        let homeHost = URL(string: homeGatewayURL(userDefaults))?.host?.lowercased()
        if host == homeHost {
            return "home"
        }

        let roadHost = URL(string: roadGatewayURL(userDefaults))?.host?.lowercased()
        if host == roadHost {
            return "road"
        }

        if isLoopbackHost(host) {
            return "local"
        }
        if isLikelyTailscaleHost(host) {
            return "road"
        }
        if isPrivateLANHost(host) {
            return "home"
        }
        return nil
    }

    private static func fallbackGatewayURL(userDefaults: UserDefaults) -> String {
#if os(iOS)
#if targetEnvironment(simulator)
        return localDefault
#else
        let mode = configuredNetworkMode(userDefaults)
        switch mode {
        case "road":
            return roadGatewayURL(userDefaults)
        case "home", "auto":
            return homeGatewayURL(userDefaults)
        default:
            return homeGatewayURL(userDefaults)
        }
#endif
#else
        return localDefault
#endif
    }

    private static func homeGatewayURL(_ userDefaults: UserDefaults) -> String {
        if let persisted = sanitizedURL(userDefaults.string(forKey: gatewayHomeURLKey)) {
            return persisted
        }
        return bundledOrFallbackGatewayURL(
            infoPlistKey: homeInfoPlistKey,
            envKey: homeInfoPlistKey,
            fallbackCandidates: homeFallbackCandidates
        )
    }

    private static func roadGatewayURL(_ userDefaults: UserDefaults) -> String {
        if let persisted = sanitizedURL(userDefaults.string(forKey: gatewayRoadURLKey)) {
            return persisted
        }
        return bundledOrFallbackGatewayURL(
            infoPlistKey: roadInfoPlistKey,
            envKey: roadInfoPlistKey,
            fallbackCandidates: roadFallbackCandidates
        )
    }

    private static func bundledOrFallbackGatewayURL(
        infoPlistKey: String,
        envKey: String,
        fallbackCandidates: [String]
    ) -> String {
        if let envValue = sanitizedURL(ProcessInfo.processInfo.environment[envKey]) {
            return envValue
        }

        if let plistValue = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String,
           let normalized = sanitizedURL(plistValue) {
            return normalized
        }

        for candidate in fallbackCandidates {
            if let normalized = sanitizedURL(candidate) {
                return normalized
            }
        }

        return localDefault
    }

    @Sendable
    private static func discoverHomeGatewayURL(
        userDefaults: UserDefaults,
        currentHomeURL: String
    ) async -> String? {
        if let discoveredFromBootstrap = await fetchGatewayFromBootstrap(
            userDefaults: userDefaults,
            preferredMode: "home"
        ), await endpointIsReachable(discoveredFromBootstrap) {
            userDefaults.set(discoveredFromBootstrap, forKey: gatewayHomeURLKey)
            return discoveredFromBootstrap
        }

        var candidates: [String] = [currentHomeURL]
        candidates.append(contentsOf: homeFallbackCandidates)
        if let persistedHome = sanitizedURL(userDefaults.string(forKey: gatewayHomeURLKey)) {
            candidates.insert(persistedHome, at: 0)
        }

        for candidate in dedupedGatewayCandidates(candidates) where await endpointIsReachable(candidate) {
            if candidate != currentHomeURL {
                userDefaults.set(candidate, forKey: gatewayHomeURLKey)
            }
            return candidate
        }

        return nil
    }

    @Sendable
    private static func discoverRoadGatewayURL(
        userDefaults: UserDefaults,
        currentRoadURL: String
    ) async -> String? {
        if let discoveredFromBootstrap = await fetchGatewayFromBootstrap(
            userDefaults: userDefaults,
            preferredMode: "road"
        ), await endpointIsReachable(discoveredFromBootstrap) {
            userDefaults.set(discoveredFromBootstrap, forKey: gatewayRoadURLKey)
            return discoveredFromBootstrap
        }

        var candidates: [String] = [currentRoadURL]
        candidates.append(contentsOf: roadFallbackCandidates)
        if let persistedRoad = sanitizedURL(userDefaults.string(forKey: gatewayRoadURLKey)) {
            candidates.insert(persistedRoad, at: 0)
        }

        for candidate in dedupedGatewayCandidates(candidates) where await endpointIsReachable(candidate) {
            if candidate != currentRoadURL {
                userDefaults.set(candidate, forKey: gatewayRoadURLKey)
            }
            return candidate
        }

        return nil
    }

    @Sendable
    private static func fetchGatewayFromBootstrap(
        userDefaults: UserDefaults,
        preferredMode: String
    ) async -> String? {
        for bootstrapBaseURL in bootstrapGatewayBaseURLs(userDefaults: userDefaults) {
            guard var components = URLComponents(
                url: bootstrapBaseURL.appendingPathComponent("api/livekit/config"),
                resolvingAgainstBaseURL: false
            ) else {
                continue
            }

            components.queryItems = [URLQueryItem(name: "networkMode", value: preferredMode)]
            guard let url = components.url else { continue }

            var request = URLRequest(url: url)
            request.timeoutInterval = 1.5
            request.cachePolicy = .reloadIgnoringLocalCacheData
            if let secret = userDefaults.string(forKey: gatewaySecretKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
               !secret.isEmpty {
                request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
            }

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse,
                      httpResponse.statusCode == 200 else {
                    continue
                }

                if let payload = try? JSONDecoder().decode(BootstrapConfigPayload.self, from: data),
                   let networkTarget = payload.networkTargetIp?.trimmingCharacters(in: .whitespacesAndNewlines),
                   isIPv4Literal(networkTarget) {
                    return "ws://\(networkTarget):3100/ws"
                }

                if let payload = try? JSONDecoder().decode(BootstrapConfigPayload.self, from: data),
                   let rawURL = payload.url,
                   let normalized = sanitizedURL(rawURL) {
                    return normalized
                }
            } catch {
                continue
            }
        }

        return nil
    }

    private static func dedupedGatewayCandidates(_ candidates: [String]) -> [String] {
        var deduped: [String] = []
        var seen = Set<String>()
        for candidate in candidates {
            guard let normalized = sanitizedURL(candidate) else { continue }
            if seen.insert(normalized).inserted {
                deduped.append(normalized)
            }
        }
        return deduped
    }

    private static func bootstrapGatewayBaseURLs(userDefaults: UserDefaults) -> [URL] {
        let rawValues: [String] = [
            userDefaults.string(forKey: gatewayPublicURLKey) ?? "",
            publicGatewayDefault,
        ]

        var urls: [URL] = []
        var seen = Set<String>()
        for raw in rawValues {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            let normalized = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
            guard let url = URL(string: normalized) else { continue }
            let key = url.absoluteString
            if seen.insert(key).inserted {
                urls.append(url)
            }
        }
        return urls
    }

    private static func configuredNetworkMode(_ userDefaults: UserDefaults) -> String {
        let raw = userDefaults.string(forKey: liveKitNetworkModeKey) ?? "auto"
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "home", "road":
            return normalized
        default:
            return "auto"
        }
    }

    private static func shouldUseStoredURL(_ urlString: String) -> Bool {
#if os(iOS) && !targetEnvironment(simulator)
        guard let host = URL(string: urlString)?.host?.lowercased() else {
            return true
        }
        if isNamedLocalHost(host) || host == "localhost" || host == "::1" || host.hasPrefix("127.") {
            return false
        }
#endif
        return true
    }

    private static func sanitizedURL(_ rawValue: String?) -> String? {
        guard var value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }

        if !value.contains("://") {
            value = "ws://\(value)"
        }
        if value.hasPrefix("http://") {
            value = value.replacingOccurrences(of: "http://", with: "ws://")
        } else if value.hasPrefix("https://") {
            value = value.replacingOccurrences(of: "https://", with: "wss://")
        }

        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              (scheme == "ws" || scheme == "wss"),
              components.host != nil else {
            return nil
        }

        if let host = components.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           host == "localhost" || host == "::1" {
            // Avoid IPv6 localhost resolution on Simulator/WebSocket path.
            components.host = "127.0.0.1"
        }

        if components.path.isEmpty || components.path == "/" {
            components.path = "/ws"
        }

        return components.url?.absoluteString
    }

    private static func endpointIsReachable(_ wsURL: String) async -> Bool {
        guard let healthURL = healthURL(from: wsURL) else {
            return false
        }

        var request = URLRequest(url: healthURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 1.0

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1.0
        config.timeoutIntervalForResource = 1.0

        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        do {
            let (_, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return false
            }
            return (200..<500).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }

    private static func healthURL(from wsURL: String) -> URL? {
        var base = wsURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
        if base.hasSuffix("/ws") {
            base = String(base.dropLast(3))
        }
        return URL(string: "\(base)/health")
    }

    private static func isIPv4Literal(_ rawValue: String) -> Bool {
        let parts = rawValue.split(separator: ".")
        guard parts.count == 4 else { return false }
        for part in parts {
            guard let value = Int(part), value >= 0, value <= 255 else { return false }
        }
        return true
    }

    private static func isLikelyTailscaleEndpoint(_ wsURL: String) -> Bool {
        guard let host = URL(string: wsURL)?.host?.lowercased() else {
            return false
        }
        return isLikelyTailscaleHost(host)
    }

    private static func isLikelyTailscaleHost(_ host: String) -> Bool {
        if host.hasSuffix(".ts.net") || host.hasSuffix(".beta.tailscale.net") {
            return true
        }
        return isCGNATAddress(host)
    }

    private static func isCGNATAddress(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        guard parts.count == 4,
              let first = Int(parts[0]),
              let second = Int(parts[1]) else {
            return false
        }
        return first == 100 && second >= 64 && second <= 127
    }

    private static func isPrivateLANHost(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        guard parts.count == 4,
              let first = Int(parts[0]),
              let second = Int(parts[1]) else {
            return false
        }
        if first == 10 {
            return true
        }
        if first == 172 && second >= 16 && second <= 31 {
            return true
        }
        return first == 192 && second == 168
    }

    private static func isLoopbackHost(_ host: String) -> Bool {
        host == "localhost" || host == "::1" || host.hasPrefix("127.")
    }

    private static func isNamedLocalHost(_ host: String) -> Bool {
        host == "mini" || host == "marcuss-mini"
    }

    private struct BootstrapConfigPayload: Decodable {
        let url: String?
        let networkTargetIp: String?
    }
}
