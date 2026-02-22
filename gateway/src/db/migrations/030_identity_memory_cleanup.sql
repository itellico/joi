-- Cleanup noisy identity memories accumulated from assistant fallback text.

-- Identify obviously invalid identity memories.
WITH invalid AS (
  SELECT id
  FROM memories
  WHERE area = 'identity'
    AND superseded_by IS NULL
    AND (
      LOWER(BTRIM(content)) IN ('user', 'assistant', 'unknown')
      OR content ~ '^[0-9]{1,2}:[0-9]{2}(\s?[AP]M)?$'
      OR content ILIKE '%current time%'
      OR content ILIKE '%could you please provide more context%'
      OR content ILIKE '%i do not know your name%'
      OR content ILIKE '%i''m not sure what%'
      OR content ILIKE '%i''m afraid i don''t have enough context%'
    )
)
UPDATE memories
SET superseded_by = NULL
WHERE superseded_by IN (SELECT id FROM invalid);

WITH invalid AS (
  SELECT id
  FROM memories
  WHERE area = 'identity'
    AND superseded_by IS NULL
    AND (
      LOWER(BTRIM(content)) IN ('user', 'assistant', 'unknown')
      OR content ~ '^[0-9]{1,2}:[0-9]{2}(\s?[AP]M)?$'
      OR content ILIKE '%current time%'
      OR content ILIKE '%could you please provide more context%'
      OR content ILIKE '%i do not know your name%'
      OR content ILIKE '%i''m not sure what%'
      OR content ILIKE '%i''m afraid i don''t have enough context%'
    )
)
DELETE FROM memories
WHERE id IN (SELECT id FROM invalid);

-- Dedupe exact identity content by superseding lower-ranked duplicates.
WITH ranked AS (
  SELECT
    id,
    LOWER(BTRIM(content)) AS norm_content,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(BTRIM(content))
      ORDER BY confidence DESC, updated_at DESC, created_at DESC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(BTRIM(content))
      ORDER BY confidence DESC, updated_at DESC, created_at DESC
    ) AS keep_id
  FROM memories
  WHERE area = 'identity'
    AND superseded_by IS NULL
)
UPDATE memories m
SET superseded_by = r.keep_id,
    confidence = 0.0,
    updated_at = NOW()
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1
  AND r.keep_id <> r.id;
