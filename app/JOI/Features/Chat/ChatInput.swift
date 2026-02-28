import SwiftUI
#if os(iOS)
import UIKit
#endif

struct ChatInput: View {
    @Binding var text: String
    var isStreaming: Bool
    var onSend: () -> Void
    var composeContextLabel: String? = nil
    var composeContextPreview: String? = nil
    var allowContextOnlySend: Bool = false
    var onClearComposeContext: (() -> Void)? = nil
    var onAddAction: (() -> Void)? = nil
    var onMicAction: (() -> Void)? = nil
    var isMicActive: Bool = false
    #if os(iOS)
    var attachmentPreview: UIImage? = nil
    var attachmentName: String? = nil
    var onRemoveAttachment: (() -> Void)? = nil
    #endif

    @FocusState private var isFocused: Bool
    #if os(iOS)
    @State private var textViewHeight: CGFloat = ChatInputTextView.minHeight
    #endif

    private var hasAttachment: Bool {
        #if os(iOS)
        if attachmentPreview != nil {
            return true
        }
        guard let attachmentName else { return false }
        return !attachmentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        #else
        false
        #endif
    }

    private var canSend: Bool {
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasAttachment || allowContextOnlySend) && !isStreaming
    }

    private var hasComposeContext: Bool {
        guard let label = composeContextLabel?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return false
        }
        return !label.isEmpty
    }

    var body: some View {
        #if os(macOS)
        VStack(alignment: .leading, spacing: 8) {
            if hasComposeContext {
                composeContextView
            }

            HStack(alignment: .center, spacing: 10) {
                Group {
                    TextField("Message JOI...", text: $text)
                        .lineLimit(1)
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
        .onAppear {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 120_000_000)
                isFocused = true
            }
        }
        #else
        VStack(alignment: .leading, spacing: 8) {
            if hasComposeContext {
                composeContextView
            }

            HStack(alignment: .center, spacing: 10) {
                if let attachmentPreview {
                    Button(action: {
                        onRemoveAttachment?()
                    }) {
                        ZStack(alignment: .topTrailing) {
                            Image(uiImage: attachmentPreview)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 30, height: 30)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.92), Color.black.opacity(0.55))
                                .offset(x: 4, y: -4)
                        }
                    }
                    .buttonStyle(.plain)
                } else if let attachmentName, !attachmentName.isEmpty {
                    Button(action: {
                        onRemoveAttachment?()
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(JOIColors.secondary)
                            Text(attachmentName)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(JOIColors.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(JOIColors.textSecondary.opacity(0.82))
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(JOIColors.surfaceHigh.opacity(0.86))
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    iconButton(systemName: "plus", action: {
                        onAddAction?()
                    })
                }

                ZStack(alignment: .leading) {
                    if text.isEmpty {
                        Text("Message JOI...")
                            .font(.system(size: 19, weight: .regular))
                            .foregroundStyle(JOIColors.textTertiary)
                            .padding(.leading, 8)
                            .allowsHitTesting(false)
                    }

                    ChatInputTextView(text: $text, textHeight: $textViewHeight) {
                        if canSend { onSend() }
                    }
                    .frame(height: textViewHeight)
                    .padding(.horizontal, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let onMicAction, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !hasAttachment {
                    iconButton(
                        systemName: "waveform",
                        isActive: isMicActive,
                        action: onMicAction
                    )
                    .accessibilityLabel("Attach audio for transcription")
                }

                Button(action: onSend) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(canSend ? .white : JOIColors.textTertiary)
                        .frame(width: 32, height: 32)
                        .background(canSend ? JOIColors.secondary : JOIColors.surfaceHigh)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(JOIColors.surface.opacity(0.92))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(JOIColors.border.opacity(0.7), lineWidth: 1)
        )
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        #endif
    }

    @ViewBuilder
    private var composeContextView: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(composeContextLabel ?? "")
                    .font(JOITypography.labelSmall)
                    .foregroundStyle(JOIColors.textSecondary)
                    .textCase(.uppercase)
                if let composeContextPreview, !composeContextPreview.isEmpty {
                    Text(composeContextPreview)
                        .font(JOITypography.bodySmall)
                        .foregroundStyle(JOIColors.textPrimary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let onClearComposeContext {
                Button(action: onClearComposeContext) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(JOIColors.textSecondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(JOIColors.surfaceHigh.opacity(0.72))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(JOIColors.border.opacity(0.62), lineWidth: 1)
        )
    }

    #if os(iOS)
    private func iconButton(systemName: String, isActive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(isActive ? JOIColors.secondary : JOIColors.textSecondary)
                .frame(width: 24, height: 24)
                .background(
                    Circle()
                        .fill(isActive ? JOIColors.secondary.opacity(0.14) : Color.clear)
                )
                .overlay(
                    Circle()
                        .stroke(isActive ? JOIColors.secondary.opacity(0.38) : Color.clear, lineWidth: 1)
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
    #endif
}

#if os(iOS)
private struct ChatInputTextView: UIViewRepresentable {
    static let minHeight: CGFloat = 34
    static let maxHeight: CGFloat = 112

    @Binding var text: String
    @Binding var textHeight: CGFloat
    var onSubmit: () -> Void

    func makeUIView(context: Context) -> ReturnAwareTextView {
        let view = ReturnAwareTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textColor = UIColor(JOIColors.textPrimary)
        view.tintColor = UIColor(JOIColors.secondary)
        view.font = UIFont.systemFont(ofSize: 19, weight: .regular)
        view.adjustsFontForContentSizeCategory = true
        view.isScrollEnabled = false
        view.textContainerInset = UIEdgeInsets(top: 6, left: 0, bottom: 6, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.textContainer.lineBreakMode = .byWordWrapping
        view.textContainer.widthTracksTextView = true
        view.autocorrectionType = .yes
        view.autocapitalizationType = .sentences
        view.returnKeyType = .send
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.onSubmit = onSubmit
        DispatchQueue.main.async {
            Self.recalculateHeight(for: view, height: $textHeight)
        }
        return view
    }

    func updateUIView(_ uiView: ReturnAwareTextView, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
        uiView.onSubmit = onSubmit
        Self.recalculateHeight(for: uiView, height: $textHeight)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private var parent: ChatInputTextView

        init(_ parent: ChatInputTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            ChatInputTextView.recalculateHeight(for: textView, height: parent.$textHeight)
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText replacement: String
        ) -> Bool {
            guard replacement == "\n" else { return true }
            guard let returnAware = textView as? ReturnAwareTextView else {
                parent.onSubmit()
                return false
            }
            if returnAware.consumeShiftReturnState() {
                return true
            }
            parent.onSubmit()
            return false
        }
    }

    static func recalculateHeight(for textView: UITextView, height: Binding<CGFloat>) {
        let availableWidth = textView.bounds.width
        guard availableWidth > 0 else { return }

        let fittingSize = textView.sizeThatFits(
            CGSize(width: availableWidth, height: .greatestFiniteMagnitude)
        )
        let clampedHeight = min(max(fittingSize.height, minHeight), maxHeight)

        textView.isScrollEnabled = fittingSize.height > maxHeight
        guard abs(height.wrappedValue - clampedHeight) > 0.5 else { return }
        DispatchQueue.main.async {
            height.wrappedValue = clampedHeight
        }
    }
}

private final class ReturnAwareTextView: UITextView {
    var onSubmit: (() -> Void)?
    private var shiftReturnRequested = false

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: "\r", modifierFlags: [], action: #selector(handleReturn)),
            UIKeyCommand(input: "\r", modifierFlags: [.shift], action: #selector(handleShiftReturn))
        ]
    }

    @objc private func handleReturn() {
        onSubmit?()
    }

    @objc private func handleShiftReturn() {
        shiftReturnRequested = true
        insertText("\n")
    }

    func consumeShiftReturnState() -> Bool {
        let value = shiftReturnRequested
        shiftReturnRequested = false
        return value
    }
}
#endif
