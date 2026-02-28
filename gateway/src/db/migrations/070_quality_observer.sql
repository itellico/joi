-- ─── Quality Observer — Live Chat Analysis ───

-- Per-chat analysis results from the live observer
CREATE TABLE IF NOT EXISTS qa_chat_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      UUID,
  agent_id        TEXT,
  agent_name      TEXT,

  -- Captured content
  user_message      TEXT,
  assistant_content TEXT,
  tool_calls        JSONB DEFAULT '[]'::jsonb,
  tool_results      JSONB DEFAULT '[]'::jsonb,

  -- Scores (0.0 – 1.0)
  quality_score     REAL,
  correctness       REAL,
  tool_accuracy     REAL,
  response_quality  REAL,
  reasoning         TEXT,

  -- Detected issues
  issues_detected   JSONB DEFAULT '[]'::jsonb,

  -- Skills tracking
  skills_used       TEXT[] DEFAULT '{}',
  skills_expected   TEXT[] DEFAULT '{}',

  -- Metrics
  latency_ms        INT,
  cost_usd          REAL,
  analysis_cost_usd REAL,
  analysis_latency_ms INT,
  model             TEXT,
  provider          TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzing', 'completed', 'skipped', 'error')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_chat_analyses_conversation
  ON qa_chat_analyses (conversation_id);
CREATE INDEX IF NOT EXISTS idx_qa_chat_analyses_status
  ON qa_chat_analyses (status);
CREATE INDEX IF NOT EXISTS idx_qa_chat_analyses_created
  ON qa_chat_analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_chat_analyses_agent
  ON qa_chat_analyses (agent_id);
CREATE INDEX IF NOT EXISTS idx_qa_chat_analyses_quality
  ON qa_chat_analyses (quality_score);

-- Singleton config table for the observer
CREATE TABLE IF NOT EXISTS qa_observer_config (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled               BOOLEAN NOT NULL DEFAULT false,
  quality_threshold     REAL NOT NULL DEFAULT 0.4,
  skip_dry_run          BOOLEAN NOT NULL DEFAULT true,
  min_user_message_length INT NOT NULL DEFAULT 3,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default config row
INSERT INTO qa_observer_config (id) VALUES (1) ON CONFLICT DO NOTHING;
