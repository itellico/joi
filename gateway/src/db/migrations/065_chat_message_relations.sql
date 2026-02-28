-- Chat message relations: reply, forward, mentions

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forward_of_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentions JSONB,
  ADD COLUMN IF NOT EXISTS forwarding_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_forward_of ON messages(forward_of_message_id) WHERE forward_of_message_id IS NOT NULL;
