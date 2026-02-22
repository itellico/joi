import Foundation
import UserNotifications
#if canImport(UIKit)
import UIKit

final class JOIAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var pushService: PushService?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // APNs token received
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            pushService?.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    // APNs registration failed
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            pushService?.didFailToRegisterForRemoteNotifications(error: error)
        }
    }

    // Handle notification when app is in foreground — show it as a banner
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    // Handle notification tap — navigate to relevant content
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo

        // Extract JOI event data for navigation
        let joiEvent = userInfo["joiEvent"] as? String
        let joiDataStr = (userInfo["joiData"] as? String) ?? ""
        if let joiEvent {
            let event = joiEvent
            let data = joiDataStr
            await MainActor.run {
                NotificationCenter.default.post(
                    name: .joiPushTapped, object: nil,
                    userInfo: ["event": event, "data": data])
            }
        }
    }
}

#elseif canImport(AppKit)
import AppKit
import SwiftUI
import SwiftData

@MainActor
final class JOIAppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSMenuDelegate {
    let pushService = PushService()

    // State objects — owned here so popover content can use them
    let webSocket = WebSocketClient()
    let router = FrameRouter()
    let voiceEngine = VoiceEngine()

    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu?
    private var toggleVoiceMenuItem: NSMenuItem?
    private var popover: NSPopover?
    private var settingsWindow: NSWindow?
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var modelContainer: ModelContainer?
    private var statusIconTimer: Timer?
    private var statusIconPhase: CGFloat = 0
    private lazy var statusFirestormImage: NSImage? = {
        if let image = NSImage(named: "JoiFirestormTransparent") {
            return image
        }
        guard let url = Bundle.main.url(forResource: "joi_firestorm_transparent", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        setupModelContainer()
        setupStatusItem()
        setupPopover()
        registerGlobalShortcut()
        setupNetwork()
    }

    // MARK: - Setup

    private func setupModelContainer() {
        modelContainer = try? ModelContainer(for: Conversation.self, Message.self, AppSetting.self)
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: 28)
        if let button = statusItem?.button {
            button.imagePosition = .imageOnly
            button.imageScaling = .scaleProportionallyUpOrDown
            button.isBordered = false
            button.toolTip = "JOI"
        }
        statusItem?.menu = makeStatusMenu()
        updateStatusItemIcon()
        startStatusIconUpdates()
    }

    private func makeStatusMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = self

        let toggleItem = NSMenuItem(title: "JOI On", action: #selector(toggleVoiceFromMenu), keyEquivalent: "")
        toggleItem.target = self
        toggleItem.image = NSImage(systemSymbolName: "power.circle", accessibilityDescription: nil)
        menu.addItem(toggleItem)
        toggleVoiceMenuItem = toggleItem

        let talkItem = NSMenuItem(title: "Talk with JOI...", action: #selector(openTalkFromMenu), keyEquivalent: "")
        talkItem.target = self
        talkItem.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: nil)
        menu.addItem(talkItem)

        let historyItem = NSMenuItem(title: "History...", action: #selector(openHistoryFromMenu), keyEquivalent: "")
        historyItem.target = self
        historyItem.image = NSImage(systemSymbolName: "clock", accessibilityDescription: nil)
        menu.addItem(historyItem)

        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        settingsItem.target = self
        settingsItem.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: nil)
        settingsItem.keyEquivalentModifierMask = [.command]
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let updatesItem = NSMenuItem(title: "Check for Updates...", action: #selector(checkForUpdatesFromMenu), keyEquivalent: "")
        updatesItem.target = self
        menu.addItem(updatesItem)

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quitFromMenu), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusMenu = menu
        return menu
    }

    private func setupPopover() {
        let popover = NSPopover()
        popover.contentSize = popoverSizeForCurrentStyle()
        popover.behavior = .transient
        popover.animates = true

        let rootView = MenuBarContentView()
            .environment(webSocket)
            .environment(router)
            .environment(voiceEngine)
            .environment(pushService)

        if let modelContainer {
            let view = rootView.modelContainer(modelContainer)
            let vc = NSHostingController(rootView: view)
            popover.contentViewController = vc
        } else {
            let vc = NSHostingController(rootView: rootView)
            popover.contentViewController = vc
        }

        self.popover = popover
    }

