import SwiftUI
import SwiftData

@main
struct JOIApp: App {
    #if os(iOS)
    @State private var webSocket = WebSocketClient()
    @State private var router = FrameRouter()
    @State private var voiceEngine = VoiceEngine()
    @State private var pushService = PushService()
    @State private var phoneWatchBridge = PhoneWatchBridge()
    @State private var networkReady = false
    @UIApplicationDelegateAdaptor(JOIAppDelegate.self) private var appDelegate
    #elseif os(macOS)
    @NSApplicationDelegateAdaptor(JOIAppDelegate.self) private var appDelegate
    #endif

    var body: some Scene {
        #if os(iOS)
        WindowGroup {
            RootView()
                .environment(webSocket)
                .environment(router)
                .environment(voiceEngine)
                .environment(pushService)
                .environment(phoneWatchBridge)
                .task {
                    ensureNetworkSetup()
                }
        }
        .modelContainer(for: [Conversation.self, Message.self, AppSetting.self])
        #elseif os(macOS)
        // macOS uses NSPopover managed by AppDelegate — just need a minimal scene
        Settings {
            SettingsView()
                .environment(appDelegate.webSocket)
                .environment(appDelegate.router)
                .environment(appDelegate.voiceEngine)
                .environment(appDelegate.pushService)
                .frame(minWidth: 860, minHeight: 580)
        }
        #endif
    }

    #if os(iOS)
    @MainActor
    private func ensureNetworkSetup() {
        guard !networkReady else { return }
        networkReady = true

        // Wire WebSocket → FrameRouter
        webSocket.onFrame = { [router] frame in
            router.route(frame)
        }
        voiceEngine.attach(webSocket: webSocket, router: router)
        phoneWatchBridge.bind(voiceEngine: voiceEngine)

        // Connect WebSocket
        let gatewayURL = UserDefaults.standard.string(forKey: "gatewayURL")
            ?? "ws://localhost:3100/ws"
        webSocket.connect(to: gatewayURL)

        // Wire push service to AppDelegate and request permission
        appDelegate.pushService = pushService
        Task {
            await pushService.requestPermission()
        }
    }
    #endif
}
