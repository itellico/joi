-- Additional identity cleanup for question-like / conversational leftovers.

WITH invalid AS (
  SELECT id
  FROM memories
  WHERE area = 'identity'
    AND superseded_by IS NULL
    AND (
      content LIKE '%?%'
      OR content ILIKE 'hi, how''s it going%'
      OR content ILIKE '%could you please provide more details%'
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
      content LIKE '%?%'
      OR content ILIKE 'hi, how''s it going%'
      OR content ILIKE '%could you please provide more details%'
    )
)
DELETE FROM memories
WHERE id IN (SELECT id FROM invalid);

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