    private func setupNetwork() {
        webSocket.onFrame = { [router] frame in
            router.route(frame)
        }
        voiceEngine.attach(webSocket: webSocket, router: router)

        let gatewayURL = UserDefaults.standard.string(forKey: "gatewayURL")
            ?? "ws://localhost:3100/ws"
        webSocket.connect(to: gatewayURL)

        Task {
            await pushService.requestPermission()
        }
    }

    // MARK: - Popover Toggle

    func togglePopover() {
        guard let popover, let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            showPopover(relativeTo: button, popover: popover)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        guard menu == statusMenu else { return }
        toggleVoiceMenuItem?.title = voiceEngine.isActive ? "JOI Off" : "JOI On"
        toggleVoiceMenuItem?.state = voiceEngine.isActive ? .on : .off
        toggleVoiceMenuItem?.image = NSImage(
            systemSymbolName: voiceEngine.isActive ? "power.circle.fill" : "power.circle",
            accessibilityDescription: nil
        )
        updateStatusItemIcon()
    }

    private func startStatusIconUpdates() {
        statusIconTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in
            self?.tickStatusIcon()
        }
        statusIconTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func tickStatusIcon() {
        statusIconPhase += 0.16
        if statusIconPhase > (.pi * 4) {
            statusIconPhase = 0
        }
        updateStatusItemIcon()
    }

    private func updateStatusItemIcon() {
        guard let button = statusItem?.button else { return }
        button.image = menuBarIconImage(phase: statusIconPhase)
    }

    private func menuBarIconImage(phase: CGFloat) -> NSImage {
        guard let baseIcon = statusFirestormImage else {
            return fallbackTemplateMenuBarIcon(phase: phase)
        }

        let side: CGFloat = 22
        let center = side * 0.5
        let image = NSImage(size: NSSize(width: side, height: side))
        image.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high

        let isActive = voiceEngine.isActive && !voiceEngine.isMuted
        let isSpeaking = voiceEngine.isSpeaking
        let micLevel = CGFloat(max(0.0, min(1.0, voiceEngine.micLevel)))
        let pulseStrength = isActive ? (0.18 + micLevel * 0.54 + (isSpeaking ? 0.14 : 0.0)) : 0.0
        let wave = (sin(phase * 2.4) + 1.0) * 0.5

        let scale = isActive
            ? (1.01 + pulseStrength * 0.09 + wave * 0.03)
            : 0.98
        let drawSide = side * scale
        let drawRect = NSRect(
            x: center - drawSide * 0.5,
            y: center - drawSide * 0.5,
            width: drawSide,
            height: drawSide
        )
        let clipPath = NSBezierPath(ovalIn: drawRect)
        clipPath.addClip()
        baseIcon.draw(
            in: drawRect,
            from: .zero,
            operation: .sourceOver,
            fraction: voiceEngine.isMuted ? 0.42 : (isActive ? 0.88 : 0.82),
            respectFlipped: true,
            hints: nil
        )
        let darkenOverlay = voiceEngine.isMuted
            ? 0.24
            : (isActive ? max(0.04, 0.09 - micLevel * 0.03) : 0.12)
        NSColor.black.withAlphaComponent(darkenOverlay).setFill()
        NSBezierPath(rect: drawRect).fill()

        if voiceEngine.isMuted {
            let slash = NSBezierPath()
            slash.move(to: NSPoint(x: center - 4.1, y: center + 4.1))
            slash.line(to: NSPoint(x: center + 4.1, y: center - 4.1))
            slash.lineWidth = 1.5
            NSColor.white.withAlphaComponent(0.92).setStroke()
            slash.stroke()
        }

        image.unlockFocus()
        image.isTemplate = false
        image.size = NSSize(width: side, height: side)
        return image
    }

