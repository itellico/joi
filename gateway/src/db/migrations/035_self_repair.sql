-- Self-Repair system: health check runs table + seed cron job

-- Track self-repair run history
CREATE TABLE IF NOT EXISTS self_repair_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text NOT NULL DEFAULT 'healthy',  -- healthy | degraded | down
  services    jsonb NOT NULL DEFAULT '[]',
  log_issues  jsonb NOT NULL DEFAULT '[]',
  repairs     jsonb NOT NULL DEFAULT '[]',
  report      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_self_repair_runs_created ON self_repair_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_repair_runs_status ON self_repair_runs (status) WHERE status != 'healthy';

-- Seed the cron job: run every 5 minutes
INSERT INTO cron_jobs (
  agent_id, name, description, enabled,
  schedule_kind, schedule_cron_expr, schedule_cron_tz,
  session_target, payload_kind, payload_text,
  payload_timeout_seconds
) VALUES (
  'system', 'Self-Repair', 'Checks health of all JOI services, analyzes error logs, attempts auto-repair, and notifies via Telegram',
  true,
  'cron', '*/5 * * * *', 'America/New_York',
  'isolated', 'system_event', 'self_repair',
  120
) ON CONFLICT DO NOTHING;
