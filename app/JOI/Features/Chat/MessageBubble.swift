import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct MessageBubble: View {
    let message: ChatUIMessage
    var replyPreview: String? = nil
    var onReply: ((ChatUIMessage) -> Void)? = nil
    var onForward: ((ChatUIMessage) -> Void)? = nil
    var onToggleReaction: ((ChatUIMessage, String) -> Void)? = nil
    var onPin: ((ChatUIMessage) -> Void)? = nil
    var onReport: ((ChatUIMessage) -> Void)? = nil
    var onDelete: ((ChatUIMessage) -> Void)? = nil
    var onSelect: ((ChatUIMessage) -> Void)? = nil
    var onSelectOnly: ((ChatUIMessage) -> Void)? = nil
    var isSelected: Bool = false
    var selectionMode: Bool = false

    private var isUser: Bool { message.role == "user" }
    private var isError: Bool { message.isError }
    private var hasComposerActions: Bool {
        !message.isStreaming
            && (message.role == "user" || message.role == "assistant")
            && (onReply != nil || onForward != nil || hasReactionActions
                || onPin != nil || onReport != nil || onDelete != nil || onSelectOnly != nil)
    }
    private var hasReactionActions: Bool {
        !message.isStreaming
            && message.role == "assistant"
            && onToggleReaction != nil
    }

    private var backgroundColor: Color {
        if isError { return JOIColors.error.opacity(0.12) }
        if isUser { return JOIColors.primary.opacity(0.12) }
        return Color.white.opacity(0.06)
    }

    private var borderColor: Color {
        if isError { return JOIColors.error.opacity(0.28) }
        if isUser { return JOIColors.primary.opacity(0.22) }
        return Color.white.opacity(0.08)
    }

    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 16,
            bottomLeadingRadius: isUser ? 16 : 11,
            bottomTrailingRadius: isUser ? 11 : 16,
            topTrailingRadius: 16)
    }

    var body: some View {
        HStack {
            bubbleBody
                .frame(maxWidth: 520, alignment: isUser ? .trailing : .leading)
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
    }

    private var bubbleBody: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
            if !isUser {
                HStack(spacing: 8) {
                    JOIAvatarImage(
                        style: message.isStreaming ? .firestorm : .transparent,
                        activityLevel: message.isStreaming ? 0.72 : 0.16,
                        isActive: message.isStreaming,
                        showPulseRings: false,
                        animated: message.isStreaming
                    )
                        .frame(width: 18, height: 18)
                        .clipShape(Circle())

                    if message.isStreaming, let startedAt = message.streamStartedAt {
                        ElapsedChip(startedAt: startedAt)
                    }
                }
                .padding(.leading, 2)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
                if selectionMode {
                    Button {
                        onSelect?(message)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Select")
                                .font(JOITypography.labelSmall)
                        }
                        .foregroundStyle(JOIColors.textSecondary)
                    }
                    .buttonStyle(.plain)
                }

                relationContext
                messageContent
                if let firstLink = firstLinkURL {
                    MessageLinkPreview(url: firstLink)
                }

                if !message.isStreaming {
                    Text(timestampLabel)
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(JOIColors.textSecondary.opacity(0.78))
                }

                if !message.attachments.isEmpty {
                    attachmentChips
                }

                if !message.mentions.isEmpty {
                    mentionChips
                }

                if !reactionEntries.isEmpty {
                    reactionChips
                }

                if !message.toolCalls.isEmpty {
                    toolBadges
                }

                if !message.toolCalls.isEmpty || !message.plannedSteps.isEmpty {
                    ToolChecklistView(toolCalls: message.toolCalls, plannedSteps: message.plannedSteps)
                }

                if !message.isStreaming, let meta = metadataChips, !meta.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(meta) { chip in
                                MetaChip(icon: chip.icon, text: chip.text)
                            }
                        }
                        .padding(.vertical, 1)
                    }
                    .scrollIndicators(.hidden)
                    .joiHideScrollChrome()
                }

                if hasComposerActions {
                    composerActionRow
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(backgroundColor)
            .clipShape(bubbleShape)
            .overlay(
                bubbleShape
                    .stroke(isSelected ? JOIColors.secondary.opacity(0.75) : borderColor, lineWidth: isSelected ? 1.6 : 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 3)
            .contextMenu {
                if hasReactionActions {
                    Section("React") {
                        ForEach(ChatViewModel.quickReactionEmojis, id: \.self) { emoji in
                            Button(emoji) {
                                onToggleReaction?(message, emoji)
                            }
                        }
                    }
                }

                if let onReply {
                    Button("Reply", systemImage: "arrowshape.turn.up.left") {
                        onReply(message)
                    }
                }
                if let onForward {
                    Button("Forward", systemImage: "arrowshape.turn.up.right") {
                        onForward(message)
                    }
                }
                if let onPin {
                    Button(message.pinned ? "Unpin" : "Pin", systemImage: message.pinned ? "pin.slash" : "pin") {
                        onPin(message)
                    }
                }
                if let onReport {
                    Button("Report", systemImage: "exclamationmark.bubble") {
                        onReport(message)
                    }
                }
                if let onDelete {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        onDelete(message)
                    }
                }
                if let onSelectOnly {
                    Button("Select", systemImage: "checkmark.circle") {
                        onSelectOnly(message)
                    }
                }
                if !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Copy Text", systemImage: "doc.on.doc") {
                        copyMessageTextToClipboard()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        if message.isStreaming && message.content.isEmpty {
            HStack(spacing: 8) {
                Text(streamingFiller)
                    .font(JOITypography.bodySmall)
                    .foregroundStyle(JOIColors.textSecondary)
                    .lineLimit(2)

                StreamingDots()
            }
        } else {
            Text(parsedMarkdownContent)
                .font(messageBodyFont)
                .foregroundStyle(JOIColors.textPrimary)
                .tint(JOIColors.secondary)
                .lineSpacing(5)
                .multilineTextAlignment(.leading)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var relationContext: some View {
        if message.pinned {
            MessageContextChip(
                icon: "pin.fill",
                text: "Pinned",
                accent: JOIColors.secondary.opacity(0.88))
        }

        if message.reported {
            MessageContextChip(
                icon: "exclamationmark.triangle.fill",
                text: message.reportNote.flatMap { note in
                    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                    return trimmed.isEmpty ? nil : "Reported: \(trimmed)"
                } ?? "Reported",
                accent: JOIColors.warning.opacity(0.9))
        }

        if let replyToId = message.replyToMessageId {
            MessageContextChip(
                icon: "arrowshape.turn.up.left",
                text: "Replying to \(replyPreviewText(replyToId: replyToId))")
        }

        if let forwardOf = message.forwardOfMessageId {
            let sourceLabel = forwardedSourceRole ?? "message"
            MessageContextChip(
                icon: "arrowshape.turn.up.right",
                text: "Forwarded from \(sourceLabel)",
                accent: JOIColors.warning.opacity(0.82))
                .accessibilityLabel("Forwarded from \(sourceLabel), id \(forwardOf)")
        }
    }

    private var attachmentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(message.attachments.enumerated()), id: \.offset) { entry in
                    let attachment = entry.element
                    MessageContextChip(
                        icon: attachmentIcon(for: attachment),
                        text: attachment.name ?? attachment.type,
                        accent: JOIColors.textSecondary.opacity(0.72))
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .joiHideScrollChrome()
    }

    private var mentionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(message.mentions.indices, id: \.self) { index in
                    let mention = message.mentions[index]
                    MessageContextChip(
                        icon: "at",
                        text: "@\(mention.value)",
                        accent: JOIColors.secondary.opacity(0.88))
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .joiHideScrollChrome()
    }

    private var reactionEntries: [(emoji: String, count: Int, reacted: Bool)] {
        message.reactions
            .compactMap { (emoji: String, actors: [String]) -> (emoji: String, count: Int, reacted: Bool)? in
                let normalizedEmoji = emoji.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !normalizedEmoji.isEmpty else { return nil }
                let uniqueActors = Array(Set(actors))
                guard !uniqueActors.isEmpty else { return nil }
                return (
                    emoji: normalizedEmoji,
                    count: uniqueActors.count,
                    reacted: uniqueActors.contains(ChatViewModel.reactionActorId)
                )
            }
            .sorted { lhs, rhs in
                if lhs.count == rhs.count {
                    return lhs.emoji < rhs.emoji
                }
                return lhs.count > rhs.count
            }
    }

    private var reactionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(reactionEntries, id: \.emoji) { entry in
                    Button {
                        onToggleReaction?(message, entry.emoji)
                    } label: {
                        HStack(spacing: 4) {
                            Text(entry.emoji)
                                .font(.system(size: 13))
                            if entry.count > 1 {
                                Text("\(entry.count)")
                                    .font(JOITypography.labelSmall)
                                    .foregroundStyle(JOIColors.textSecondary)
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(entry.reacted ? JOIColors.secondary.opacity(0.18) : JOIColors.surfaceVariant.opacity(0.62))
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(entry.reacted ? JOIColors.secondary.opacity(0.6) : JOIColors.border.opacity(0.5), lineWidth: 0.9)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .joiHideScrollChrome()
    }

    private var composerActionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if hasReactionActions {
                    HStack(spacing: 5) {
                        ForEach(ChatViewModel.quickReactionEmojis, id: \.self) { emoji in
                            Button {
                                onToggleReaction?(message, emoji)
                            } label: {
                                Text(emoji)
                                    .font(.system(size: 13))
                                    .frame(width: 24, height: 24)
                                    .background(JOIColors.surface.opacity(0.68))
                                    .clipShape(Circle())
                                    .overlay(
                                        Circle()
                                            .stroke(JOIColors.border.opacity(0.5), lineWidth: 0.9)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if let onReply {
                    actionButton(label: "Reply", icon: "arrowshape.turn.up.left") {
                        onReply(message)
                    }
                }

                if let onForward {
                    actionButton(label: "Forward", icon: "arrowshape.turn.up.right") {
                        onForward(message)
                    }
                }

                if let onPin {
                    actionButton(label: message.pinned ? "Unpin" : "Pin", icon: message.pinned ? "pin.slash" : "pin") {
                        onPin(message)
                    }
                }

                if let onReport {
                    actionButton(label: "Report", icon: "exclamationmark.bubble") {
                        onReport(message)
                    }
                }

                if let onDelete {
                    actionButton(label: "Delete", icon: "trash") {
                        onDelete(message)
                    }
                }

                if let onSelectOnly {
                    actionButton(label: "Select", icon: "checkmark.circle") {
                        onSelectOnly(message)
                    }
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .joiHideScrollChrome()
    }

    private func actionButton(label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                Text(label)
                    .font(JOITypography.labelSmall)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(JOIColors.textPrimary.opacity(0.95))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(JOIColors.surface.opacity(0.68))
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(JOIColors.border.opacity(0.5), lineWidth: 0.9)
            )
        }
        .buttonStyle(.plain)
    }

    private func replyPreviewText(replyToId: String) -> String {
        if let replyPreview {
            let trimmed = replyPreview.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed.count > 90 ? "\(trimmed.prefix(87))..." : trimmed
            }
        }
        return "message \(replyToId.prefix(8))"
    }

    private var forwardedSourceRole: String? {
        guard let forwardingMetadata = message.forwardingMetadata?.value as? [String: Any] else {
            return nil
        }
        if let role = forwardingMetadata["sourceRole"] as? String,
           !role.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return role
        }
        return nil
    }

    private func attachmentIcon(for attachment: ChatAttachment) -> String {
        let lowerType = attachment.type.lowercased()
        if lowerType.contains("photo") || lowerType.contains("image") { return "photo" }
        if lowerType.contains("video") { return "video" }
        if lowerType.contains("audio") || lowerType.contains("voice") { return "waveform" }
        if lowerType.contains("doc") { return "doc.text" }
        return "paperclip"
    }

    private var toolBadges: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(message.toolCalls) { toolCall in
                    ToolBadge(toolCall: toolCall)
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .joiHideScrollChrome()
    }

    private var metadataChips: [MetaChipModel]? {
        var chips: [MetaChipModel] = []

        if let latency = message.latencyMs {
            if let ttft = message.ttftMs {
                chips.append(.init(icon: "timer", text: "\(formatDuration(ttft)) ttft"))
                chips.append(.init(icon: "clock", text: "\(formatDuration(latency)) total"))
            } else {
                chips.append(.init(icon: "clock", text: formatDuration(latency)))
            }
        }

        let toolDurations = message.toolCalls.compactMap(\.durationMs)
        if !toolDurations.isEmpty {
            let total = toolDurations.reduce(0, +)
            chips.append(.init(icon: "wrench.and.screwdriver", text: "tools \(formatDuration(total))"))
        }

        if let usage = message.usage {
            let totalTokens = usage.inputTokens + usage.outputTokens
            chips.append(.init(icon: "textformat.123", text: "\(totalTokens.formatted()) tok"))

            if let cache = usage.voiceCache {
                let hits = max(0, cache.cacheHits ?? 0)
                let misses = max(0, cache.cacheMisses ?? 0)
                let segments = max(cache.segments ?? (hits + misses), hits + misses)
                if segments > 0 {
                    let computedRate = Int((Double(hits) / Double(segments) * 100.0).rounded())
                    let explicitRate = cache.hitRate.map { value -> Int in
                        if value > 1 {
                            return Int(value.rounded())
                        }
                        return Int((value * 100.0).rounded())
                    }
                    let rate = explicitRate ?? computedRate
                    chips.append(.init(icon: "internaldrive", text: "cache \(rate)% (\(hits)/\(segments))"))
                }
            }
        }

        if let cost = message.costUsd {
            let value = cost >= 0.01 ? String(format: "$%.3f", cost) : String(format: "$%.4f", cost)
            chips.append(.init(icon: "dollarsign.circle", text: value))
        }

        if let provider = message.provider, !provider.isEmpty {
            chips.append(.init(icon: "network", text: provider))
        }

        if let model = message.model, !model.isEmpty {
            chips.append(.init(icon: "cpu", text: shortModelName(model)))
        }

        if let toolModel = message.toolModel, !toolModel.isEmpty {
            chips.append(.init(icon: "hammer", text: shortModelName(toolModel)))
        }

        return chips.isEmpty ? nil : chips
    }

    private var streamingFiller: String {
        let pending = message.toolCalls.first(where: { $0.result == nil && !$0.isError })
        guard let name = pending?.name.lowercased() else {
            return "Working on that now..."
        }
        if name.contains("calendar") || name.contains("event") || name.contains("schedule") {
            return "Checking your calendar now..."
        }
        if name.contains("gmail") || name.contains("email") || name.contains("inbox") {
            return "Checking your inbox now..."
        }
        if name.contains("weather") || name.contains("forecast") {
            return "Checking the weather now..."
        }
        if name.contains("contact") || name.contains("people") {
            return "Looking up that contact now..."
        }
        if name.contains("task") || name.contains("todo") {
            return "Checking your task list now..."
        }
        return "Working on that now..."
    }

    private var parsedMarkdownContent: AttributedString {
        guard !message.content.isEmpty else {
            return AttributedString("")
        }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        if let parsed = try? AttributedString(markdown: message.content, options: options) {
            return parsed
        }
        return AttributedString(message.content)
    }

    private var messageBodyFont: Font {
        #if os(iOS)
        return JOITypography.bodyLarge
        #else
        return JOITypography.bodyMedium
        #endif
    }

    private var firstLinkURL: URL? {
        guard !message.content.isEmpty else { return nil }
        let source = message.content as NSString
        let range = NSRange(location: 0, length: source.length)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let match = detector.firstMatch(in: message.content, options: [], range: range)
        guard let url = match?.url else { return nil }
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        return url
    }

    private func shortModelName(_ model: String) -> String {
        model
            .replacingOccurrences(of: "anthropic/", with: "")
            .replacingOccurrences(of: "openai/", with: "")
            .replacingOccurrences(of: "openrouter/", with: "")
            .replacingOccurrences(of: "claude-", with: "")
            .replacingOccurrences(of: "gpt-", with: "")
    }

    private func formatDuration(_ milliseconds: Int) -> String {
        if milliseconds < 1000 {
            return "\(milliseconds)ms"
        }
        return String(format: "%.1fs", Double(milliseconds) / 1000.0)
    }

    private var timestampLabel: String {
        Self.timestampFormatter.string(from: message.createdAt)
    }

    private func copyMessageTextToClipboard() {
        #if os(iOS)
        UIPasteboard.general.string = message.content
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(message.content, forType: .string)
        #endif
    }

    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
}

private struct MessageLinkPreview: View {
    let url: URL
    @State private var preview: LinkPreviewModel?
    @State private var attempted = false

    var body: some View {
        Group {
            if let preview {
                Button {
                    openLink(url)
                } label: {
                    HStack(spacing: 10) {
                        if let imageURL = preview.imageURL {
                            AsyncImage(url: imageURL) { image in
                                image
                                    .resizable()
                                    .scaledToFill()
                            } placeholder: {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(JOIColors.surfaceVariant.opacity(0.5))
                            }
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }

                        VStack(alignment: .leading, spacing: 3) {
                            if let site = preview.siteName, !site.isEmpty {
                                Text(site)
                                    .font(JOITypography.labelSmall)
                                    .foregroundStyle(JOIColors.textSecondary)
                                    .lineLimit(1)
                            }
                            Text(preview.title)
                                .font(JOITypography.bodySmall)
                                .foregroundStyle(JOIColors.textPrimary)
                                .lineLimit(1)
                            if let description = preview.description, !description.isEmpty {
                                Text(description)
                                    .font(JOITypography.labelSmall)
                                    .foregroundStyle(JOIColors.textSecondary)
                                    .lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(8)
                    .background(JOIColors.surfaceVariant.opacity(0.52))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(JOIColors.border.opacity(0.6), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: url.absoluteString) {
            await fetchPreviewIfNeeded()
        }
    }

    private func fetchPreviewIfNeeded() async {
        if attempted { return }
        attempted = true

        let gatewayWSURL = GatewayURLResolver.configuredGatewayURL()
        let baseURL = gatewayWSURL
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")
        guard let endpoint = URL(string: "\(baseURL)/api/chat/link-preview?url=\(url.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") else {
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: endpoint)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            let decoded = try JSONDecoder().decode(LinkPreviewModel.self, from: data)
            preview = decoded
        } catch {
            // keep preview fetch best-effort
        }
    }

    private func openLink(_ url: URL) {
        #if os(iOS)
        UIApplication.shared.open(url)
        #elseif os(macOS)
        NSWorkspace.shared.open(url)
        #endif
    }
}

private struct LinkPreviewModel: Decodable {
    let url: String
    let title: String
    let description: String?
    let imageUrl: String?
    let siteName: String?

    var imageURL: URL? {
        guard let imageUrl else { return nil }
        return URL(string: imageUrl)
    }
}

private struct MetaChipModel: Identifiable {
    let id = UUID()
    let icon: String
    let text: String
}

private struct MetaChip: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
            Text(text)
                .font(JOITypography.labelSmall)
                .lineLimit(1)
        }
        .foregroundStyle(JOIColors.textSecondary)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(JOIColors.surfaceVariant.opacity(0.7))
        .clipShape(Capsule())
    }
}

private struct MessageContextChip: View {
    let icon: String
    let text: String
    var accent: Color = JOIColors.textSecondary.opacity(0.85)

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
            Text(text)
                .font(JOITypography.labelSmall)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(accent)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(JOIColors.surfaceVariant.opacity(0.55))
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .stroke(accent.opacity(0.18), lineWidth: 0.8)
        )
    }
}

private struct ElapsedChip: View {
    let startedAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { timeline in
            let ms = max(0, Int(timeline.date.timeIntervalSince(startedAt) * 1000.0))
            Text(ms < 1000 ? "\(ms)ms" : String(format: "%.1fs", Double(ms) / 1000.0))
                .font(JOITypography.labelSmall)
                .foregroundStyle(JOIColors.textSecondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(JOIColors.surfaceVariant.opacity(0.72))
                .clipShape(Capsule())
        }
    }
}

private struct ToolBadge: View {
    let toolCall: ChatUIToolCall

    private var isPending: Bool { toolCall.result == nil && !toolCall.isError }
    private var sourceDescriptor: SourceChipDescriptor {
        SourceChipCatalog.descriptor(forToolName: toolCall.name, isActive: isPending)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { timeline in
            let durationMs = toolCall.durationMs ?? liveDurationMs(now: timeline.date)

            HStack(spacing: 6) {
                SourceFaviconDot(descriptor: sourceDescriptor, size: 14)

                Text(formatToolName(toolCall.name))
                    .font(JOITypography.labelSmall)
                    .foregroundStyle(JOIColors.textPrimary)
                    .lineLimit(1)

                if let durationMs {
                    Text(durationMs < 1000
                         ? "\(durationMs)ms"
                         : String(format: "%.1fs", Double(durationMs) / 1000.0))
                        .font(JOITypography.labelSmall)
                        .foregroundStyle(JOIColors.textSecondary)
                }

                if isPending {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.mini)
                        .tint(JOIColors.primary.opacity(0.85))
                } else {
                    Image(systemName: statusIcon)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(statusColor)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(statusBackground)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(statusColor.opacity(0.34), lineWidth: 1))
        }
    }

    private var statusIcon: String {
        if toolCall.isError { return "xmark.circle.fill" }
        if isPending { return "clock.fill" }
        return "checkmark.circle.fill"
    }

    private var statusColor: Color {
        if toolCall.isError { return JOIColors.error }
        if isPending { return JOIColors.primary }
        return JOIColors.success
    }

    private var statusBackground: Color {
        if toolCall.isError { return JOIColors.error.opacity(0.14) }
        if isPending { return JOIColors.primary.opacity(0.1) }
        return JOIColors.success.opacity(0.13)
    }

    private func liveDurationMs(now: Date) -> Int? {
        guard isPending, let startedAt = toolCall.startedAt else { return nil }
        return max(0, Int(now.timeIntervalSince(startedAt) * 1000.0))
    }

    private func formatToolName(_ name: String) -> String {
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "contacts_search" {
            return "Contact Search"
        }
        return normalized
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}

private struct ToolChecklistView: View {
    let toolCalls: [ChatUIToolCall]
    let plannedSteps: [String]

    private struct ChecklistItem: Identifiable {
        enum Status {
            case pending
            case done
            case error
        }

        let id: String
        let title: String
        let status: Status
        let durationMs: Int?
    }

    var body: some View {
        let items = checklistItems()
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                Text(checklistTitle(items))
                    .font(JOITypography.labelSmall)
                    .foregroundStyle(JOIColors.textSecondary)

                ForEach(items) { item in
                    HStack(spacing: 7) {
                        Circle()
                            .fill(statusColor(item.status))
                            .frame(width: 7, height: 7)

                        Text(item.title)
                            .font(JOITypography.bodySmall)
                            .foregroundStyle(JOIColors.textPrimary)
                            .lineLimit(1)

                        Spacer(minLength: 6)

                        if let durationMs = item.durationMs {
                            Text(durationMs < 1000
                                 ? "\(durationMs)ms"
                                 : String(format: "%.1fs", Double(durationMs) / 1000.0))
                                .font(JOITypography.labelSmall)
                                .foregroundStyle(JOIColors.textSecondary)
                        }
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(JOIColors.surfaceVariant.opacity(0.46))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func checklistItems() -> [ChecklistItem] {
        let normalizedPlan = plannedSteps
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let total = max(normalizedPlan.count, toolCalls.count)
        guard total > 0 else { return [] }

        return (0..<total).map { index in
            let tool = index < toolCalls.count ? toolCalls[index] : nil
            let name = index < normalizedPlan.count ? normalizedPlan[index] : (tool.map { formatToolName($0.name) } ?? "Step \(index + 1)")

            if let tool {
                let status: ChecklistItem.Status = tool.isError
                    ? .error
                    : (tool.result == nil ? .pending : .done)
                return ChecklistItem(
                    id: tool.id,
                    title: name,
                    status: status,
                    durationMs: tool.durationMs)
            }
            return ChecklistItem(
                id: "plan-\(index)",
                title: name,
                status: .pending,
                durationMs: nil)
        }
    }

    private func checklistTitle(_ items: [ChecklistItem]) -> String {
        let pending = items.filter { $0.status == .pending }.count
        let failed = items.filter { $0.status == .error }.count
        if pending > 0 {
            return "Working checklist · \(pending) remaining"
        }
        if failed > 0 {
            return "Checklist finished · \(failed) failed"
        }
        return "Checklist complete"
    }

    private func statusColor(_ status: ChecklistItem.Status) -> Color {
        switch status {
        case .pending:
            return JOIColors.primary
        case .done:
            return JOIColors.success
        case .error:
            return JOIColors.error
        }
    }

    private func formatToolName(_ name: String) -> String {
        name
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}
