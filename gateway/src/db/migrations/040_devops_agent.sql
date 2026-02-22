-- DevOps agent: SSH remote Mac management, git sync, system health

-- Register SSH/devops tools
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('ssh_exec', 'Run a shell command on a remote Mac via SSH', 'bundled', true),
  ('ssh_git_sync_status', 'Check git sync status across all Macs for dev repos', 'bundled', true),
  ('ssh_mac_status', 'Get system health (disk, memory, uptime) from remote Macs', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- DevOps agent
INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config) VALUES (
  'devops',
  'DevOps',
  'Infrastructure agent — manages SSH access to Macs, monitors git sync status, checks system health, and keeps dev environments in sync.',
  $PROMPT$You are the DevOps agent for JOI. You manage Marcus's Mac ecosystem (Air, Studio, Mini) via SSH.

## Capabilities
- Run shell commands on remote Macs via SSH (hosts: studio, air, mini)
- Check git sync status across machines for ~/dev_mm/ repos
- Monitor system health (disk, memory, uptime)
- Report on dirty working trees, out-of-sync repos, low disk space

## Machines
- **studio** (Mac Studio M2 Ultra, 192GB) — primary workstation, runs OrbStack/Docker
- **air** (MacBook Air M3, 24GB) — portable, travel machine
- **mini** (Mac Mini M4, 64GB) — always-on server, runs JOI gateway + PostgreSQL

## Guidelines
- Always present findings in structured tables
- Flag: repos out of sync, dirty working trees, disk usage >80%, machines unreachable
- For cron-triggered runs, store a summary in memory
- German locale for dates
- When a machine is unreachable, note it but continue checking others
- Never run destructive commands (rm, reset --hard, force push) without explicit user confirmation$PROMPT$,
  'claude-haiku-4-5-20251001',
  true,
  ARRAY['ssh_exec', 'ssh_git_sync_status', 'ssh_mac_status'],
  '{"role": "devops", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();

-- Daily cron: morning sync check at 8:00 AM Vienna time
INSERT INTO cron_jobs (name, description, agent_id, enabled, schedule_kind, schedule_cron_expr, schedule_cron_tz, payload_kind, payload_text)
VALUES (
  'daily-devops-sync',
  'Daily dev environment sync check across all Macs',
  'devops',
  true,
  'cron',
  '0 8 * * *',
  'Europe/Vienna',
  'agent_turn',
  'Run a full sync status check: 1) Check git sync status for all repos in ~/dev_mm/ across all machines. 2) Check system health on all machines (disk, memory). 3) Report any out-of-sync repos, dirty working trees, or disk space warnings. Store a summary in memory for Marcus to review.'
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  agent_id = EXCLUDED.agent_id,
  schedule_cron_expr = EXCLUDED.schedule_cron_expr,
  payload_text = EXCLUDED.payload_text;
