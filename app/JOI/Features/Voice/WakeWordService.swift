import AVFoundation
import Foundation
import Observation
import os
import Speech

private func makeAudioTapEnqueueCallback(queue: WakeWordBufferQueue) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
    { buffer, _ in
        queue.enqueueCopy(of: buffer)
    }
}

private final class WakeWordBufferQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var buffers: [AVAudioPCMBuffer] = []

    func enqueueCopy(of buffer: AVAudioPCMBuffer) {
        guard let copy = Self.deepCopy(buffer) else { return }
        lock.lock()
        buffers.append(copy)
        lock.unlock()
    }

    func drain() -> [AVAudioPCMBuffer] {
        lock.lock()
        let drained = buffers
        buffers.removeAll(keepingCapacity: true)
        lock.unlock()
        return drained
    }

    func clear() {
        lock.lock()
        buffers.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    private static func deepCopy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let fmt = buffer.format
        let len = buffer.frameLength
        guard let copy = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: len) else { return nil }
        copy.frameLength = len
        if let src = buffer.floatChannelData, let dst = copy.floatChannelData {
            for ch in 0..<Int(fmt.channelCount) {
                dst[ch].update(from: src[ch], count: Int(len))
            }
        }
        return copy
    }
}

@MainActor
@Observable
final class WakeWordService: NSObject {
    var isEnabled = false
    var isListening = false
    var statusText = "Off"
    var micLevel: Double = 0

    let triggerWords = [
        "hey joi", "hey joy", "hey joey", "hey joe",
        "hey choi", "hey choy", "hey choe",
        "hey yoy", "hey yoi",
        "hey toy", "hey coy",
        "a joi", "a joy", "a joey", "a joe",
        "a choi", "a choy", "a yoy", "a yoi",
    ]

    private let audioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var tapQueue: WakeWordBufferQueue?
    private var tapDrainTask: Task<Void, Never>?
    private let log = Logger(subsystem: "com.joi.app", category: "WakeWordService")

    private var lastDispatched: String?
    private var textOnlyDispatched = false
    var onCommand: (@MainActor @Sendable (String) async -> Void)?
    var onError: (@MainActor @Sendable (String) -> Void)?
    private var suppressedByCapture = false

