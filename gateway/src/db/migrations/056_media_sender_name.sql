-- Add sender_name to media for display when contact resolution fails
ALTER TABLE media ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- Backfill from conversations metadata (only for 1:1 chats, not broadcasts)
UPDATE media m
SET sender_name = c.metadata->>'senderName'
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.sender_name IS NULL
  AND m.sender_id != 'status@broadcast'
  AND c.metadata->>'senderName' IS NOT NULL;

-- Clear any incorrect backfills for status@broadcast
UPDATE media SET sender_name = NULL WHERE sender_id = 'status@broadcast';
