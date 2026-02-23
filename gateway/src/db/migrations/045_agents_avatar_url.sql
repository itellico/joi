-- Add avatar_url column to agents table so each agent has a direct link to its current avatar
ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Extend media status check constraint to include 'replaced' for avatar housekeeping
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_status_check;
ALTER TABLE media ADD CONSTRAINT media_status_check
  CHECK (status IN ('pending', 'downloading', 'ready', 'error', 'deleted', 'replaced'));

-- Backfill: set avatar_url from the most recent media entry for each agent
UPDATE agents a
SET avatar_url = sub.url
FROM (
  SELECT DISTINCT ON (sender_id)
    sender_id,
    '/api/media/' || id || '/file' AS url
  FROM media
  WHERE channel_type = 'agent-social'
    AND media_type = 'photo'
    AND status = 'ready'
  ORDER BY sender_id, created_at DESC
) sub
WHERE a.id = sub.sender_id
  AND a.avatar_url IS NULL;
