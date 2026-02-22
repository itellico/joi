import SwiftUI

struct ChatInput: View {
    @Binding var text: String
    var isStreaming: Bool
    var onSend: () -> Void

    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Group {
                #if os(macOS)
                TextField("Message JOI...", text: $text)
                    .lineLimit(1)
                #else
                TextField("Message JOI...", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                #endif
            }
                .textFieldStyle(.plain)
                .font(JOITypography.bodyMedium)
                .foregroundStyle(JOIColors.textPrimary)
                .focused($isFocused)
                .submitLabel(.send)
                .frame(minHeight: 22, alignment: .center)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(JOIColors.surface.opacity(0.9))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onSubmit {
                    if canSend { onSend() }
                }

            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(canSend ? JOIColors.textOnPrimary : JOIColors.textTertiary)
                    .frame(width: 32, height: 32)
                    .background(canSend ? JOIColors.primary : JOIColors.surface)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(JOIColors.surfaceVariant.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(JOIColors.borderSubtle, lineWidth: 1))
        .padding(.horizontal, 14)
        .padding(.bottom, 12)
        #if os(macOS)
        .onAppear {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 120_000_000)
                isFocused = true
            }
        }
        #endif
    }
}
