import Testing
@testable import JOI

@Suite("WakeWordGate")
struct WakeWordGateTests {

    @Test("Matches wake word with timing gap")
    func matchWithGap() {
        let segments = [
            WakeWordSegment(text: "hey", start: 0.0, duration: 0.3),
            WakeWordSegment(text: "joi", start: 0.3, duration: 0.3),
            WakeWordSegment(text: "what", start: 1.2, duration: 0.2),
            WakeWordSegment(text: "time", start: 1.4, duration: 0.2),
            WakeWordSegment(text: "is", start: 1.6, duration: 0.1),
            WakeWordSegment(text: "it", start: 1.7, duration: 0.1),
        ]
        let transcript = "hey joi what time is it"
        let config = WakeWordGateConfig(triggers: ["hey joi"])
        let match = WakeWordGate.match(transcript: transcript, segments: segments, config: config)
        #expect(match != nil)
        #expect(match?.command == "what time is it")
    }

    @Test("No match without sufficient gap")
    func noMatchWithoutGap() {
        let segments = [
            WakeWordSegment(text: "hey", start: 0.0, duration: 0.3),
            WakeWordSegment(text: "joi", start: 0.3, duration: 0.3),
            WakeWordSegment(text: "what", start: 0.65, duration: 0.2),
        ]
        let transcript = "hey joi what"
        let config = WakeWordGateConfig(triggers: ["hey joi"], minPostTriggerGap: 0.45)
        let match = WakeWordGate.match(transcript: transcript, segments: segments, config: config)
        #expect(match == nil)
    }

    @Test("Text-only matching")
    func textOnlyMatch() {
        #expect(WakeWordGate.matchesTextOnly(text: "hey joi what is up", triggers: ["hey joi"]))
        #expect(!WakeWordGate.matchesTextOnly(text: "hello world", triggers: ["hey joi"]))
    }

    @Test("Strip wake word from text")
    func stripWake() {
        let result = WakeWordGate.stripWake(text: "hey joi what time is it", triggers: ["hey joi"])
        #expect(result == "what time is it")
    }
}
