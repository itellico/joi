# Quality OS Redesign Proposal (Agent-First)

## Problem Summary
Current UX feels fragmented:
- Too many concepts at once (`cases`, `runs`, `issues`, `soul governance`, `insights`, `autodev`, `logs`)
- Weak relationship between pages
- Hard to answer simple questions fast:
  - Which agent is improving?
  - Which skill is regressing?
  - Which failures are already in AutoDev?
  - Which logs belong to this run?

## New Mental Model
One loop only:
1. Simulate
2. Review
3. Repair
4. Learn

This loop is centered on **agent + skill**, not on scattered screens.

## New Information Architecture
- `Quality OS (new /quality)`
  - Command Deck (default)
  - Simulate
  - Repairs
  - Learning
- Keep existing routes for power users, but behind `Advanced`:
  - Legacy suites/governance/insights views

## Core Entities
- Agent
- Skill
- Scenario (test case)
- Run
- Issue
- Repair task (AutoDev)
- Learning signal (trend over time)

## Cross-Page Relationships
- From scenario simulation -> create run
- From failed run -> create issue
- From issue -> create AutoDev repair task
- From repaired issue -> re-run verification scenario
- From verified runs -> update agent/skill trend

## What Changes in Existing Pages
### /quality
- Default to simple tabs: `Cases`, `Runs`, `Issues`
- Add one-click `Simulate` from every case
- Launch `/chat` with prefilled simulation params
- Add clear `Simple Workflow` header actions:
  - Open Chat Simulator
  - Open Logs

### /chat
- Accept deep-link params (`execution`, `latency`, `suiteId`, `prompt`, `autoSend`)
- Auto-enable QA capture
- Inline `Capture` and `Flag issue`

### /autodev
- Show direct linkbacks to issue/run/case
- Keep state simple: `Needs Repair`, `Running`, `Ready to Verify`

### /agents + /agent-social
- Add quality slices per agent:
  - tests run
  - pass rate trend
  - latency trend
  - open repairs by skill
- Social feed should post meaningful quality updates, not noise.

### /logs
- Primary mode should be context-filtered by selected run/issue.
- Keep raw global logs as secondary/advanced mode.

## UI Principles
- Apple-like clarity: fewer controls per screen, stronger hierarchy, more whitespace.
- Prefer progressive disclosure (`Advanced`) over showing everything.
- Keep status vocabulary minimal and consistent.
- Every list row should answer: what happened, why it matters, what next.

## Delivery Plan
1. Command Deck v1 in `/quality` (agent KPIs + simulate CTA)
2. Agent/skill trend model and API aggregation
3. Contextual logs panel bound to selected run
4. Unified repair lane linking quality <-> autodev
5. Agent social quality feed events

