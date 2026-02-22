import SwiftUI

public enum JoiAudioDriveMode: String, CaseIterable, Identifiable {
    case manual
    case simulate
    case microphone

    public var id: String { rawValue }
}

/// Audio-reactive JOI orb. Works with manual, simulated, or microphone drive.
public struct JoiMicReactiveOrbView: View {
    @StateObject private var monitor = JoiMicrophoneLevelMonitor()

    public var mode: JoiAudioDriveMode
    public var manualLevel: CGFloat
    public var size: CGFloat
    public var baseIntensity: CGFloat
    public var baseSpeed: CGFloat
    public var reactiveIntensityBoost: CGFloat
    public var reactiveSpeedBoost: CGFloat
    public var audioGain: CGFloat
    public var audioGate: CGFloat
    public var audioInfluence: CGFloat
    public var theme: JoiUniverseOrbView.Theme

    public init(
        mode: JoiAudioDriveMode = .simulate,
        manualLevel: CGFloat = 0.0,
        size: CGFloat = 30,
        baseIntensity: CGFloat = 0.28,
        baseSpeed: CGFloat = 0.7,
        reactiveIntensityBoost: CGFloat = 1.05,
        reactiveSpeedBoost: CGFloat = 1.6,
        audioGain: CGFloat = 5.0,
        audioGate: CGFloat = 0.01,
        audioInfluence: CGFloat = 1.35,
        theme: JoiUniverseOrbView.Theme = .orange
    ) {
        self.mode = mode
        self.manualLevel = manualLevel
        self.size = size
        self.baseIntensity = baseIntensity
        self.baseSpeed = baseSpeed
        self.reactiveIntensityBoost = reactiveIntensityBoost
        self.reactiveSpeedBoost = reactiveSpeedBoost
        self.audioGain = audioGain
        self.audioGate = audioGate
        self.audioInfluence = audioInfluence
        self.theme = theme
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let simulated = simulatedSpeechLevel(at: t)
            let currentLevel = resolvedAudioLevel(simulated: simulated)
            let intensity = baseIntensity + currentLevel * reactiveIntensityBoost
            let speed = baseSpeed + currentLevel * reactiveSpeedBoost

            JoiUniverseOrbView(
                intensity: min(1.35, max(0.08, intensity)),
                speed: min(2.8, max(0.2, speed)),
                theme: theme
            )
            .frame(width: size, height: size)
        }
        .onAppear {
            handleModeChange(to: mode)
        }
        .onChange(of: mode) { _, newValue in
            handleModeChange(to: newValue)
        }
        .onDisappear {
            monitor.stop()
        }
    }

    private func handleModeChange(to newMode: JoiAudioDriveMode) {
        switch newMode {
        case .microphone:
            monitor.start()
        case .manual, .simulate:
            monitor.stop()
        }
    }

    private func resolvedAudioLevel(simulated: CGFloat) -> CGFloat {
        let source: CGFloat
        switch mode {
        case .manual:
            source = min(1, max(0, manualLevel))
        case .simulate:
            source = simulated
        case .microphone:
            source = monitor.level
        }

        // Match web behavior: gate + gain + curve + final influence.
        let gated = max(0, min(1.25, (source - audioGate) * audioGain))
        let shaped = pow(gated, 0.74)
        let influenced = max(0, min(1.35, shaped * audioInfluence))
        return influenced
    }

    private func simulatedSpeechLevel(at time: TimeInterval) -> CGFloat {
        let phrase = max(0, sin(time * 4.1 + sin(time * 0.6) * 0.8))
        let syllable = max(0, sin(time * 11.8 + 1.1))
        let chatter = max(0, sin(time * 19.6 + 0.9)) * 0.45
        let breaths = max(0, sin(time * 0.85)) * 0.22
        let v = phrase * 0.52 + syllable * 0.29 + chatter * 0.15 + breaths * 0.12
        return CGFloat(min(1, max(0, v)))
    }
}
