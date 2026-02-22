-- Add scope to channel_configs (free-text label like "itellico-at", "personal")
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS scope_metadata JSONB DEFAULT '{}';

-- Add Discord identity columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Index for Discord contact matching
CREATE INDEX IF NOT EXISTS contacts_discord_id_idx ON contacts (discord_id) WHERE discord_id IS NOT NULL;
