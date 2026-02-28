import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class WebSocketClient {
    enum ConnectionState: Sendable {
        case disconnected
        case connecting
        case connected
        case reconnecting
    }

    private(set) var state: ConnectionState = .disconnected
    private(set) var lastError: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var url: URL?
    private var pingTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var intentionalDisconnect = false

    private let logger = Logger(subsystem: "com.joi.app", category: "WebSocket")

    var onFrame: (@MainActor (Frame) -> Void)?

    var isConnected: Bool { state == .connected }

    func connect(to urlString: String) {
        let resolvedURLString = GatewayURLResolver.normalizedManualGatewayURL(urlString) ?? urlString
        guard let url = URL(string: resolvedURLString) else {
            lastError = "Invalid URL: \(resolvedURLString)"
            logger.error("Invalid URL: \(resolvedURLString)")
            return
        }

        if let currentURL = self.url,
           currentURL == url,
           state == .connected || state == .connecting || state == .reconnecting {
            logger.info("Connect ignored: already targeting \(url.absoluteString, privacy: .public) in state \(String(describing: self.state), privacy: .public)")
            return
        }

        // Tear down any in-progress connection/reconnection to a different route.
        if state != .disconnected {
            tearDown()
        }

        if resolvedURLString != urlString {
            logger.info("Normalized gateway URL \(urlString, privacy: .public) -> \(resolvedURLString, privacy: .public)")
            GatewayURLResolver.persistGatewayURL(resolvedURLString)
        }
        self.url = url
        intentionalDisconnect = false
        reconnectAttempt = 0
        doConnect()
    }

    func disconnect() {
        intentionalDisconnect = true
        tearDown()
        state = .disconnected
    }

    func send(type: FrameType, data: (any Encodable & Sendable)? = nil, id: String? = nil) {
        guard let text = makeFrame(type: type, data: data, id: id) else {
            logger.error("Failed to encode frame: \(type.rawValue)")
            return
        }
        logger.info("TX: \(type.rawValue) (\(text.count) bytes)")
        send(raw: text)
    }

    func send(raw text: String) {
        guard state == .connected, let ws = webSocketTask else {
            logger.warning("Send dropped (state=\(String(describing: self.state)), ws=\(self.webSocketTask != nil))")
            return
        }
        let message = URLSessionWebSocketTask.Message.string(text)
        Task {
            do {
                try await ws.send(message)
            } catch {
                logger.error("Send failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Private

    private func doConnect() {
        tearDown()

        guard let url else { return }
        state = reconnectAttempt > 0 ? .reconnecting : .connecting
        lastError = nil
        logger.info("Connecting to \(url.absoluteString) (attempt \(self.reconnectAttempt))")

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)
        let ws = session!.webSocketTask(with: url)
        webSocketTask = ws
        ws.resume()

        // Start receive loop — receive() waits for handshake internally
        startReceiving()

        // Verify connection is established via ping (with 5s timeout)
        Task { [weak self] in
            do {
                try await withThrowingTaskGroup(of: Void.self) { group in
                    group.addTask {
                        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                            ws.sendPing { error in
                                if let error {
                                    cont.resume(throwing: error)
                                } else {
                                    cont.resume()
                                }
                            }
                        }
                    }
                    group.addTask {
                        try await Task.sleep(nanoseconds: 5_000_000_000)
                        throw NSError(domain: "WebSocket", code: 408,
                                      userInfo: [NSLocalizedDescriptionKey: "Connection timeout (5s)"])
                    }
                    // First to finish wins; cancel the other
                    try await group.next()
                    group.cancelAll()
                }
                guard let self, !Task.isCancelled else { return }
                self.state = .connected
                self.reconnectAttempt = 0
                self.logger.info("Connected to \(url.absoluteString)")
                self.startPingLoop()
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.logger.error("Connection failed: \(error.localizedDescription)")
                self.handleDisconnect(error: error)
            }
        }
    }

    private func tearDown() {
        pingTask?.cancel()
        pingTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        session?.invalidateAndCancel()
        session = nil
    }

    private func startReceiving() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let ws = self.webSocketTask else { break }
                do {
                    let message = try await ws.receive()
                    switch message {
                    case .string(let text):
                        self.handleMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleMessage(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    if !Task.isCancelled {
                        self.handleDisconnect(error: error)
                    }
                    break
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let frame = parseFrame(raw: text) else {
            logger.warning("Failed to parse frame: \(text.prefix(200))")
            return
        }

        if frame.type == .systemPong {
            return
        }

        logger.info("RX: \(frame.type.rawValue)")
        onFrame?(frame)
    }

    private func handleDisconnect(error: Error) {
        logger.warning("Disconnected: \(error.localizedDescription)")
        lastError = error.localizedDescription
        state = .disconnected

        guard !intentionalDisconnect else { return }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        reconnectAttempt += 1
        let delay = reconnectDelay()
        logger.info("Reconnecting in \(delay)s (attempt \(self.reconnectAttempt))")
        state = .reconnecting

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard let self else { return }
#if os(iOS) && !targetEnvironment(simulator)
            let refreshedGatewayURL = await GatewayURLResolver.resolveStartupGatewayURL(forceRefresh: true)
            if let refreshedURL = URL(string: refreshedGatewayURL),
               refreshedURL != self.url {
                self.logger.info("Switching reconnect route to \(refreshedGatewayURL, privacy: .public)")
                self.url = refreshedURL
                GatewayURLResolver.persistGatewayURL(refreshedGatewayURL)
            }
#endif
            self.doConnect()
        }
    }

    private func reconnectDelay() -> Double {
        let base = 0.5 * pow(2.0, Double(min(reconnectAttempt - 1, 6)))
        return min(base, 30.0)
    }

    private func startPingLoop() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30s
                guard !Task.isCancelled, let self else { break }
                guard let ws = self.webSocketTask else { break }

                // Send ping and wait for pong with 5s timeout
                let pongReceived: Bool = await withCheckedContinuation { cont in
                    ws.sendPing { error in
                        cont.resume(returning: error == nil)
                    }
                }

                if !pongReceived, !Task.isCancelled {
                    self.logger.warning("Pong timeout")
                    self.handleDisconnect(
                        error: NSError(domain: "WebSocket", code: 408,
                                       userInfo: [NSLocalizedDescriptionKey: "Pong timeout"]))
                    break
                }
            }
        }
    }
}
