# JOI Simulation Playbook

This setup lets you test agent behavior (including tool plans, latency, and failure handling) without polluting your live system.

## 1) Start Safe Simulation Mode

```bash
pnpm dev:sim
```

`dev:sim` applies:
- `JOI_DEFAULT_EXECUTION_MODE=shadow`
- `JOI_DISABLE_SCHEDULER=1`
- `JOI_DISABLE_CHANNEL_AUTOSTART=1`
- `JOI_DISABLE_CLOUD_SYNC=1`

Optional:
- Set `JOI_SHADOW_DATABASE_URL` to run against a separate Postgres database.
- Set `JOI_SIM_GATEWAY_PORT` if you want simulation on a different gateway port.

## 2) Run QA Suites with Profiles

Open `http://localhost:5173/quality`.

Use **Run Profile**:
- `shadow`: read-only tools execute, mutating tools are blocked/simulated.
- `dry_run`: all tool calls are simulated (no external actions).
- `live`: full real execution.

Use:
- **Latency Profile** (`none`, `light`, `realistic`, `stress`) to emulate chat delays.
- **Case Timeout (ms)** to prevent hung runs.
- **Keep QA conversations** only when you need forensic debugging.

## 3) Chat-Level Simulation (WebSocket/API)

`chat.send` now supports:
- `executionMode`: `"live" | "shadow" | "dry_run"`
- `latencyProfile`: `{ toolMinMs, toolMaxMs, responseMinMs, responseMaxMs, jitterMs }`

Example payload:

```json
{
  "type": "chat.send",
  "data": {
    "agentId": "personal",
    "content": "Create a follow-up task and send a message",
    "executionMode": "dry_run",
    "latencyProfile": {
      "toolMinMs": 200,
      "toolMaxMs": 900,
      "responseMinMs": 300,
      "responseMaxMs": 1200,
      "jitterMs": 120
    }
  }
}
```

## 4) What Is Logged for Audit

Each QA run stores its run profile in `qa_test_runs.model_config`, including:
- execution mode
- latency profile
- case timeout
- keep artifacts flag

This makes runs explainable and comparable later.

## 5) Recommended Workflow

1. Use `dry_run` to test orchestration and prompts safely.
2. Use `shadow` to validate read paths and tool selection.
3. Use `live` only on selected suites before production rollout.
