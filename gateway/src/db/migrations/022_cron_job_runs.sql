-- Cron job execution history
CREATE TABLE IF NOT EXISTS cron_job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  error TEXT,
  log TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job ON cron_job_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_started ON cron_job_runs(started_at DESC);

-- Re-insert deleted jobs (weekly-store-audit and weekly-skill-audit)
INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
   schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
VALUES ('store-auditor', 'weekly-store-audit', 'Weekly audit of the knowledge store for stale, duplicate, or low-quality entries',
   'cron', '0 10 * * 0', 'Europe/Vienna', 'isolated', 'agent_turn',
   'Audit the JOI knowledge store. Check for stale entries, duplicates, low-quality or orphaned items. Summarize findings and clean up where appropriate.', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
   schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
VALUES ('skill-scout', 'weekly-skill-audit', 'Weekly audit of skills and skill suggestions',
   'cron', '0 9 * * 1', 'Europe/Vienna', 'isolated', 'agent_turn',
   'Audit JOI and Claude Code skills. Check for outdated skills, missing capabilities, and suggest improvements or new skills based on recent usage patterns.', true)
ON CONFLICT (name) DO NOTHING;
