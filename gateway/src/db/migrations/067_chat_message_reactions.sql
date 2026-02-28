-- Chat message reactions (Telegram-like quick reactions)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reactions JSONB;

CREATE INDEX IF NOT EXISTS idx_messages_reactions_gin
  ON messages
  USING gin (reactions)
  WHERE reactions IS NOT NULL;
