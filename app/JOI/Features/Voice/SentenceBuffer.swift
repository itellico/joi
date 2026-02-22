import Foundation

/// Accumulates streamed text tokens and emits complete sentences.
/// Splits on `.` `!` `?` followed by whitespace/end, and on `\n\n`.
/// Strips emotion tags like `[happy]` before emitting, exposing the last detected emotion.
@MainActor
final class SentenceBuffer {
    private var buffer = ""
    private(set) var currentEmotion: String?
    private(set) var sentenceCount = 0

    var onSentence: ((String) -> Void)?

    /// Abbreviations to skip when detecting sentence boundaries
    private static let abbreviations: Set<String> = [
        "mr", "mrs", "ms", "dr", "prof", "sr", "jr",
        "st", "ave", "blvd", "etc", "vs", "approx",
        "inc", "ltd", "co", "corp", "dept",
        "e.g", "i.e", "fig", "vol", "no",
    ]

    /// Emotion tag pattern: `[happy]`, `[thinking]`, `[surprised]`, etc.
    /// Returns `nil` on initialization failure to avoid crash at startup.
    private static let emotionPattern: NSRegularExpression? = {
        do {
            return try NSRegularExpression(pattern: #"\[(\w+)\]"#, options: [])
        } catch {
            assertionFailure("Failed to build emotion regex: \(error)")
            return nil
        }
    }()

    func append(_ delta: String) {
        buffer += delta
        emitCompleteSentences()
    }

    /// Force-emit whatever is left in the buffer (call on stream end).
    func flush() -> String? {
        let remaining = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        buffer = ""
        guard !remaining.isEmpty else { return nil }
        let (text, emotion) = Self.stripEmotionTags(remaining)
        if let emotion { currentEmotion = emotion }
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        onSentence?(cleaned)
        return cleaned
    }

    func reset() {
        buffer = ""
        currentEmotion = nil
        sentenceCount = 0
    }

    // MARK: - Private

    private func emitCompleteSentences() {
        while true {
            // Check for paragraph break (\n\n)
            if let range = buffer.range(of: "\n\n") {
                let sentence = String(buffer[buffer.startIndex..<range.lowerBound])
                buffer = String(buffer[range.upperBound...])
                emit(sentence)
                continue
            }

            // Check for sentence-ending punctuation followed by space or end
            if let splitIndex = findSentenceBoundary() {
                let sentence = String(buffer[buffer.startIndex...splitIndex])
                let nextIndex = buffer.index(after: splitIndex)
                buffer = nextIndex < buffer.endIndex ? String(buffer[nextIndex...]) : ""
                // Trim leading whitespace from remaining buffer
                buffer = String(buffer.drop(while: { $0 == " " }))
                emit(sentence)
                continue
            }

            break
        }
    }

    /// Find the index of a sentence-ending punctuation mark that's followed by
    /// whitespace (indicating a true sentence boundary, not an abbreviation).
    private func findSentenceBoundary() -> String.Index? {
        let chars = Array(buffer)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch == "." || ch == "!" || ch == "?" {
                // Must be followed by whitespace or end-of-buffer-with-more-content
                let nextIdx = i + 1
                if nextIdx < chars.count {
                    let next = chars[nextIdx]
                    if next == " " || next == "\n" || next == "\t" {
                        // Check for abbreviation (only for `.`)
                        if ch == "." && isAbbreviation(at: i, in: chars) {
                            i += 1
                            continue
                        }
                        return buffer.index(buffer.startIndex, offsetBy: i)
                    }
                }
                // At end of buffer — don't split yet, more tokens may come
            }
            i += 1
        }
        return nil
    }

    private func isAbbreviation(at dotIndex: Int, in chars: [Character]) -> Bool {
        // Walk backwards from the dot to find the word
        var wordStart = dotIndex - 1
        while wordStart >= 0 && chars[wordStart].isLetter {
            wordStart -= 1
        }
        wordStart += 1

        if wordStart >= dotIndex { return false }
        let word = String(chars[wordStart..<dotIndex]).lowercased()

        // Check with and without trailing dot for abbreviations like "e.g"
        return Self.abbreviations.contains(word) || Self.abbreviations.contains(word + ".")
    }

    private func emit(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let (text, emotion) = Self.stripEmotionTags(trimmed)
        if let emotion { currentEmotion = emotion }
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        sentenceCount += 1
        onSentence?(cleaned)
    }

    /// Strip emotion tags like `[happy]` from text, returning cleaned text and last emotion found.
    static func stripEmotionTags(_ text: String) -> (text: String, emotion: String?) {
        guard let emotionPattern else { return (text, nil) }
        let nsText = text as NSString
        let matches = emotionPattern.matches(in: text, range: NSRange(location: 0, length: nsText.length))

        guard !matches.isEmpty else { return (text, nil) }

        var lastEmotion: String?
        var cleaned = text
        // Process matches in reverse to preserve indices
        for match in matches.reversed() {
            if match.numberOfRanges >= 2 {
                let emotionRange = match.range(at: 1)
                lastEmotion = lastEmotion ?? nsText.substring(with: emotionRange).lowercased()
            }
            if let range = Range(match.range, in: cleaned) {
                cleaned.removeSubrange(range)
            }
        }

        return (cleaned, lastEmotion)
    }
}
