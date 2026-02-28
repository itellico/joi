import Foundation
import UserNotifications
import OSLog
import Security
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@MainActor
@Observable
final class PushService: NSObject, Sendable {
    private enum PushRegistrationRuntime {
        case supported
        case unsupported(String)
    }

    private(set) var isRegistered = false
    private(set) var deviceToken: String?
    private(set) var permissionGranted = false
    private(set) var lastError: String?
    private(set) var pushCapabilityAvailable = true

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
        switch pushRuntimeAvailability() {
        case .unsupported(let reason):
            pushCapabilityAvailable = false
            isRegistered = false
            lastError = reason
            logger.warning("Skipping APNs registration: \(reason, privacy: .public)")
            return
        case .supported:
            break
        }

        guard hasAPNsEntitlement() else {
            pushCapabilityAvailable = false
            isRegistered = false
            lastError = "Push Notifications entitlement is missing for this signing profile."
            logger.warning("Skipping APNs registration: aps-environment entitlement is missing for this signing profile")
            return
        }

        pushCapabilityAvailable = true
        lastError = nil
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
        lastError = normalizeAPNsRegistrationError(error)
        isRegistered = false
        logger.error("APNs registration failed: \(self.lastError ?? error.localizedDescription)")
    }

    // Send device token to JOI gateway
    private func registerTokenWithGateway(token: String) async {
        let gatewayURL = GatewayURLResolver.configuredGatewayURL()

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

    private func normalizeAPNsRegistrationError(_ error: Error) -> String {
        #if targetEnvironment(simulator)
        return "APNs registration is unavailable on iOS Simulator. Use a physical iPhone for real push."
        #else
        let nsError = error as NSError

        #if canImport(UIKit)
        if #available(iOS 14.0, *), ProcessInfo.processInfo.isiOSAppOnMac {
            return "APNs registration is unavailable when running the iOS app on macOS. Use a physical iPhone for real push."
        }
        #endif

        if nsError.domain == NSOSStatusErrorDomain, nsError.code == 13 {
            return "APNs registration failed (OSStatus 13). Verify the app is signed with Push Notifications entitlement."
        }
        return error.localizedDescription
        #endif
    }

    private func pushRuntimeAvailability() -> PushRegistrationRuntime {
        #if targetEnvironment(simulator)
        return .unsupported("APNs registration is unavailable on iOS Simulator. Use a physical iPhone for real push.")
        #elseif canImport(UIKit)
        if #available(iOS 14.0, *), ProcessInfo.processInfo.isiOSAppOnMac {
            return .unsupported("APNs registration is unavailable when running the iOS app on macOS. Use a physical iPhone for real push.")
        }
        return .supported
        #else
        return .supported
        #endif
    }

    private func hasAPNsEntitlement() -> Bool {
        #if os(macOS) && !targetEnvironment(macCatalyst)
        if let task = SecTaskCreateFromSelf(nil) {
            let entitlementKeys = [
                "com.apple.developer.aps-environment",
                "aps-environment",
            ]
            for key in entitlementKeys {
                if let value = SecTaskCopyValueForEntitlement(task, key as CFString, nil) {
                    if let env = value as? String {
                        return !env.isEmpty
                    }
                    if let env = value as? NSString {
                        return env.length > 0
                    }
                    return true
                }
            }
            return false
        }
        #endif

        guard let profilePath = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") else {
            return false
        }
        guard let profile = try? String(contentsOfFile: profilePath, encoding: .ascii) else {
            return false
        }
        return profile.contains("<key>aps-environment</key>")
    }
}
