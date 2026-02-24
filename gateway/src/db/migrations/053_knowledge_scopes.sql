-- Add scopes and visibility to memories and documents for efficient RAG filtering.
-- Scopes represent organizational contexts (companies, projects, personal).
-- Visibility controls access level (shared, private, restricted).

-- ─── memories table ───

ALTER TABLE memories ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT NULL;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'private', 'restricted'));

-- GIN index on scope for fast equality/IN lookups
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories (scope) WHERE scope IS NOT NULL;
-- Composite index: scope + area for scoped area queries
CREATE INDEX IF NOT EXISTS idx_memories_scope_area ON memories (scope, area) WHERE scope IS NOT NULL;
-- Visibility filter
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories (visibility) WHERE visibility <> 'shared';

-- ─── documents table ───

ALTER TABLE documents ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'private', 'restricted'));

CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents (scope) WHERE scope IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents (visibility) WHERE visibility <> 'shared';

-- ─── store_objects: scope is already in JSONB data, add a materialized column for indexing ───

ALTER TABLE store_objects ADD COLUMN IF NOT EXISTS scope TEXT
  GENERATED ALWAYS AS (NULLIF(BTRIM(data->>'scope'), '')) STORED;

-- GIN index for fast scope filtering on store_objects
CREATE INDEX IF NOT EXISTS idx_store_objects_scope ON store_objects (scope) WHERE scope IS NOT NULL;

-- ─── Backfill: memories with project_id get scope = project_id ───
UPDATE memories SET scope = project_id WHERE project_id IS NOT NULL AND scope IS NULL;
