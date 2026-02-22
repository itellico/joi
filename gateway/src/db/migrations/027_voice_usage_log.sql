-- Voice usage tracking (future)
-- Tracks costs for DeepGram (STT) and Cartesia (TTS) calls

CREATE TABLE IF NOT EXISTS voice_usage_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,            -- 'deepgram', 'cartesia'
  service TEXT NOT NULL,             -- 'stt', 'tts'
  model TEXT,                        -- e.g. 'nova-2', 'sonic-english'
  duration_ms INTEGER NOT NULL DEFAULT 0,
  characters INTEGER NOT NULL DEFAULT 0,  -- for TTS
  cost_usd NUMERIC(12, 8) DEFAULT 0,
  conversation_id UUID,
  agent_id TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_voice_usage_created ON voice_usage_log(created_at);
CREATE INDEX idx_voice_usage_provider ON voice_usage_log(provider);
