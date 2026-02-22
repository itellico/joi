# JOI Watch Connectivity Audit (February 22, 2026)

## Scope

- iPhone app target: `JOI_iOS`
- Watch targets: `JOI_watchOS`, `JOI_watchOS Extension`
- Bridge layer: `WatchConnectivity` command + status sync
- Voice controls covered: start, stop, tap-to-talk, press-and-hold talk, mute/unmute

## What Was Verified

1. **Target wiring**
- iOS target embeds watch app.
- Watch app depends on watch extension.
- Shared protocol models are compiled into watch extension and iOS app.

2. **Foreground delivery path**
- Watch sends commands with `sendMessage` when reachable.
- iPhone executes command and replies with status snapshot.

3. **Background / non-reachable delivery path**
- Watch falls back to `transferUserInfo` for commands.
- iPhone publishes latest status via `updateApplicationContext`.
- Watch consumes `applicationContext` for eventual state refresh.

4. **Voice state propagation**
- iPhone publishes status on state/status/mute/error/transcript changes.
- iPhone bridge now observes `VoiceEngine` directly, so status sync continues even when the chat panel is closed.
- Watch UI renders current status and live transcript snippets.

## Findings

1. **Medium: SwiftPM resolver instability in CLI build path**
- Runtimes are installed (`iOS 26.2`, `watchOS 26.2`) and visible via `simctl`.
- `xcodebuild` intermittently stalls/fails in `Resolve Package Graph` while recreating `swift-protobuf` submodules.
- Impact: automated CLI simulator build validation remains blocked in this environment.
- Mitigations attempted:
  - serialized `xcodebuild` (no parallel calls),
  - clean/moved JOI `DerivedData`,
  - repaired `swift-protobuf` submodule gitdirs manually,
  - local git URL rewrites for `abseil` and `protobuf`,
  - `protocol.file.allow=always`.
- Next action: open `app/JOI.xcodeproj` in Xcode once and let Xcode complete package resolution; then re-run CLI checks.

2. **Low: Command execution can be delayed when watch is not reachable**
- Non-reachable mode intentionally queues via `transferUserInfo`.
- Impact: watch actions are eventual, not immediate.
- Mitigations implemented:
  - UI shows `Live` vs `Queued` state.
  - Reachable-path send failures now fall back to `transferUserInfo` to reduce dropped commands during transient connectivity races.

3. **Low: Live transcript is intentionally clipped**
- Transcript payload is clipped before sending to avoid oversized context payloads.
- Impact: watch transcript may show only latest snippet, not full text.
- Mitigation implemented: clipping with latest-state semantics.

## Manual QA Checklist

1. Launch `JOI_iOS` and `JOI_watchOS` in paired simulators.
2. Confirm watch indicator is `Live` when iPhone app is active.
3. Hold watch talk surface:
- press start should start/tap voice path,
- release should restore mute state when it was muted before hold.
4. Toggle mute/unmute from watch and verify iPhone voice state changes.
5. Switch iPhone app to background, issue watch command, verify eventual execution when connectivity resumes.
