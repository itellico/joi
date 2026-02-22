import SwiftUI

struct WatchHomeView: View {
    @Environment(WatchSessionClient.self) private var session
    @State private var isHoldingToTalk = false
    @State private var hasActiveHoldGesture = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text("JOI")
                        .font(.headline)
                    Circle()
                        .fill(connectionColor)
                        .frame(width: 8, height: 8)
                    Text(connectionText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(session.statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)

                if let lastError = session.lastError, !lastError.isEmpty {
                    Text(lastError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Hold To Talk")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(isHoldingToTalk ? Color.green.opacity(0.25) : Color.blue.opacity(0.18))
                        VStack(spacing: 3) {
                            Image(systemName: isHoldingToTalk ? "waveform" : "mic.fill")
                                .font(.system(size: 20, weight: .semibold))
                            Text(isHoldingToTalk ? "Listening..." : "Press + hold")
                                .font(.caption2)
                        }
                        .foregroundStyle(.primary)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 86)
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .gesture(holdToTalkGesture)
                }

                if !session.capturedTranscript.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Live Transcript")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(session.capturedTranscript)
                            .font(.footnote)
                            .lineLimit(4)
                    }
                }

                Button(session.isActive ? "JOI Off" : "JOI On") {
                    session.send(command: session.isActive ? .stopVoice : .startVoice)
                }
                .buttonStyle(.borderedProminent)

                HStack(spacing: 8) {
                    Button("Ping") {
                        session.requestStatus()
                    }
                    .buttonStyle(.bordered)

                    Button(session.isMuted ? "Unmute" : "Mute") {
                        session.send(command: session.isMuted ? .unmute : .mute)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
        }
        .onAppear {
            session.requestStatus()
        }
        .onDisappear {
            if hasActiveHoldGesture {
                hasActiveHoldGesture = false
                isHoldingToTalk = false
                session.send(command: .pressToTalkEnd)
            }
        }
    }

    private var connectionText: String {
        session.isReachable ? "Live" : "Queued"
    }

    private var connectionColor: Color {
        session.isReachable ? .green : .orange
    }

    private var holdToTalkGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard !hasActiveHoldGesture else { return }
                hasActiveHoldGesture = true
                isHoldingToTalk = true
                session.send(command: .pressToTalkStart)
            }
            .onEnded { _ in
                guard hasActiveHoldGesture else { return }
                hasActiveHoldGesture = false
                isHoldingToTalk = false
                session.send(command: .pressToTalkEnd)
            }
    }
}
