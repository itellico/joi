import AVFoundation
import Foundation
import Observation
import os
import Speech

private final class AudioBufferQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var buffers: [AVAudioPCMBuffer] = []
    private(set) var tapCount = 0
    private(set) var copyFailCount = 0

    func enqueueCopy(of buffer: AVAudioPCMBuffer) {
        let copy = buffer.deepCopy()
        lock.lock()
        tapCount += 1
        if let copy {
            buffers.append(copy)
        } else {
            copyFailCount += 1
        }
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

    func stats() -> (taps: Int, copyFails: Int) {
        lock.lock()
        let result = (taps: tapCount, copyFails: copyFailCount)
        lock.unlock()
        return result
    }
}

private func makeAudioTapCallback(queue: AudioBufferQueue) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
    { buffer, _ in
        queue.enqueueCopy(of: buffer)
    }
}

private extension AVAudioPCMBuffer {
    func deepCopy() -> AVAudioPCMBuffer? {
        let fmt = format
        let len = frameLength
        guard let copy = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: len) else { return nil }
        copy.frameLength = len

        if let src = floatChannelData, let dst = copy.floatChannelData {
            let channels = Int(fmt.channelCount)
            let frames = Int(len)
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
            return copy
        }
        if let src = int16ChannelData, let dst = copy.int16ChannelData {
            let channels = Int(fmt.channelCount)
            let frames = Int(len)
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
            return copy
        }
        return nil
    }
}

@MainActor
@Observable
final class SpeechService: NSObject {
    var isListening = false
    var transcript = ""
    var micLevel: Double = 0
    var statusText = "Off"

    private let audioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var tapQueue: AudioBufferQueue?
    private var tapDrainTask: Task<Void, Never>?
    private let log = Logger(subsystem: "com.joi.app", category: "SpeechService")
    private let dlog = VoiceDebugLog.shared

    var onTranscript: (@MainActor (String, Bool) -> Void)?

    func start() async -> Bool {
        guard !isListening else { return true }
        dlog.log("speech", "start() — requesting permissions...")

        let micOk = await requestMicrophonePermission()
        guard micOk else {
            log.error("Microphone permission denied")
            dlog.log("speech", "FAIL: mic permission denied")
            statusText = "Microphone permission denied"
            return false
        }

        let speechOk = await requestSpeechPermission()
        guard speechOk else {
            log.error("Speech recognition permission denied")
            dlog.log("speech", "FAIL: speech permission denied")
            statusText = "Speech recognition permission denied. Enable in System Settings > Privacy > Speech Recognition."
            return false
        }

        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        guard let sr = speechRecognizer, sr.isAvailable else {
            log.error("Speech recognizer unavailable (en-US)")
            dlog.log("speech", "FAIL: recognizer unavailable")
            statusText = "Speech recognizer unavailable (en-US)"
            return false
        }
        dlog.log("speech", "recognizer OK: \(sr.locale.identifier), onDevice=\(sr.supportsOnDeviceRecognition)")

        do {
            #if os(iOS)
            try configureAudioSession()
            #endif
            try startRecognition()
            isListening = true
            statusText = "Listening"
            log.info("SpeechService started")
            dlog.log("speech", "start() OK — isListening=true")
            return true
        } catch {
            log.error("Start failed: \(error.localizedDescription)")
            dlog.log("speech", "FAIL: startRecognition threw: \(error.localizedDescription)")
            statusText = "Start failed: \(error.localizedDescription)"
            return false
        }
    }

    func stop() {
        let stats = tapQueue?.stats()
        dlog.log("speech", "stop() — taps=\(stats?.taps ?? 0), copyFails=\(stats?.copyFails ?? 0), callbacks=\(recognitionCallbackCount), transcript='\(transcript.prefix(40))'")

        isListening = false
        statusText = "Off"
        transcript = ""
        micLevel = 0

        tapDrainTask?.cancel()
        tapDrainTask = nil
        tapQueue?.clear()
        tapQueue = nil

        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil

        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif

        speechRecognizer = nil
    }

    func suspend() -> Bool {
        guard isListening else { return false }
        stop()
        return true
    }

    func resume(wasSuspended: Bool) async {
        guard wasSuspended else { return }
        _ = await start()
    }

    // MARK: - Recognition

    private var recognitionCallbackCount = 0

