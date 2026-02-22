-- Knowledge quality repair:
-- 1) hide outdated facts from default store queries by archiving row status
-- 2) backfill missing obsidianArea on documents
-- 3) backfill chunk metadata from document metadata

-- 1) Facts: keep semantic status in data.status, but archive outdated rows at store level
UPDATE store_objects
SET status = 'archived',
    updated_at = NOW()
WHERE collection_id = (SELECT id FROM store_collections WHERE name = 'Facts' LIMIT 1)
  AND status = 'active'
  AND COALESCE(data->>'status', 'unverified') = 'outdated';

-- 2) Documents: persist obsidianArea (was previously computed but not written)
UPDATE documents
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{obsidianArea}',
  to_jsonb(
    CASE
      WHEN COALESCE(metadata->>'obsidianType', '') = 'skills' THEN 'preferences'
      ELSE 'knowledge'
    END
  ),
  true
),
updated_at = NOW()
WHERE source = 'obsidian'
  AND COALESCE(metadata->>'obsidianArea', '') = '';

-- 3) Chunks: ensure metadata is populated for auditing/filtering/search explainability
UPDATE chunks c
SET metadata = jsonb_strip_nulls(
  COALESCE(c.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'source', d.source,
    'path', d.path,
    'title', d.title,
    'obsidianType', d.metadata->>'obsidianType',
    'obsidianArea', d.metadata->>'obsidianArea',
    'chunkIndex', c.chunk_index,
    'startLine', c.start_line,
    'endLine', c.end_line
  )
)
FROM documents d
WHERE c.document_id = d.id
  AND (
    c.metadata IS NULL
    OR c.metadata = '{}'::jsonb
    OR c.metadata->>'source' IS NULL
    OR (d.source = 'obsidian' AND c.metadata->>'obsidianType' IS NULL)
    OR (d.source = 'obsidian' AND c.metadata->>'obsidianArea' IS NULL)
  );
