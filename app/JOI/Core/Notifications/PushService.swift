import Foundation
import UserNotifications
import OSLog
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@MainActor
@Observable
final class PushService: NSObject, Sendable {
    private(set) var isRegistered = false
    private(set) var deviceToken: String?
    private(set) var permissionGranted = false
    private(set) var lastError: String?

    private let logger = Logger(subsystem: "com.joi.app", category: "Push")

    // Request notification permission and register for remote notifications
    func requestPermission() async {
        do {
            let center = UNUserNotificationCenter.current()
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            permissionGranted = granted

            if granted {
                logger.info("Push permission granted")
                registerForRemoteNotifications()
            } else {
                logger.info("Push permission denied")
            }
        } catch {
            lastError = error.localizedDescription
            logger.error("Push permission error: \(error.localizedDescription)")
        }
    }

    // Register with APNs
    private func registerForRemoteNotifications() {
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #elseif canImport(AppKit)
        NSApplication.shared.registerForRemoteNotifications()
        #endif
    }

    // Called by AppDelegate when token is received
    func didRegisterForRemoteNotifications(deviceToken data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        self.deviceToken = token
        self.isRegistered = true
        logger.info("APNs token: \(token.prefix(16))...")

        // Send token to gateway
        Task {
            await registerTokenWithGateway(token: token)
        }
    }

    // Called by AppDelegate when registration fails
    func didFailToRegisterForRemoteNotifications(error: Error) {
        lastError = error.localizedDescription
        isRegistered = false
        logger.error("APNs registration failed: \(error.localizedDescription)")
    }

    // Send device token to JOI gateway
    private func registerTokenWithGateway(token: String) async {
        let gatewayURL = UserDefaults.standard.string(forKey: "gatewayURL")
            ?? "ws://localhost:3100/ws"

        // Convert ws:// URL to http:// for REST API
        let baseURL = gatewayURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")

        guard let url = URL(string: "\(baseURL)/api/push/register") else {
            logger.error("Invalid gateway URL for push registration")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add bearer token if configured
        if let secret = UserDefaults.standard.string(forKey: "gatewaySecret") {
            request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        }

        var body: [String: Any] = [
            "deviceToken": token,
            "platform": platform(),
            "deviceName": deviceName(),
            "appVersion": appVersion(),
        ]
        #if DEBUG
        body["environment"] = "development"
        #else
        body["environment"] = "production"
        #endif

        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                logger.info("Push token registered with gateway")
            } else {
                logger.warning("Gateway push registration returned non-200")
            }
        } catch {
            logger.error("Failed to register push token with gateway: \(error.localizedDescription)")
        }
    }

    private func platform() -> String {
        #if os(iOS)
        return "ios"
        #elseif os(macOS)
        return "macos"
        #elseif os(watchOS)
        return "watchos"
        #else
        return "unknown"
        #endif
    }

    private func deviceName() -> String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #elseif canImport(AppKit)
        return Host.current().localizedName ?? "Mac"
        #else
        return "Unknown"
        #endif
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
}
