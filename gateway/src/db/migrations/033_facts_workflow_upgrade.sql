-- Facts workflow upgrade:
-- Ensure Facts collection exists and add indexes for fact lookups used by learning/context loading.

INSERT INTO store_collections (name, description, icon, schema, config)
VALUES (
  'Facts',
  'Verified and unverified facts about people, relationships, and the world. Facts link to contacts, OKRs, tasks, and reviews via relations.',
  '📌',
  '[
    {"name": "subject", "type": "text", "required": true},
    {"name": "predicate", "type": "text", "required": true},
    {"name": "object", "type": "text", "required": true},
    {"name": "category", "type": "select", "required": true, "options": ["identity","relationship","preference","work","health","location","financial","other"]},
    {"name": "status", "type": "select", "required": true, "options": ["unverified","verified","disputed","outdated"]},
    {"name": "confidence", "type": "number"},
    {"name": "source", "type": "text"},
    {"name": "verified_at", "type": "date"},
    {"name": "verified_by", "type": "text"},
    {"name": "notes", "type": "text"}
  ]'::jsonb,
  '{"view_mode":"table","default_sort":"updated_at"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Fast path for active fact lookups.
CREATE INDEX IF NOT EXISTS idx_store_objects_active_collection_updated
  ON store_objects(collection_id, updated_at DESC)
  WHERE status = 'active';

-- Fast path for subject/predicate/object matching in Facts.
CREATE INDEX IF NOT EXISTS idx_store_objects_fact_triples
  ON store_objects(
    collection_id,
    LOWER(BTRIM(COALESCE(data->>'subject',''))),
    LOWER(BTRIM(COALESCE(data->>'predicate',''))),
    LOWER(BTRIM(COALESCE(data->>'object','')))
  )
  WHERE status = 'active';

-- Fast path for verified facts by category.
CREATE INDEX IF NOT EXISTS idx_store_objects_fact_status_category
  ON store_objects(
    collection_id,
    LOWER(BTRIM(COALESCE(data->>'status',''))),
    LOWER(BTRIM(COALESCE(data->>'category','')))
  )
  WHERE status = 'active';