    private func fallbackTemplateMenuBarIcon(phase: CGFloat) -> NSImage {
        let side: CGFloat = 18
        let center = side * 0.5
        let image = NSImage(size: NSSize(width: side, height: side))
        image.lockFocus()

        let isActive = voiceEngine.isActive && !voiceEngine.isMuted
        let isSpeaking = voiceEngine.isSpeaking
        let micLevel = CGFloat(max(0.0, min(1.0, voiceEngine.micLevel)))
        let pulseStrength = isActive ? (0.22 + micLevel * 0.72 + (isSpeaking ? 0.18 : 0.0)) : 0.0

        if pulseStrength > 0 {
            for ring in 0..<2 {
                let wave = (sin(phase * 2.0 + CGFloat(ring) * 1.35) + 1.0) * 0.5
                let radius = 5.4 + CGFloat(ring) * 1.9 + wave * (0.9 + pulseStrength * 1.4)
                let alpha = max(0.10, min(0.82, 0.26 + wave * 0.18 + pulseStrength * 0.28 - CGFloat(ring) * 0.08))

                let ringPath = NSBezierPath(
                    ovalIn: NSRect(
                        x: center - radius,
                        y: center - radius,
                        width: radius * 2,
                        height: radius * 2
                    )
                )
                ringPath.lineWidth = max(0.8, 1.2 - CGFloat(ring) * 0.2)
                NSColor.black.withAlphaComponent(alpha).setStroke()
                ringPath.stroke()
            }
        }

        let coreRadius: CGFloat = 4.2
        let corePath = NSBezierPath(
            ovalIn: NSRect(
                x: center - coreRadius,
                y: center - coreRadius,
                width: coreRadius * 2,
                height: coreRadius * 2
            )
        )
        corePath.lineWidth = 1.25
        NSColor.black.withAlphaComponent(isActive ? 0.95 : 0.82).setStroke()
        corePath.stroke()

        let triRadius: CGFloat = 2.45
        let top = NSPoint(x: center, y: center + triRadius * 1.02)
        let left = NSPoint(x: center - triRadius, y: center - triRadius * 0.85)
        let right = NSPoint(x: center + triRadius, y: center - triRadius * 0.85)
        let innerLeft = NSPoint(x: center - triRadius * 0.58, y: center - triRadius * 0.28)
        let innerRight = NSPoint(x: center + triRadius * 0.58, y: center - triRadius * 0.28)

        let triangle = NSBezierPath()
        triangle.move(to: top)
        triangle.line(to: right)
        triangle.line(to: innerRight)
        triangle.line(to: innerLeft)
        triangle.line(to: left)
        triangle.close()
        triangle.lineWidth = 1.35
        NSColor.black.withAlphaComponent(isActive ? 0.96 : 0.84).setStroke()
        triangle.stroke()

        if voiceEngine.isMuted {
            let slash = NSBezierPath()
            slash.move(to: NSPoint(x: center - 3.4, y: center + 3.2))
            slash.line(to: NSPoint(x: center + 3.4, y: center - 3.2))
            slash.lineWidth = 1.3
            NSColor.black.withAlphaComponent(0.9).setStroke()
            slash.stroke()
        }

        image.unlockFocus()
        image.isTemplate = true
        image.size = NSSize(width: side, height: side)
        return image
    }

    // MARK: - Global Shortcut

