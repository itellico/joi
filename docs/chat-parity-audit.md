# JOI Chat Parity Audit (Web <-> Native)

Updated: 2026-02-22

## Goal
Keep iOS/macOS chat behavior aligned with web chat for metadata, tool visibility, and presentation polish.

## Implemented parity
- `chat.plan`, `chat.tool_use`, and `chat.tool_result` are now consumed natively.
- Assistant bubbles now support:
  - tool badges with running/completed/error state
  - checklist rows from planned steps + tool execution
  - metadata chips with icons for:
    - TTFT and total latency
    - tool duration
    - token usage
    - voice cache hit-rate
    - cost
    - provider/model
- History reconstruction now maps tool results back onto assistant tool calls (same pattern as web).
- Session history now includes `token_usage` in WebSocket `session.load`.
- Scroll indicators are hidden for chat/history and horizontal chip/tool strips.
- Input layout was re-centered and rebuilt to avoid off-center compose controls.
- Closed JOI widget now has animated pulse rings responsive to voice activity.

## Native settings/menu changes (macOS)
- Removed in-chat settings panel from menu popover.
- Settings now open as native macOS Settings window.
- Added sidebar-style settings sections (`General`, `Voice`, `LiveKit`, `Notifications`, `About`).
- Removed legacy voice mode from UI; settings enforce `LiveKit` as active engine.

## Source-of-truth mapping
- Web behavior reference:
  - `web/src/hooks/useChat.ts`
  - `web/src/components/AssistantChat.tsx`
- Native behavior reference:
  - `app/JOI/Core/Network/FrameProtocol.swift`
  - `app/JOI/Core/Network/FrameRouter.swift`
  - `app/JOI/Features/Chat/ChatViewModel.swift`
  - `app/JOI/Features/Chat/MessageBubble.swift`

## Build validation
- iOS: `xcodebuild -project app/JOI.xcodeproj -scheme JOI_iOS -destination 'generic/platform=iOS Simulator' build`
- macOS: `xcodebuild -project app/JOI.xcodeproj -scheme JOI_macOS -destination 'generic/platform=macOS' build`
- Result: both succeeded.