    func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        if enabled {
            Task { await start() }
        } else {
            stop()
        }
    }

    func setSuppressed(_ suppressed: Bool) {
        suppressedByCapture = suppressed
        if suppressed {
            _ = suspend()
            if isEnabled { statusText = "Paused" }
        } else if isEnabled {
            Task { await start() }
        }
    }

    func start() async {
        guard isEnabled, !isListening, !suppressedByCapture else {
            log.info("WakeWordService.start() guard failed — isEnabled=\(self.isEnabled), isListening=\(self.isListening), suppressed=\(self.suppressedByCapture)")
            return
        }

        // Check permissions
        let micOk = await requestMicrophonePermission()
        guard micOk else {
            let msg = "Microphone permission denied"
            log.error("\(msg)")
            statusText = msg
            onError?(msg)
            return
        }

        let speechOk = await requestSpeechPermission()
        guard speechOk else {
            let msg = "Speech recognition permission denied. Enable in System Settings > Privacy > Speech Recognition."
            log.error("\(msg)")
            statusText = msg
            onError?(msg)
            return
        }

        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        guard let sr = speechRecognizer, sr.isAvailable else {
            let msg = "Speech recognizer unavailable (en-US)"
            log.error("\(msg, privacy: .public)")
            statusText = msg
            onError?(msg)
            return
        }
        log.info("Speech recognizer: \(sr.locale.identifier, privacy: .public), onDevice=\(sr.supportsOnDeviceRecognition)")

        do {
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [
                .duckOthers, .mixWithOthers, .allowBluetoothHFP, .defaultToSpeaker,
            ])
            try session.setActive(true)
            #endif

            // Reset dispatch tracking for fresh recognition session
            lastDispatched = nil
            textOnlyDispatched = false

            try startRecognition()
            isListening = true
            statusText = "Listening for wake word"
            log.info("WakeWordService started")
        } catch {
            let msg = "Start failed: \(error.localizedDescription)"
            log.error("\(msg)")
            statusText = msg
            onError?(msg)
        }
    }

    func stop() {
        isEnabled = false
        isListening = false
        statusText = "Off"
        micLevel = 0
        tearDown()
    }

    func suspend() -> Bool {
        guard isEnabled, isListening else { return false }
        isListening = false
        statusText = "Paused"
        tearDown()
        return true
    }

    func resume(wasSuspended: Bool) {
        guard wasSuspended, isEnabled else { return }
        Task { await start() }
    }

    // MARK: - Permissions

    private nonisolated func requestMicrophonePermission() async -> Bool {
        #if os(iOS)
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        case .undetermined: break
        @unknown default: return false
        }
        return await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { ok in
                cont.resume(returning: ok)
            }
        }
        #elseif os(macOS)
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .denied, .restricted: return false
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        @unknown default: return false
        }
        #else
        return true
        #endif
    }

    private nonisolated func requestSpeechPermission() async -> Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        switch status {
        case .authorized: return true
        case .denied, .restricted: return false
        case .notDetermined: break
        @unknown default: return false
        }
        return await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { authStatus in
                cont.resume(returning: authStatus == .authorized)
            }
        }
    }

    // MARK: - Private

    private func tearDown() {
        tapDrainTask?.cancel()
        tapDrainTask = nil
        tapQueue?.clear()
        tapQueue = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        // Release voice processing hardware so SpeechService can use the mic cleanly
        try? audioEngine.inputNode.setVoiceProcessingEnabled(false)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    private func startRecognition() throws {
        tearDown()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        #if os(macOS)
        request.requiresOnDeviceRecognition = false
        #else
        request.requiresOnDeviceRecognition = true
        #endif
        recognitionRequest = request

        let inputNode = audioEngine.inputNode

        // Enable AEC/noise suppression BEFORE reading format — it changes the format
        try inputNode.setVoiceProcessingEnabled(true)

        let format = inputNode.outputFormat(forBus: 0)
        log.info("Audio format: \(format.sampleRate, privacy: .public)Hz, \(format.channelCount, privacy: .public)ch (AEC enabled)")

        let queue = WakeWordBufferQueue()
        tapQueue = queue
        let tapBlock = makeAudioTapEnqueueCallback(queue: queue)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format, block: tapBlock)

        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let isFinal = result?.isFinal ?? false
            let transcript = result?.bestTranscription.formattedString
            let segments = result.flatMap { r in
                transcript.map { WakeWordSpeechSegments.from(transcription: r.bestTranscription, transcript: $0) }
            } ?? []
            let errorText = error?.localizedDescription

            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleCallback(transcript: transcript, segments: segments, isFinal: isFinal, errorText: errorText)
            }
        }

        // Drain loop: 40ms intervals
        // Use local ref to queue so we don't depend on self.tapQueue (which gets nilled during teardown)
        let drainQueue = queue
        tapDrainTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 40_000_000)
                guard let self else { break }
                let drained = drainQueue.drain()
                guard !drained.isEmpty else { continue }
                for buf in drained {
                    request.append(buf)
                }
                if let lastBuf = drained.last {
                    let level = WakeWordService.computeRMSLevel(lastBuf)
                    self.micLevel = (self.micLevel * 0.92) + (level * 0.08)
                }
            }
        }
    }

    static nonisolated func computeRMSLevel(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let data = buffer.floatChannelData?.pointee else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n {
            let v = data[i]
            sum += v * v
        }
        let rms = sqrt(sum / Float(n))
        return max(0, min(Double(rms) * 10.0, 1.0))
    }

    private func handleCallback(transcript: String?, segments: [WakeWordSegment], isFinal: Bool, errorText: String?) {
        if let errorText {
            // "no speech detected" is normal — just restart
            if errorText.localizedCaseInsensitiveContains("no speech detected") {
                log.debug("No speech detected, restarting...")
            } else {
                log.error("Recognition error: \(errorText, privacy: .public)")
                statusText = "Error: \(errorText)"
            }
            isListening = false
            if isEnabled && !suppressedByCapture {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    await start()
                }
            }
            return
        }

        guard let transcript else { return }
        log.debug("Transcript: \(transcript, privacy: .public) (final=\(isFinal))")

        let config = WakeWordGateConfig(triggers: triggerWords, minPostTriggerGap: 0.15)

        // Path 1: Timing-based detection (primary)
        if let match = WakeWordGate.match(transcript: transcript, segments: segments, config: config) {
            let cmd = match.command
            if cmd == lastDispatched { return }
            lastDispatched = cmd
            log.info("Wake word + command: '\(cmd, privacy: .public)'")
            statusText = "Triggered"
            dispatchCommand(cmd)
            return
        }

        // Path 2: Text-only fallback — trigger detected but no timing match
        // Always dispatch when trigger is found — pipeline handles empty vs non-empty command
        if !textOnlyDispatched,
           WakeWordGate.matchesTextOnly(text: transcript, triggers: triggerWords) {
            let stripped = WakeWordGate.stripWake(text: transcript, triggers: triggerWords)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            textOnlyDispatched = true
            log.info("Wake word (text-only), stripped: '\(stripped, privacy: .public)'")
            statusText = "Triggered"
            dispatchCommand(stripped)
        }
    }

    private func dispatchCommand(_ command: String) {
        Task { [weak self] in
            guard let self else { return }
            await self.onCommand?(command)
            if self.isEnabled && !self.suppressedByCapture {
                await self.start()
            }
        }
    }
}
