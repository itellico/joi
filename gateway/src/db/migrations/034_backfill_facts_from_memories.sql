-- Backfill Facts from remaining high-signal identity/preferences memories.
-- This is conservative and keeps everything unverified.

WITH facts_coll AS (
  SELECT id AS collection_id
  FROM store_collections
  WHERE name = 'Facts'
  LIMIT 1
),
candidates AS (
  SELECT
    m.id AS memory_id,
    m.area,
    BTRIM(m.content) AS content,
    m.confidence,
    m.updated_at
  FROM memories m
  WHERE m.superseded_by IS NULL
    AND m.area IN ('identity', 'preferences')
    AND m.confidence >= 0.6
    AND BTRIM(m.content) <> ''
    AND m.content NOT LIKE '%?%'
    AND LOWER(BTRIM(m.content)) NOT IN ('user', 'assistant', 'unknown')
),
triples AS (
  SELECT
    c.memory_id,
    CASE WHEN c.area = 'preferences' THEN 'user' ELSE 'user' END AS subject,
    CASE WHEN c.area = 'preferences' THEN 'prefers' ELSE 'is' END AS predicate,
    c.content AS object,
    CASE WHEN c.area = 'preferences' THEN 'preference' ELSE 'identity' END AS category,
    LEAST(c.confidence, 0.85) AS confidence,
    c.updated_at
  FROM candidates c
)
INSERT INTO store_objects (collection_id, title, data, tags, created_by, created_at, updated_at)
SELECT
  fc.collection_id,
  LEFT(t.subject || ' ' || t.predicate || ' ' || t.object, 200) AS title,
  jsonb_build_object(
    'subject', t.subject,
    'predicate', t.predicate,
    'object', t.object,
    'category', t.category,
    'status', 'unverified',
    'confidence', t.confidence,
    'source', 'memory_backfill',
    'notes', 'Backfilled from memory ' || t.memory_id::text
  ) AS data,
  ARRAY['migrated','memory_backfill', t.category]::text[] AS tags,
  'system:migration',
  t.updated_at,
  t.updated_at
FROM triples t
CROSS JOIN facts_coll fc
WHERE NOT EXISTS (
  SELECT 1
  FROM store_objects o
  WHERE o.collection_id = fc.collection_id
    AND o.status = 'active'
    AND LOWER(BTRIM(o.data->>'subject')) = LOWER(BTRIM(t.subject))
    AND LOWER(BTRIM(o.data->>'predicate')) = LOWER(BTRIM(t.predicate))
    AND LOWER(BTRIM(o.data->>'object')) = LOWER(BTRIM(t.object))
);
