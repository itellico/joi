-- Chat message controls: pin/report moderation metadata

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_note TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_pinned
  ON messages (conversation_id, created_at)
  WHERE pinned = true;

CREATE INDEX IF NOT EXISTS idx_messages_reported
  ON messages (conversation_id, created_at)
  WHERE reported = true;
