import SwiftUI

struct MessageBubble: View {
    let message: ChatUIMessage

    private var isUser: Bool { message.role == "user" }
    private var isError: Bool { message.isError }

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
                messageContent

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
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 10)
            .background(backgroundColor)
            .clipShape(bubbleShape)
            .overlay(bubbleShape.stroke(borderColor, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 3)
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
            Text(message.content)
                .font(JOITypography.bodyMedium)
                .foregroundStyle(JOIColors.textPrimary)
                .lineSpacing(5)
                .multilineTextAlignment(.leading)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
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

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { timeline in
            let durationMs = toolCall.durationMs ?? liveDurationMs(now: timeline.date)

            HStack(spacing: 6) {
                Image(systemName: statusIcon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(statusColor)

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
                        .controlSize(.mini)
                        .tint(JOIColors.primary.opacity(0.85))
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
