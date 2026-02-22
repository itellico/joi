-- JOI Initial Schema
-- Requires: pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT DEFAULT 'personal',
  channel_id TEXT,
  session_key TEXT UNIQUE,
  title TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_agent ON conversations(agent_id);
CREATE INDEX idx_conversations_channel ON conversations(channel_id);
CREATE INDEX idx_conversations_session ON conversations(session_key);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_calls JSONB,
  tool_results JSONB,
  model TEXT,
  token_usage JSONB,
  channel_id TEXT,
  sender_id TEXT,
  attachments JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Documents (for RAG knowledge base)
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,  -- 'obsidian', 'file', 'web', 'manual'
  path TEXT,
  title TEXT,
  content TEXT,
  content_hash TEXT,
  metadata JSONB DEFAULT '{}',
  embedded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_documents_path ON documents(source, path) WHERE path IS NOT NULL;

-- Chunks (embedded document segments for vector search)
CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(768),  -- nomic-embed-text dimension
  chunk_index INT NOT NULL,
  start_line INT,
  end_line INT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity index (IVFFlat - good for < 1M vectors)
CREATE INDEX idx_chunks_embedding ON chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Full-text search index (BM25 via tsvector)
ALTER TABLE chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX idx_chunks_fts ON chunks USING gin(fts);

CREATE INDEX idx_chunks_document ON chunks(document_id);

-- Skills registry
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'custom',  -- 'bundled', 'custom'
  platform TEXT[],  -- ['darwin', 'linux'] or null for all
  requires_bins TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cron jobs (scheduled tasks)
CREATE TABLE cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT DEFAULT 'personal',
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  delete_after_run BOOLEAN DEFAULT false,

  -- Schedule: one of at/every/cron
  schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('at', 'every', 'cron')),
  schedule_at TIMESTAMPTZ,           -- for 'at' jobs
  schedule_every_ms BIGINT,          -- for 'every' jobs
  schedule_cron_expr TEXT,           -- for 'cron' jobs
  schedule_cron_tz TEXT,             -- timezone for cron

  -- Execution
  session_target TEXT DEFAULT 'isolated' CHECK (session_target IN ('main', 'isolated')),
  payload_kind TEXT NOT NULL CHECK (payload_kind IN ('system_event', 'agent_turn')),
  payload_text TEXT NOT NULL,
  payload_model TEXT,
  payload_timeout_seconds INT DEFAULT 600,

  -- State
  next_run_at TIMESTAMPTZ,
  running_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('ok', 'error', 'skipped')),
  last_error TEXT,
  last_duration_ms INT,
  consecutive_errors INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = true;

-- Agent memory (persistent key-value for facts the agent learns)
CREATE TABLE agent_memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  agent_id TEXT DEFAULT 'personal',
  confidence FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_memory_category ON agent_memory(category);

-- Channel configs
CREATE TABLE channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL,  -- 'whatsapp', 'imessage', 'telegram', etc.
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'disconnected',
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents config (different agent profiles)
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  fallback_model TEXT,
  skills TEXT[],
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default personal assistant agent
INSERT INTO agents (id, name, description, system_prompt, model) VALUES (
  'personal',
  'JOI',
  'Personal AI assistant - handles everyday chat, tasks, reminders, and daily operations',
  'You are JOI, a personal AI assistant for Marcus. You are helpful, concise, and proactive. You help with daily tasks, reminders, research, and keep track of goals and projects. You have access to tools for managing tasks, searching knowledge, and interacting with external services.',
  'claude-sonnet-4-20250514'
);
