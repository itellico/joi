# Voice + Road Mode Audit (2026-02-25)

## Scope
- Web voice connection failures (`Failed to fetch`, no mic/session)
- LiveKit URL resolution across home LAN vs road/Tailscale
- Runtime config precedence and restart behavior
- Deployment path (`https://joi.itellico.org`) vs private LiveKit transport

## Evidence Collected
- Runtime health and dependency audit:
  - `./scripts/service-audit.sh`
- Active gateway responses:
  - `GET http://127.0.0.1:3100/api/livekit/config`
  - `POST http://127.0.0.1:3100/api/livekit/token`
- Road mode script status:
  - `./scripts/road-mode-hosts.sh status`
- Reachability probes:
  - `nc mini 7880`, `nc 192.168.178.58 7880`, `nc 100.84.151.74 7880`
- Config/source audit:
  - `.env`, `~/.joi/config.json`, `gateway/src/config/loader.ts`, `gateway/src/server.ts`, `infra/tunnel/config.yml`

## Findings (ordered by severity)

### 1) Critical: Active runtime uses `ws://localhost:7880` even though LiveKit is on mini
- `.env` sets `LIVEKIT_URL=ws://localhost:7880` and Redis localhost:
  - [/Users/mm2/dev_mm/joi/.env:31](/Users/mm2/dev_mm/joi/.env:31)
  - [/Users/mm2/dev_mm/joi/.env:37](/Users/mm2/dev_mm/joi/.env:37)
- Gateway currently serves that exact URL:
  - `GET /api/livekit/config` => `{"url":"ws://localhost:7880"}`
  - `POST /api/livekit/token` => `{"serverUrl":"ws://localhost:7880"}`
- Audit script confirms localhost is wrong for this machine:
  - `livekit server UNREACHABLE (localhost:7880)`
- But mini is reachable on all relevant paths:
  - `mini:7880`, `192.168.178.58:7880`, `100.84.151.74:7880` all reachable.

Impact:
- Browser tries to connect voice to wrong endpoint and fails (`Failed to fetch`).

### 2) Critical: HTTPS deployment has no public LiveKit ingress
- Cloudflare tunnel only exposes gateway on 3100:
  - [/Users/mm2/dev_mm/joi/infra/tunnel/config.yml:14](/Users/mm2/dev_mm/joi/infra/tunnel/config.yml:14)
- No ingress for LiveKit port/host.
- If UI is loaded over HTTPS, browser cannot use insecure `ws://...` endpoints.

Impact:
- Voice from `https://joi.itellico.org` cannot work unless LiveKit is exposed as `wss://...`.

### 3) High: Config precedence guarantees `.env` overrides saved settings on restart
- `dotenv.config(..., override: true)`:
  - [/Users/mm2/dev_mm/joi/gateway/src/config/loader.ts:19](/Users/mm2/dev_mm/joi/gateway/src/config/loader.ts:19)
- LiveKit URL is always overwritten by env if present:
  - [/Users/mm2/dev_mm/joi/gateway/src/config/loader.ts:93](/Users/mm2/dev_mm/joi/gateway/src/config/loader.ts:93)
- `~/.joi/config.json` currently contains non-local LiveKit URL, but runtime still serves localhost because `.env` wins.

Impact:
- UI-configured LiveKit URL appears to save, then silently reverts after restart.

### 4) High: Road-mode alias switching exists but is not effectively applied
- Road script exists and supports home/road/auto:
  - [/Users/mm2/dev_mm/joi/scripts/road-mode-hosts.sh:4](/Users/mm2/dev_mm/joi/scripts/road-mode-hosts.sh:4)
- Current status reports no explicit `/etc/hosts` mini mapping.
- `/etc/hosts` tail contains a malformed line (`... Demo Tenant192.168.178.58 mini`) so mini alias is embedded in comment text, not a valid host entry.

Impact:
- On Air + road/Tailscale, `mini` resolution may break unpredictably.

### 5) Medium: Multiple gateway watcher processes are running concurrently
- Multiple `tsx watch src/server.ts` parents running.
- Gateway log contains repeated `EADDRINUSE: 0.0.0.0:3100` entries.

Impact:
- Nondeterministic runtime behavior, noisy restarts, harder debugging.

### 6) Medium: `service-audit.sh` can misreport reality because it reads `.env`, not effective runtime config
- LiveKit host/port check sourced from `.env`:
  - [/Users/mm2/dev_mm/joi/scripts/service-audit.sh:78](/Users/mm2/dev_mm/joi/scripts/service-audit.sh:78)

Impact:
- Diagnostics may point to stale config and hide actual active values.

### 7) Medium: Recent URL rewrite logic can produce unreachable client URLs
- Current rewrite logic may transform URLs based on forwarded host/proto:
  - [/Users/mm2/dev_mm/joi/gateway/src/server.ts:928](/Users/mm2/dev_mm/joi/gateway/src/server.ts:928)
  - [/Users/mm2/dev_mm/joi/gateway/src/server.ts:1333](/Users/mm2/dev_mm/joi/gateway/src/server.ts:1333)
- Example simulation with forwarded HTTPS yielded `wss://joi.itellico.org:7880`, which is not exposed.

Impact:
- Can generate a syntactically valid but unreachable endpoint.

