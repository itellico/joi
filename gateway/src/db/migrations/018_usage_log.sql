-- Usage tracking: records every LLM API call for statistics and cost tracking
CREATE TABLE IF NOT EXISTS usage_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,          -- 'anthropic', 'openrouter', 'ollama'
  model TEXT NOT NULL,             -- e.g. 'claude-sonnet-4-20250514', 'qwen3.5:cloud'
  task TEXT NOT NULL,              -- 'chat', 'utility', 'embedding'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 8) DEFAULT 0,  -- estimated cost in USD
  conversation_id UUID,            -- NULL for utility/embedding calls
  agent_id TEXT,                   -- which agent made the call
  latency_ms INTEGER,             -- response time
  error BOOLEAN DEFAULT FALSE      -- whether the call failed
);

-- Indexes for fast queries
CREATE INDEX idx_usage_log_created ON usage_log (created_at DESC);
CREATE INDEX idx_usage_log_provider ON usage_log (provider);
CREATE INDEX idx_usage_log_model ON usage_log (model);
CREATE INDEX idx_usage_log_task ON usage_log (task);
CREATE INDEX idx_usage_log_conversation ON usage_log (conversation_id) WHERE conversation_id IS NOT NULL;

-- Daily aggregation view for dashboard charts
CREATE OR REPLACE VIEW usage_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  provider,
  model,
  task,
  COUNT(*) AS call_count,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(input_tokens + output_tokens) AS total_tokens,
  SUM(cost_usd) AS total_cost,
  AVG(latency_ms)::integer AS avg_latency_ms
FROM usage_log
WHERE NOT error
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;
