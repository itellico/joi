import SwiftUI

struct ConnectionStatusPill: View {
    let state: WebSocketClient.ConnectionState
    @State private var isPulsing = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
                .scaleEffect(isPulsing ? 1.3 : 1.0)
                .animation(
                    state == .connecting || state == .reconnecting
                        ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                        : .default,
                    value: isPulsing)

            Text(label)
                .font(JOITypography.labelSmall)
                .foregroundStyle(JOIColors.textSecondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(JOIColors.surfaceVariant)
        .clipShape(Capsule())
        .onAppear {
            isPulsing = state == .connecting || state == .reconnecting
        }
        .onChange(of: state) {
            isPulsing = state == .connecting || state == .reconnecting
        }
    }

    private var dotColor: Color {
        switch state {
        case .connected: JOIColors.success
        case .connecting, .reconnecting: JOIColors.warning
        case .disconnected: JOIColors.error
        }
    }

    private var label: String {
        switch state {
        case .connected: "Voice Live"
        case .connecting: "Linking Voice"
        case .reconnecting: "Re-linking"
        case .disconnected: "Voice Offline"
        }
    }
}
