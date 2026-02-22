-- Knowledge Store: flexible schema-less object database over JSONB + pgvector
-- Collections define "types", objects hold data, relations link objects

-- ─── Tables ───

CREATE TABLE store_collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT,                    -- emoji or icon name
  schema      JSONB NOT NULL,          -- field definitions [{name, type, required, options}]
  config      JSONB DEFAULT '{}',      -- display settings, default sort, etc.
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE store_objects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES store_collections(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}',
  tags          TEXT[] DEFAULT '{}',
  embedding     vector(768),
  fts           tsvector,
  status        TEXT DEFAULT 'active',           -- active | archived | deleted
  created_by    TEXT DEFAULT 'user',             -- user | agent:{agent_id} | cron:{job_name}
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE store_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID NOT NULL REFERENCES store_objects(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES store_objects(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL,           -- has_key_result, related_to, depends_on, etc.
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, relation)
);

CREATE TABLE store_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,           -- collection | object | relation
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,           -- create | update | delete | archive
  changes     JSONB,                   -- { field: { old, new } }
  performed_by TEXT,                   -- user | agent:{id} | cron
  review_id   UUID REFERENCES review_queue(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ───

CREATE INDEX idx_store_objects_collection ON store_objects(collection_id);
CREATE INDEX idx_store_objects_status ON store_objects(status);
CREATE INDEX idx_store_objects_created ON store_objects(created_at DESC);
CREATE INDEX idx_store_objects_data ON store_objects USING GIN (data);
CREATE INDEX idx_store_objects_fts ON store_objects USING GIN (fts);
CREATE INDEX idx_store_objects_tags ON store_objects USING GIN (tags);
CREATE INDEX idx_store_relations_source ON store_relations(source_id);
CREATE INDEX idx_store_relations_target ON store_relations(target_id);
CREATE INDEX idx_store_audit_entity ON store_audit_log(entity_type, entity_id);

-- Vector index (IVFFlat) — created with low list count since initial data is small
-- Recreate with more lists once >1000 objects exist
CREATE INDEX idx_store_objects_embedding ON store_objects
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- ─── FTS Trigger ───

CREATE OR REPLACE FUNCTION store_objects_fts_update() RETURNS trigger AS $$
DECLARE
  text_values TEXT;
BEGIN
  -- Extract all text-like values from JSONB data
  SELECT string_agg(value::text, ' ')
  INTO text_values
  FROM jsonb_each_text(NEW.data);

  NEW.fts := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(text_values, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER store_objects_fts_trigger
  BEFORE INSERT OR UPDATE ON store_objects
  FOR EACH ROW EXECUTE FUNCTION store_objects_fts_update();

-- ─── Updated_at Trigger ───

CREATE OR REPLACE FUNCTION store_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER store_collections_updated_at
  BEFORE UPDATE ON store_collections
  FOR EACH ROW EXECUTE FUNCTION store_updated_at();

CREATE TRIGGER store_objects_updated_at
  BEFORE UPDATE ON store_objects
  FOR EACH ROW EXECUTE FUNCTION store_updated_at();

-- ─── Seed: Store Auditor Agent ───

INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config) VALUES (
  'store-auditor',
  'Store Auditor',
  'Knowledge store auditor — checks for duplicates, schema drift, orphaned relations, and optimization opportunities.',
  'You are the Store Auditor agent for JOI. You maintain data quality in the knowledge store.

## Capabilities
- Detect duplicate objects (>90% title similarity within a collection)
- Find schema drift (object fields not matching collection schema)
- Identify orphaned relations pointing to archived/deleted objects
- Report empty or bloated collections
- Check embedding coverage
- Validate required fields

## Guidelines
- Run comprehensive audits when triggered by cron
- Submit actionable findings to the review queue with tag "optimization"
- Be concise in reports — focus on issues that need human attention
- Use German locale for dates when presenting to Marcus

## Report Format
1. Summary stats (collections, objects, relations)
2. Issues found (duplicates, drift, orphans)
3. Recommendations (prioritized actions)',
  'claude-haiku-4-5-20251001',
  true,
  ARRAY['store_audit', 'store_query', 'store_list_collections', 'store_search'],
  '{"role": "store-auditor", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();

-- ─── Seed: Skills Registry ───

INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('store_create_collection', 'Create a new knowledge store collection with typed schema', 'bundled', true),
  ('store_list_collections', 'List all knowledge store collections', 'bundled', true),
  ('store_create_object', 'Create an object in a knowledge store collection', 'bundled', true),
  ('store_query', 'Query objects with filters, sort, pagination', 'bundled', true),
  ('store_update_object', 'Update an existing object', 'bundled', true),
  ('store_delete_object', 'Archive/delete an object', 'bundled', true),
  ('store_relate', 'Create a relation between two objects', 'bundled', true),
  ('store_search', 'Semantic + text search across all collections', 'bundled', true),
  ('store_audit', 'Run audit checks on knowledge store (duplicates, bloat, drift)', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- ─── Seed: Weekly Audit Cron Job ───

INSERT INTO cron_jobs (name, description, agent_id, enabled, schedule_kind, schedule_cron_expr, schedule_cron_tz, payload_kind, payload_text)
VALUES (
  'weekly-store-audit',
  'Weekly knowledge store audit: check for duplicates, schema drift, orphaned relations, and optimization opportunities',
  'store-auditor',
  true,
  'cron',
  '0 10 * * 0',
  'Europe/Vienna',
  'agent_turn',
  'Run a full audit of the knowledge store. Check for duplicates, schema drift, orphaned relations, and optimization opportunities. Submit findings to the review queue.'
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  agent_id = EXCLUDED.agent_id,
  schedule_cron_expr = EXCLUDED.schedule_cron_expr,
  payload_text = EXCLUDED.payload_text;
