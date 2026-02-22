#if os(iOS)
import Foundation
import WatchConnectivity
import Observation
import OSLog

private final class StatusSnapshotBox: @unchecked Sendable {
    private let lock = NSLock()
    private var snapshot: WatchBridgeStatusSnapshot?

    func set(_ snapshot: WatchBridgeStatusSnapshot?) {
        lock.lock()
        self.snapshot = snapshot
        lock.unlock()
    }

    func get() -> WatchBridgeStatusSnapshot? {
        lock.lock()
        defer { lock.unlock() }
        return snapshot
    }
}

@MainActor
@Observable
final class PhoneWatchBridge: NSObject {
    private let log = Logger(subsystem: "com.joi.app", category: "PhoneWatchBridge")
    private let maxTranscriptLength = 220

    private var session: WCSession?
    private weak var voiceEngine: VoiceEngine?
    private nonisolated let statusSnapshotBox = StatusSnapshotBox()
    private var restoreMuteAfterPressToTalk = false
    private var observationGeneration = 0

    private(set) var activationState: WCSessionActivationState = .notActivated
    private(set) var isPaired = false
    private(set) var isWatchAppInstalled = false
    private(set) var isReachable = false
    private(set) var lastStatus: WatchBridgeStatusSnapshot?

    func bind(voiceEngine: VoiceEngine) {
        self.voiceEngine = voiceEngine
        observationGeneration += 1
        activateSessionIfNeeded()
        publishStatusSnapshot(from: voiceEngine)
        observeVoiceEngineChanges(generation: observationGeneration)
    }

