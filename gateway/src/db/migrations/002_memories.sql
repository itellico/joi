-- JOI Memory System
-- Replaces simple agent_memory with 5-area structured memory

-- Main memory store: unified table for all 5 areas
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification
  area TEXT NOT NULL CHECK (area IN (
    'identity', 'preferences', 'knowledge', 'solutions', 'episodes'
  )),

  -- Content
  content TEXT NOT NULL,
  summary TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Vector embedding (Ollama nomic-embed-text = 768 dimensions)
  embedding vector(768),

  -- Full-text search (populated via trigger)
  fts tsvector,

  -- Confidence & scoring
  confidence FLOAT NOT NULL DEFAULT 0.7
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  access_count INT DEFAULT 0,
  reinforcement_count INT DEFAULT 0,

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'inferred'
    CHECK (source IN ('user', 'inferred', 'solution_capture', 'episode', 'flush')),
  conversation_id UUID,
  channel_id TEXT,

  -- Project scoping (NULL = global)
  project_id TEXT,

  -- Lifecycle
  pinned BOOLEAN DEFAULT false,
  superseded_by UUID REFERENCES memories(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX memories_area_idx ON memories(area);
CREATE INDEX memories_project_idx ON memories(project_id);
CREATE INDEX memories_confidence_idx ON memories(confidence);
CREATE INDEX memories_created_idx ON memories(created_at DESC);
CREATE INDEX memories_fts_idx ON memories USING gin(fts);
CREATE INDEX memories_tags_idx ON memories USING gin(tags);
CREATE INDEX memories_embedding_idx ON memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Consolidation log (audit trail)
CREATE TABLE memory_consolidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('merge', 'update', 'delete', 'supersede')),
  source_memory_ids UUID[] NOT NULL,
  result_memory_id UUID REFERENCES memories(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-area search config (tunable weights)
CREATE TABLE memory_search_config (
  area TEXT PRIMARY KEY CHECK (area IN (
    'identity', 'preferences', 'knowledge', 'solutions', 'episodes'
  )),
  vector_weight FLOAT NOT NULL DEFAULT 0.5,
  text_weight FLOAT NOT NULL DEFAULT 0.5,
  temporal_decay_enabled BOOLEAN DEFAULT true,
  half_life_days INT,
  min_confidence FLOAT DEFAULT 0.3
);

-- Seed default search config per area
INSERT INTO memory_search_config VALUES
  ('identity',    0.3, 0.7, false, NULL, 0.1),
  ('preferences', 0.3, 0.7, true,  180,  0.2),
  ('knowledge',   0.6, 0.4, true,   60,  0.3),
  ('solutions',   0.8, 0.2, true,  120,  0.3),
  ('episodes',    0.4, 0.3, true,   14,  0.2);

-- Model routing config (stored in DB for settings UI)
CREATE TABLE model_routes (
  task TEXT PRIMARY KEY CHECK (task IN ('chat', 'utility', 'embedding')),
  model TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openrouter', 'ollama')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default model routes
INSERT INTO model_routes VALUES
  ('chat',      'claude-sonnet-4-20250514',           'anthropic',   NOW()),
  ('utility',   'anthropic/claude-haiku-3-20240307',  'openrouter',  NOW()),
  ('embedding', 'nomic-embed-text',                    'ollama',      NOW());

-- Settings store (key-value for UI-managed config)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-update FTS column on insert/update
CREATE OR REPLACE FUNCTION memories_fts_trigger() RETURNS trigger AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'A') ||
    setweight(to_tsvector('english', NEW.content), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_fts_update
  BEFORE INSERT OR UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_fts_trigger();

-- Migrate existing agent_memory data to memories table (if any exists)
INSERT INTO memories (area, content, summary, confidence, source, tags)
  SELECT
    CASE
      WHEN category = 'preferences' THEN 'preferences'
      WHEN category = 'facts' THEN 'knowledge'
      ELSE 'knowledge'
    END,
    value,
    key,
    confidence,
    'user',
    ARRAY[category]
  FROM agent_memory;
