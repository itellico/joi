-- Inbox triage: conversation type/status tracking + Things3 sync on reviews

-- Conversation type and inbox status
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'direct';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inbox_status TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_id UUID;

CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
CREATE INDEX IF NOT EXISTS idx_conversations_inbox_status ON conversations(inbox_status) WHERE type = 'inbox';

-- Backfill existing channel conversations
UPDATE conversations SET type = 'inbox', inbox_status = 'handled'
WHERE channel_id IS NOT NULL AND session_key IS NOT NULL AND type = 'direct';

-- Things3 sync tracking on reviews
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS things3_task_id TEXT;