    func publishStatusSnapshot(from voiceEngine: VoiceEngine) {
        let transcript = voiceEngine.capturedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        let clippedTranscript: String? = transcript.isEmpty ? nil : String(transcript.prefix(maxTranscriptLength))

        let snapshot = WatchBridgeStatusSnapshot(
            voiceState: voiceEngine.state,
            statusText: voiceEngine.statusText,
            isActive: voiceEngine.isActive,
            isMuted: voiceEngine.isMuted,
            capturedTranscript: clippedTranscript,
            errorMessage: voiceEngine.errorMessage,
            updatedAt: Date().timeIntervalSince1970
        )

        lastStatus = snapshot
        statusSnapshotBox.set(snapshot)
        guard let session else { return }

        let payload = WatchBridgePayload.status(snapshot)
        do {
            try session.updateApplicationContext(payload)
        } catch {
            log.error("updateApplicationContext failed: \(error.localizedDescription, privacy: .public)")
        }

        guard session.isReachable else { return }
        session.sendMessage(payload, replyHandler: nil) { [log] error in
            log.debug("sendMessage(status) failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func activateSessionIfNeeded() {
        guard WCSession.isSupported() else {
            log.info("WCSession unsupported on this device")
            return
        }

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
        isPaired = session.isPaired
        isWatchAppInstalled = session.isWatchAppInstalled
        isReachable = session.isReachable
    }

    private func refreshState(
        activationState: WCSessionActivationState,
        isPaired: Bool,
        isWatchAppInstalled: Bool,
        isReachable: Bool
    ) {
        self.activationState = activationState
        self.isPaired = isPaired
        self.isWatchAppInstalled = isWatchAppInstalled
        self.isReachable = isReachable
    }

    private func observeVoiceEngineChanges(generation: Int) {
        guard generation == observationGeneration, let voiceEngine else { return }

        withObservationTracking {
            _ = voiceEngine.state
            _ = voiceEngine.statusText
            _ = voiceEngine.isActive
            _ = voiceEngine.isMuted
            _ = voiceEngine.capturedTranscript
            _ = voiceEngine.errorMessage
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard
                    let self,
                    self.observationGeneration == generation,
                    let voiceEngine = self.voiceEngine
                else { return }
                self.publishStatusSnapshot(from: voiceEngine)
                self.observeVoiceEngineChanges(generation: generation)
            }
        }
    }

    private func handle(command: WatchBridgeCommand) {
        guard let voiceEngine else {
            log.warning("Dropped watch command '\(command.rawValue, privacy: .public)' (voiceEngine not bound)")
            return
        }

        log.info("Watch command: \(command.rawValue, privacy: .public)")
        switch command {
        case .requestStatus:
            publishStatusSnapshot(from: voiceEngine)
            return
        case .startVoice:
            Task { @MainActor [weak self] in
                await voiceEngine.start()
                guard let self, let voiceEngine = self.voiceEngine else { return }
                self.publishStatusSnapshot(from: voiceEngine)
            }
        case .stopVoice:
            restoreMuteAfterPressToTalk = false
            voiceEngine.stop()
        case .tapToTalk:
            Task { @MainActor [weak self] in
                await voiceEngine.tapToTalk()
                guard let self, let voiceEngine = self.voiceEngine else { return }
                self.publishStatusSnapshot(from: voiceEngine)
            }
        case .pressToTalkStart:
            handlePressToTalkStart(voiceEngine)
        case .pressToTalkEnd:
            handlePressToTalkEnd(voiceEngine)
        case .interrupt:
            voiceEngine.interruptSpeaking()
        case .mute:
            restoreMuteAfterPressToTalk = false
            voiceEngine.mute()
        case .unmute:
            restoreMuteAfterPressToTalk = false
            voiceEngine.unmute()
        }

        publishStatusSnapshot(from: voiceEngine)
    }

    private func handlePressToTalkStart(_ voiceEngine: VoiceEngine) {
        restoreMuteAfterPressToTalk = voiceEngine.isMuted
        if voiceEngine.isMuted {
            voiceEngine.unmute()
        }

        Task { @MainActor [weak self] in
            await voiceEngine.tapToTalk()
            guard let self, let voiceEngine = self.voiceEngine else { return }
            self.publishStatusSnapshot(from: voiceEngine)
        }
    }

    private func handlePressToTalkEnd(_ voiceEngine: VoiceEngine) {
        if restoreMuteAfterPressToTalk {
            voiceEngine.mute()
        }
        restoreMuteAfterPressToTalk = false
    }
}

extension PhoneWatchBridge: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let isPaired = session.isPaired
        let isWatchAppInstalled = session.isWatchAppInstalled
        let isReachable = session.isReachable
        let errorDescription = error?.localizedDescription
        Task { @MainActor [weak self, activationState, isPaired, isWatchAppInstalled, isReachable, errorDescription] in
            guard let self else { return }
            self.refreshState(
                activationState: activationState,
                isPaired: isPaired,
                isWatchAppInstalled: isWatchAppInstalled,
                isReachable: isReachable
            )
            if let errorDescription {
                self.log.error("WC activate failed: \(errorDescription, privacy: .public)")
            } else {
                self.log.info("WC activated")
                if let voiceEngine = self.voiceEngine {
                    self.publishStatusSnapshot(from: voiceEngine)
                }
            }
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
        let activationState = session.activationState
        let isPaired = session.isPaired
        let isWatchAppInstalled = session.isWatchAppInstalled
        let isReachable = session.isReachable
        Task { @MainActor [weak self, activationState, isPaired, isWatchAppInstalled, isReachable] in
            self?.refreshState(
                activationState: activationState,
                isPaired: isPaired,
                isWatchAppInstalled: isWatchAppInstalled,
                isReachable: isReachable
            )
        }
    }

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        let activationState = session.activationState
        let isPaired = session.isPaired
        let isWatchAppInstalled = session.isWatchAppInstalled
        let isReachable = session.isReachable
        session.activate()
        Task { @MainActor [weak self, activationState, isPaired, isWatchAppInstalled, isReachable] in
            self?.refreshState(
                activationState: activationState,
                isPaired: isPaired,
                isWatchAppInstalled: isWatchAppInstalled,
                isReachable: isReachable
            )
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let activationState = session.activationState
        let isPaired = session.isPaired
        let isWatchAppInstalled = session.isWatchAppInstalled
        let isReachable = session.isReachable
        Task { @MainActor [weak self, activationState, isPaired, isWatchAppInstalled, isReachable] in
            self?.refreshState(
                activationState: activationState,
                isPaired: isPaired,
                isWatchAppInstalled: isWatchAppInstalled,
                isReachable: isReachable
            )
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let command = WatchBridgePayload.parseCommand(from: message)
        Task { @MainActor [weak self, command] in
            guard let self, let command else { return }
            self.handle(command: command)
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let command = WatchBridgePayload.parseCommand(from: message)
        let replyPayload = statusSnapshotBox.get().map(WatchBridgePayload.status) ?? [:]
        replyHandler(replyPayload)
        Task { @MainActor [weak self, command] in
            guard let self, let command else { return }
            self.handle(command: command)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let command = WatchBridgePayload.parseCommand(from: userInfo)
        Task { @MainActor [weak self, command] in
            guard let self, let command else { return }
            self.handle(command: command)
        }
    }
}
#endif
