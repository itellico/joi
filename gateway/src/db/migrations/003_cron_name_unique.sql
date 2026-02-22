-- Add UNIQUE constraint on cron_jobs.name for ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_jobs_name ON cron_jobs(name);

-- Add skills table for skill management
CREATE TABLE IF NOT EXISTS skills_registry (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  source      TEXT NOT NULL DEFAULT 'bundled',  -- bundled | custom | obsidian
  path        TEXT,                              -- file path for skill definition
  enabled     BOOLEAN NOT NULL DEFAULT true,
  agent_ids   TEXT[] DEFAULT '{}',              -- which agents can use this skill
  config      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed some default skills
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('current_datetime', 'Get current date, time, and timezone', 'bundled', true),
  ('knowledge_search', 'Search knowledge base and memories using hybrid BM25+vector search', 'bundled', true),
  ('memory_store', 'Store structured memories across 5 areas', 'bundled', true),
  ('memory_recall', 'Recall and search memories by natural language', 'bundled', true)
ON CONFLICT (name) DO NOTHING;

-- Add gateway_logs table for real-time log viewer
CREATE TABLE IF NOT EXISTS gateway_logs (
  id          BIGSERIAL PRIMARY KEY,
  level       TEXT NOT NULL DEFAULT 'info',     -- debug | info | warn | error
  source      TEXT NOT NULL DEFAULT 'gateway',  -- gateway | agent | cron | knowledge | obsidian | pty
  message     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateway_logs_created ON gateway_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_logs_level ON gateway_logs(level) WHERE level IN ('warn', 'error');
CREATE INDEX IF NOT EXISTS idx_gateway_logs_source ON gateway_logs(source);

-- Auto-prune logs older than 7 days (via cron or manual)
-- Will be called periodically
