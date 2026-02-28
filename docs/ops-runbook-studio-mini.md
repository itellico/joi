# JOI Studio + Mini Ops Runbook

This runbook standardizes daily development, deployment, and recovery across:
- `studio` (development runtime)
- `mini` (production/road runtime)

## Branch + Git Rules

- Single deployment branch: `main`
- Local/studio development happens on `main` with targeted commits.
- Deploy to mini by syncing `origin/main` with fast-forward pulls only.
- Never use `git reset --hard` on shared runtime machines.
- Never apply large stash contents directly to `main`.

## Standard Sync Workflow

From local or studio:

```bash
cd /Users/mm2/dev_mm/joi
./scripts/sync-main.sh --message "short change summary" --file path/to/file1 --file path/to/file2
```

What it does:
1. Creates a targeted commit (only passed `--file` paths).
2. Pulls `origin/main` with rebase/autostash.
3. Pushes to `origin/main`.
4. Pulls latest `main` on `studio` and `mini`.

Dry run:

```bash
./scripts/sync-main.sh --dry-run --message "test" --file scripts/service-audit.sh
```

## Runtime Health Checks

Use on each machine:

```bash
cd /Users/mm2/dev_mm/joi
./scripts/service-audit.sh
```

Expected:
- gateway reachable on `127.0.0.1:3100`
- `/health` reachable
- `/api/push/status` reachable
- watchdog, gateway, web, autodev, livekit processes running

## APNs Environment Contract

- `studio`: development APNs
  - `APNS_PRODUCTION=false`
  - `/api/push/status` -> `apnsTargetEnvironment=development`
- `mini`: production APNs
  - `APNS_PRODUCTION=true`
  - `/api/push/status` -> `apnsTargetEnvironment=production`

Both environments use:
- `APNS_BUNDLE_ID_DEVELOPMENT=com.joi.app.ios`
- `APNS_BUNDLE_ID_PRODUCTION=com.joi.app.ios`

## Push Token Validation

After app install/reinstall on real devices:

1. Open the app once in each target environment.
2. Confirm tokens re-register:
   - `/api/push/status` `registeredDevices > 0`
3. Send a test push from gateway and verify delivery.

If `registeredDevices=0`, server-side APNs setup can still be correct; the app must re-register a fresh device token.

## Safe Stash Recovery (Mini)

If mini has historical stash work:

```bash
ssh mini
cd /Users/mm2/dev_mm/joi
git switch -c recovery/mini-stash-review-YYYYMMDD main
git checkout stash@{0} -- $(git stash show --name-only --format='' stash@{0})
```

This recovers tracked code changes only. It intentionally excludes large untracked runtime artifacts (for example `.venv`, generated auth/session files).

Review and cherry-pick only required commits back to `main`.

## Hygiene

Runtime/generated folders are ignored in git:
- `app/.artifacts/`
- `app/.derived/`
- `JOIGateway.app/`
- `mobile/`
- `**/.venv/`

This keeps status clean and prevents accidental deployment of machine-local artifacts.
