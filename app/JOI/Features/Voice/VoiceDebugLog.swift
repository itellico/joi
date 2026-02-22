import Foundation

/// Ring buffer of timestamped debug events for the voice pipeline.
/// Keeps the last N entries. Thread-safe via @MainActor.
@MainActor
final class VoiceDebugLog {
    struct Entry {
        let timestamp: Date
        let source: String
        let message: String
    }

    static let shared = VoiceDebugLog()

    private var entries: [Entry] = []
    private let maxEntries = 200
    private let startTime = Date()

    private init() {}

    func log(_ source: String, _ message: String) {
        let entry = Entry(timestamp: Date(), source: source, message: message)
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
    }

    func clear() {
        entries.removeAll()
    }

    /// Format all entries as a copyable string
    func formatted() -> String {
        let df = DateFormatter()
        df.dateFormat = "HH:mm:ss.SSS"

        var lines: [String] = []
        lines.append("=== JOI Voice Debug Log ===")
        lines.append("Captured: \(df.string(from: Date()))")
        lines.append("Entries: \(entries.count)")
        lines.append("")

        for entry in entries {
            let ts = df.string(from: entry.timestamp)
            let elapsed = String(format: "%+.1fs", entry.timestamp.timeIntervalSince(startTime))
            lines.append("[\(ts)] [\(elapsed)] [\(entry.source)] \(entry.message)")
        }

        return lines.joined(separator: "\n")
    }
}