    private func startRecognition() throws {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        #if os(macOS)
        // On macOS, on-device recognition requires Siri & Dictation to be enabled.
        // Use server-based recognition which works without that requirement.
        request.requiresOnDeviceRecognition = false
        #else
        request.requiresOnDeviceRecognition = true
        #endif
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        inputNode.removeTap(onBus: 0)

        // Do NOT enable voice processing (AEC) on SpeechService.
        // AEC is only needed on WakeWordService (to filter TTS playback).
        // During capture, TTS isn't playing, and enabling voice processing
        // on a second AVAudioEngine can conflict with the first on macOS.
        // Explicitly disable in case it was left enabled from a previous session.
        try inputNode.setVoiceProcessingEnabled(false)

        let recordingFormat = inputNode.outputFormat(forBus: 0)
        dlog.log("speech", "format: \(recordingFormat.sampleRate)Hz, \(recordingFormat.channelCount)ch, \(recordingFormat.commonFormat.rawValue)fmt")
        log.info("Audio format: \(recordingFormat.sampleRate, privacy: .public)Hz, \(recordingFormat.channelCount, privacy: .public)ch (AEC off)")

        let queue = AudioBufferQueue()
        tapQueue = queue
        let tapBlock = makeAudioTapCallback(queue: queue)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat, block: tapBlock)

        audioEngine.prepare()
        try audioEngine.start()
        dlog.log("speech", "engine started, installing recognition task...")

        recognitionCallbackCount = 0
        recognitionTask = speechRecognizer?.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let errorCopy = error
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.recognitionCallbackCount += 1
                self.dlog.log("speech", "callback #\(self.recognitionCallbackCount): text=\(text?.prefix(40) ?? "nil"), final=\(isFinal), err=\(errorCopy?.localizedDescription ?? "none")")
                if let errorCopy {
                    self.handleRecognitionError(errorCopy)
                    return
                }
                guard let text else { return }
                self.transcript = text
                self.onTranscript?(text, isFinal)
            }
        }

        if recognitionTask == nil {
            dlog.log("speech", "WARNING: recognitionTask is nil — speechRecognizer may be unavailable")
        }

        // Drain loop: 40ms intervals
        // Use local ref to queue so we don't depend on self.tapQueue (which gets nilled during teardown)
        let drainQueue = queue
        var drainCycleCount = 0
        var totalBuffersDrained = 0
        tapDrainTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 40_000_000)
                guard let self else { break }
                let drained = drainQueue.drain()
                drainCycleCount += 1

                // Log diagnostics every 25 cycles (~1s)
                if drainCycleCount % 25 == 0 {
                    let stats = drainQueue.stats()
                    self.dlog.log("speech", "drain[\(drainCycleCount)]: total_taps=\(stats.taps), total_drained=\(totalBuffersDrained), copyFails=\(stats.copyFails), rms=\(String(format: "%.4f", self.micLevel))")
                }

                guard !drained.isEmpty else { continue }
                totalBuffersDrained += drained.count
                for buf in drained {
                    request.append(buf)
                }
                if let lastBuf = drained.last {
                    let level = SpeechService.computeRMSLevel(lastBuf)
                    self.micLevel = (self.micLevel * 0.92) + (level * 0.08)
                }
            }
        }
    }

    private func handleRecognitionError(_ error: Error) {
        let msg = error.localizedDescription
        dlog.log("speech", "recognitionError: \(msg)")
        if msg.localizedCaseInsensitiveContains("no speech detected") {
            log.debug("No speech detected during capture, restarting recognizer...")
            statusText = isListening ? "Listening" : statusText
        } else {
            log.error("Speech recognition error: \(msg, privacy: .public)")
            statusText = "Speech error: \(msg)"
        }

        // Restart the recognizer transparently (don't change isListening flag
        // so the pipeline still sees us as active)
        if isListening {
            tearDownRecognizer()
            Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard self.isListening else { return }
                do {
                    try self.startRecognition()
                    self.log.info("Recognizer restarted successfully")
                } catch {
                    self.log.error("Recognizer restart failed: \(error.localizedDescription, privacy: .public)")
                    self.stop()
                }
            }
        }
    }

    /// Tear down just the recognizer, keeping isListening state
    private func tearDownRecognizer() {
        tapDrainTask?.cancel()
        tapDrainTask = nil
        tapQueue?.clear()
        tapQueue = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
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

    // MARK: - Audio Session

    #if os(iOS)
    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [
            .allowBluetoothHFP,
            .defaultToSpeaker,
        ])
        try session.setActive(true)
    }
    #endif

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
}
