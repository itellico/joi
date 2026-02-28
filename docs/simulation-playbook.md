# JOI Simulation Playbook

## Simple QA Loop
1. Open `/quality` and click `Simulate` on a case.
2. You are redirected to `/chat` with `shadow` mode + `realistic` latency + QA capture preconfigured.
3. Chat auto-captures assistant outputs into QA runs/results.
4. Flag bad responses inline in chat (`Flag issue`).
5. Review runs/issues in `/quality` and inspect service logs in `/logs`.

## Why this is simpler
- One chat runtime (`/chat`) is the simulation surface.
- `/quality` is the review and triage surface.
- Same shared chat simulation metadata is used across chat surfaces.

## Deep Link Format
`/chat` accepts simulation query params so test cases can launch directly:

- `qa=1`
- `qaAutoCapture=1`
- `execution=live|shadow|dry_run`
- `latency=none|light|realistic|stress`
- `suiteId=<qa-suite-id>`
- `caseId=<qa-case-id>`
- `caseName=<label>`
- `prompt=<input-message>`
- `autoSend=1`

Example:

```text
/chat?qa=1&qaAutoCapture=1&execution=shadow&latency=realistic&suiteId=...&caseId=...&caseName=Memory%20Recall&prompt=who%20is%20my%20son&autoSend=1
```

## Logs
- UI log viewer: `/logs`
- AutoDev live log: `GET /api/autodev/log`
- Structured logs: `GET /api/logs`
- Local files:
  - `/tmp/joi-autodev.log`
  - `/tmp/joi-watchdog.log`
  - `/tmp/joi-livekit.log`

## Safe Defaults
Simulation defaults are tuned for non-destructive QA:
- execution mode: `shadow`
- latency profile: `realistic`
- QA capture: `on`
- auto-capture: `on`

Use `live` only for intentional end-to-end validation with real side effects.