## Root Cause Summary
1. Wrong active LiveKit endpoint (`localhost`) for current machine role.
2. No secure/public LiveKit ingress for HTTPS web usage.
3. Config source-of-truth conflict (`.env` always overrides saved config).
4. Road-mode host alias not consistently enforced.

## Recommended Fix Order

### Immediate (today)
1. Set runtime endpoints to mini alias in `.env`:
- `LIVEKIT_URL=ws://mini:7880`
- `JOI_TTS_CACHE_REDIS_URL=redis://mini:6379/0`
2. Restart gateway + livekit worker cleanly (single instance).
3. Verify:
- `GET /api/livekit/config` returns `ws://mini:7880`
- `POST /api/livekit/token` returns `serverUrl=ws://mini:7880`

## Applied During This Audit
1. Switched local runtime env to mini-based endpoints:
- `LIVEKIT_URL=ws://mini:7880`
- `JOI_TTS_CACHE_REDIS_URL=redis://mini:6379/0`
2. Disabled implicit LiveKit URL rewrite by default (now opt-in via `JOI_LIVEKIT_URL_REWRITE=1`):
- [/Users/mm2/dev_mm/joi/gateway/src/server.ts:928](/Users/mm2/dev_mm/joi/gateway/src/server.ts:928)
3. Updated `scripts/service-audit.sh` to read effective runtime LiveKit/Redis URLs from `/api/livekit/config` before falling back to `.env`:
- [/Users/mm2/dev_mm/joi/scripts/service-audit.sh:76](/Users/mm2/dev_mm/joi/scripts/service-audit.sh:76)
4. Validated post-fix runtime:
- `GET /api/livekit/config` => `{\"url\":\"ws://mini:7880\"}`
- `POST /api/livekit/token` => `{\"serverUrl\":\"ws://mini:7880\"}`
- `service-audit.sh` now reports `livekit server REACHABLE (mini:7880)`

### Road mode hardening (today)
1. Fix `/etc/hosts` malformed tail and ensure valid `mini` line.
2. Use `./scripts/road-mode-hosts.sh auto --apply` when switching environments.
3. Add a launchd hook or login script to run `road-mode-hosts.sh auto --apply` on Air.

### HTTPS voice (required for cloud URL usage)
1. Expose LiveKit via public TLS endpoint (e.g. `livekit.itellico.org` -> mini:7880 through tunnel/proxy).
2. Set LiveKit URL for browser clients to `wss://livekit.itellico.org`.
3. Keep gateway public URL and LiveKit public URL explicitly separate.

### Config model cleanup (short-term code)
1. Decide precedence policy:
- Either `.env` is authoritative (then stop editing LiveKit URL in UI), or
- UI config is authoritative for mutable settings (and env only seeds defaults/secrets).
2. Implement and document one policy; current mixed behavior is error-prone.

## Verification Checklist (after fixes)
- `scripts/service-audit.sh` shows `livekit server REACHABLE` for effective runtime URL.
- Mic button transitions to `Connecting...` then `Listening...`.
- `POST /api/livekit/token` returns reachable `serverUrl` for current network mode.
- Voice works on:
  - Home LAN (Air -> mini)
  - Road/Tailscale (Air -> mini tailscale IP)
  - Optional HTTPS public path (if public LiveKit ingress configured).

## Hotfix Update (2026-02-25, later run)

### Applied
1. Road-mode client URL switching now works even when `JOI_LIVEKIT_URL_REWRITE` is disabled:
   - `/api/livekit/config` and `/api/livekit/token` now map `ws://mini:7880` to home/road IP using caller network + LAN interface inference.
   - File: [/Users/mm2/dev_mm/joi/gateway/src/server.ts](/Users/mm2/dev_mm/joi/gateway/src/server.ts)
2. Voice interruption responsiveness tuned in LiveKit worker:
   - Added `allow_interruptions`, lower `min_interruption_duration`, and false-interruption timeout tuning.
   - File: [/Users/mm2/dev_mm/joi/infra/livekit-worker/agent.py](/Users/mm2/dev_mm/joi/infra/livekit-worker/agent.py)
3. Mic silence recovery in web voice hook:
   - If first published mic track is silent, JOI republish attempts with system-default input automatically.
   - File: [/Users/mm2/dev_mm/joi/web/src/hooks/useVoiceSession.ts](/Users/mm2/dev_mm/joi/web/src/hooks/useVoiceSession.ts)
4. Person lookup behavior improved:
   - Voice tool intent now catches `who is ...` / `closest match`.
   - `contacts_search` now returns closest matches when exact name fails.
   - Files:
     - [/Users/mm2/dev_mm/joi/gateway/src/server.ts](/Users/mm2/dev_mm/joi/gateway/src/server.ts)
     - [/Users/mm2/dev_mm/joi/gateway/src/apple/contacts-tools.ts](/Users/mm2/dev_mm/joi/gateway/src/apple/contacts-tools.ts)
5. Emby person-query correctness:
   - Guard against Emby returning `TotalRecordCount=0` with non-empty items.
   - Clarified tool descriptions so LLM does not treat person search as library titles.
   - File: [/Users/mm2/dev_mm/joi/gateway/src/media/integration-tools.ts](/Users/mm2/dev_mm/joi/gateway/src/media/integration-tools.ts)

### Verified in this run
- Gateway type-check: pass.
- Web type-check: pass.
- Vitest: 90/90 passing.
- Sample closest-match query (`Robert Van Isaac`) now returns ranked contact candidates instead of hard failure.
