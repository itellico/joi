import SwiftUI

struct ConnectionBanner: View {
    let state: WebSocketClient.ConnectionState
    let error: String?

    @State private var showBanner = false

    var body: some View {
        if showBanner && state != .connected {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .font(.system(size: 12))
                Text(statusText)
                    .font(JOITypography.labelMedium)
            }
            .foregroundStyle(foregroundColor)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(backgroundColor)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var iconName: String {
        switch state {
        case .disconnected: "exclamationmark.triangle.fill"
        case .connecting, .reconnecting: "arrow.triangle.2.circlepath"
        case .connected: "checkmark.circle.fill"
        }
    }

    private var statusText: String {
        switch state {
        case .disconnected: error ?? "Disconnected"
        case .connecting: "Connecting..."
        case .reconnecting: "Reconnecting..."
        case .connected: "Connected"
        }
    }

    private var foregroundColor: Color {
        switch state {
        case .disconnected: .white
        case .connecting, .reconnecting: JOIColors.textOnPrimary
        case .connected: .white
        }
    }

    private var backgroundColor: Color {
        switch state {
        case .disconnected: JOIColors.error.opacity(0.9)
        case .connecting, .reconnecting: JOIColors.warning.opacity(0.9)
        case .connected: JOIColors.success.opacity(0.9)
        }
    }
}

// Extension to add the delay behavior at the call site
extension ConnectionBanner {
    /// Shows the banner only after a grace period, so it doesn't flash during initial connection.
    func withStartupGrace() -> some View {
        self.modifier(StartupGraceModifier(state: state, showBanner: $showBanner))
    }
}

private struct StartupGraceModifier: ViewModifier {
    let state: WebSocketClient.ConnectionState
    @Binding var showBanner: Bool
    @State private var hasEverConnected = false
    @State private var graceElapsed = false

    func body(content: Content) -> some View {
        content
            .onChange(of: state) { _, newState in
                if newState == .connected {
                    hasEverConnected = true
                    withAnimation(.easeOut(duration: 0.2)) { showBanner = false }
                } else if hasEverConnected || graceElapsed {
                    withAnimation(.easeIn(duration: 0.2)) { showBanner = true }
                }
            }
            .task {
                // Give 3 seconds for initial connection before showing banner
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                graceElapsed = true
                if state != .connected {
                    withAnimation(.easeIn(duration: 0.2)) { showBanner = true }
                }
            }
    }
}