    private func registerGlobalShortcut() {
        // Global monitor (when app is not focused)
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return }
            if self.matchesToggleShortcut(event) {
                DispatchQueue.main.async {
                    self.togglePopover()
                }
            }
        }
        // Local monitor (when app is focused)
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if self.matchesToggleShortcut(event) {
                self.togglePopover()
                return nil // consume the event
            }
            return event
        }
    }

    @objc private func toggleVoiceFromMenu() {
        if voiceEngine.isActive {
            voiceEngine.stop()
        } else {
            Task { @MainActor in
                await voiceEngine.start()
            }
        }
        updateStatusItemIcon()
    }

    @objc private func openHistoryFromMenu() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.showPopover()
            NotificationCenter.default.post(name: .joiOpenHistory, object: nil)
        }
    }

    @objc private func openTalkFromMenu() {
        if !voiceEngine.isActive {
            Task { @MainActor in
                await voiceEngine.start()
            }
        } else if voiceEngine.isMuted {
            voiceEngine.unmute()
        }
        updateStatusItemIcon()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.showPopover()
            NotificationCenter.default.post(name: .joiOpenChat, object: nil)
        }
    }

    @objc private func openSettingsFromMenu() {
        showSettingsWindow()
    }

    @objc private func checkForUpdatesFromMenu() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "JOI is up to date."
        alert.informativeText = "Automatic update channels are not configured yet."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc private func quitFromMenu() {
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusIconTimer?.invalidate()
        statusIconTimer = nil
    }

    private func showPopover() {
        guard let popover, let button = statusItem?.button else { return }
        showPopover(relativeTo: button, popover: popover)
    }

    private func showPopover(relativeTo button: NSStatusBarButton, popover: NSPopover) {
        popover.contentSize = popoverSizeForCurrentStyle()
        NSApp.activate(ignoringOtherApps: true)
        if !popover.isShown {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
        popover.contentViewController?.view.window?.makeKey()
    }

    private func showSettingsWindow() {
        NSApp.activate(ignoringOtherApps: true)

        if let settingsWindow {
            settingsWindow.makeKeyAndOrderFront(nil)
            return
        }

        let rootView = SettingsView()
            .environment(webSocket)
            .environment(router)
            .environment(voiceEngine)
            .environment(pushService)
        let hostedView: AnyView
        if let modelContainer {
            hostedView = AnyView(rootView.modelContainer(modelContainer))
        } else {
            hostedView = AnyView(rootView)
        }

        let controller = NSHostingController(rootView: hostedView)
        let window = NSWindow(contentViewController: controller)
        window.title = "Settings"
        window.setContentSize(NSSize(width: 900, height: 620))
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.center()
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        settingsWindow = window
        window.makeKeyAndOrderFront(nil)
    }

    private func popoverSizeForCurrentStyle() -> NSSize {
        let style = UserDefaults.standard.string(forKey: "recordingWindowStyle") ?? "classic"
        switch style {
        case "mini":
            return NSSize(width: 460, height: 560)
        case "none":
            return NSSize(width: 420, height: 320)
        default:
            return NSSize(width: 520, height: 640)
        }
    }

    private func matchesToggleShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let shortcut = UserDefaults.standard.string(forKey: "globalToggleShortcut") ?? "Command+UpArrow"
        switch shortcut {
        case "Option+Space":
            return event.keyCode == 49 &&
                flags.contains(.option) &&
                !flags.contains(.command) &&
                !flags.contains(.control) &&
                !flags.contains(.shift)
        case "Command+Space":
            return event.keyCode == 49 &&
                flags.contains(.command) &&
                !flags.contains(.option) &&
                !flags.contains(.control) &&
                !flags.contains(.shift)
        default:
            return event.keyCode == 126 &&
                flags.contains(.command) &&
                !flags.contains(.option) &&
                !flags.contains(.control) &&
                !flags.contains(.shift)
        }
    }

    // MARK: - Push Notifications

    nonisolated func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            pushService.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    nonisolated func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            pushService.didFailToRegisterForRemoteNotifications(error: error)
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo

        let joiEvent = userInfo["joiEvent"] as? String
        let joiDataStr = (userInfo["joiData"] as? String) ?? ""
        if let joiEvent {
            let event = joiEvent
            let data = joiDataStr
            await MainActor.run {
                NotificationCenter.default.post(
                    name: .joiPushTapped, object: nil,
                    userInfo: ["event": event, "data": data])
            }
        }
    }
}

#endif

extension Notification.Name {
    static let joiPushTapped = Notification.Name("joiPushTapped")
    static let joiOpenHistory = Notification.Name("joiOpenHistory")
    static let joiOpenChat = Notification.Name("joiOpenChat")
}
