-- Add sender_name to media for display when contact resolution fails
ALTER TABLE media ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- Backfill from conversations metadata where possible
UPDATE media m
SET sender_name = c.metadata->>'senderName'
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.sender_name IS NULL
  AND c.metadata->>'senderName' IS NOT NULL;
