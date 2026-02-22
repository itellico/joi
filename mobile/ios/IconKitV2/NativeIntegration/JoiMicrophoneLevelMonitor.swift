import SwiftUI

#if os(iOS)
import AVFoundation

/// Reads microphone amplitude and publishes a normalized level (0...1).
@MainActor
public final class JoiMicrophoneLevelMonitor: ObservableObject {
    @Published public private(set) var level: CGFloat = 0
    @Published public private(set) var isRunning = false
    @Published public private(set) var hasPermission = false

    private var engine: AVAudioEngine?
    private let minDb: Float = -60

    public init() {}

    public func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    self.hasPermission = granted
                    continuation.resume(returning: granted)
                }
            }
        }
    }

    public func start() {
        Task {
            let granted = await requestPermission()
            guard granted else { return }

            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(
                    .playAndRecord,
                    mode: .measurement,
                    options: [.defaultToSpeaker, .mixWithOthers, .allowBluetooth]
                )
                try session.setActive(true, options: [])

                let engine = AVAudioEngine()
                let input = engine.inputNode
                let format = input.outputFormat(forBus: 0)

                input.removeTap(onBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                    self?.process(buffer)
                }

                engine.prepare()
                try engine.start()

                self.engine = engine
                self.isRunning = true
                self.level = 0
            } catch {
                self.stop()
            }
        }
    }

    public func stop() {
        if let input = engine?.inputNode {
            input.removeTap(onBus: 0)
        }
        engine?.stop()
        engine = nil
        isRunning = false
        level = 0

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // Ignore deactivation errors.
        }
    }

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard let data = buffer.floatChannelData?[0] else { return }
        let count = Int(buffer.frameLength)
        if count == 0 { return }

        var sum: Float = 0
        for i in 0..<count {
            let s = data[i]
            sum += s * s
        }

        let rms = sqrt(sum / Float(count))
        let db = 20 * log10(max(rms, 0.000_000_1))
        let normalized = CGFloat(max(0, min(1, (db - minDb) / -minDb)))
        let boosted = pow(max(0, normalized - 0.01), 0.78)

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let smoothing: CGFloat = boosted > self.level ? 0.52 : 0.20
            self.level = self.level + (boosted - self.level) * smoothing
        }
    }

    deinit {
        Task { @MainActor in
            stop()
        }
    }
}

#else

/// Non-iOS fallback stub.
@MainActor
public final class JoiMicrophoneLevelMonitor: ObservableObject {
    @Published public private(set) var level: CGFloat = 0
    @Published public private(set) var isRunning = false
    @Published public private(set) var hasPermission = false

    public init() {}

    public func requestPermission() async -> Bool { false }
    public func start() {}
    public func stop() {}
}

#endif
