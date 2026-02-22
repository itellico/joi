-- Inferred identity should remain provisional.
UPDATE memories
SET confidence = 0.85,
    updated_at = NOW()
WHERE area = 'identity'
  AND source = 'inferred'
  AND confidence > 0.85
  AND superseded_by IS NULL;
