import Foundation
import WatchConnectivity
import Observation
import OSLog

@MainActor
@Observable
final class WatchSessionClient: NSObject {
    private let log = Logger(subsystem: "com.joi.app.watch", category: "WatchSessionClient")
    private var session: WCSession?

    private(set) var isSupported = WCSession.isSupported()
    private(set) var activationState: WCSessionActivationState = .notActivated
    private(set) var isReachable = false
    private(set) var lastStatus: WatchBridgeStatusSnapshot?
    private(set) var lastError: String?

    var statusText: String {
        lastStatus?.statusText ?? "Open JOI on iPhone"
    }

    var isActive: Bool {
        lastStatus?.isActive ?? false
    }

    var isMuted: Bool {
        lastStatus?.isMuted ?? false
    }

    var capturedTranscript: String {
        lastStatus?.capturedTranscript ?? ""
    }

    override init() {
        super.init()
        activateIfNeeded()
    }

    func requestStatus() {
        send(command: .requestStatus)
    }

    func send(command: WatchBridgeCommand) {
        guard isSupported else {
            lastError = "WatchConnectivity is unavailable on this watch."
            return
        }
        guard let session else {
            lastError = "No WatchConnectivity session."
            return
        }

        let payload = WatchBridgePayload.command(command)
        let canQueueWhenUnreachable = command == .requestStatus
        if session.isReachable {
            session.sendMessage(payload, replyHandler: { [weak self] reply in
                let snapshot = WatchBridgePayload.parseStatus(from: reply)
                Task { @MainActor [weak self, snapshot] in
                    self?.applyStatusSnapshot(snapshot)
                }
            }, errorHandler: { [weak self] error in
                let errorDescription = error.localizedDescription
                Task { @MainActor [weak self, errorDescription] in
                    guard let self else { return }
                    self.lastError = errorDescription
                    if canQueueWhenUnreachable {
                        session.transferUserInfo(payload)
                        self.log.debug("sendMessage failed, queued status request via transferUserInfo: \(errorDescription, privacy: .public)")
                    } else {
                        self.log.debug("sendMessage failed for realtime command: \(errorDescription, privacy: .public)")
                    }
                }
            })
            return
        }

        guard canQueueWhenUnreachable else {
            lastError = "iPhone not reachable. Open JOI on iPhone and try again."
            return
        }
        session.transferUserInfo(payload)
    }

    private func activateIfNeeded() {
        guard isSupported else { return }
        if let session {
            refreshState(from: session)
            return
        }

        let defaultSession = WCSession.default
        self.session = defaultSession
        defaultSession.delegate = self
        defaultSession.activate()
        refreshState(from: defaultSession)
    }

    private func refreshState(from session: WCSession) {
        activationState = session.activationState
        isReachable = session.isReachable
    }

    private func refreshState(
        activationState: WCSessionActivationState,
        isReachable: Bool
    ) {
        self.activationState = activationState
        self.isReachable = isReachable
    }

    private func applyStatusPayload(_ payload: [String: Any]) {
        applyStatusSnapshot(WatchBridgePayload.parseStatus(from: payload))
    }

    private func applyStatusSnapshot(_ snapshot: WatchBridgeStatusSnapshot?) {
        guard let snapshot else { return }
        lastStatus = snapshot
        lastError = snapshot.errorMessage
    }
}

extension WatchSessionClient: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let isReachable = session.isReachable
        let errorDescription = error?.localizedDescription
        Task { @MainActor [weak self, activationState, isReachable, errorDescription] in
            guard let self else { return }
            self.refreshState(activationState: activationState, isReachable: isReachable)
            if let errorDescription {
                self.lastError = errorDescription
                self.log.error("WC activate failed: \(errorDescription, privacy: .public)")
            } else {
                self.requestStatus()
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        let activationState = session.activationState
        Task { @MainActor [weak self, activationState, isReachable] in
            guard let self else { return }
            self.refreshState(activationState: activationState, isReachable: isReachable)
            if isReachable {
                self.requestStatus()
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let snapshot = WatchBridgePayload.parseStatus(from: message)
        Task { @MainActor [weak self, snapshot] in
            self?.applyStatusSnapshot(snapshot)
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let snapshot = WatchBridgePayload.parseStatus(from: message)
        replyHandler([:])
        Task { @MainActor [weak self, snapshot] in
            self?.applyStatusSnapshot(snapshot)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let snapshot = WatchBridgePayload.parseStatus(from: applicationContext)
        Task { @MainActor [weak self, snapshot] in
            self?.applyStatusSnapshot(snapshot)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let snapshot = WatchBridgePayload.parseStatus(from: userInfo)
        Task { @MainActor [weak self, snapshot] in
            self?.applyStatusSnapshot(snapshot)
        }
    }
}
