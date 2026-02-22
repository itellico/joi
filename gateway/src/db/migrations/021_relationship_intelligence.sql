-- Relationship Intelligence: schema changes, new tools, Radar upgrade, cron jobs

-- 1. Add external_id and is_from_me to contact_interactions for dedup + direction tracking
ALTER TABLE contact_interactions ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE contact_interactions ADD COLUMN IF NOT EXISTS is_from_me BOOLEAN DEFAULT false;

-- Partial unique index: dedup by platform + external_id (only where external_id is set)
CREATE UNIQUE INDEX IF NOT EXISTS interactions_platform_external_id_idx
  ON contact_interactions (platform, external_id)
  WHERE external_id IS NOT NULL;

-- 2. Register new contact tools in skills_registry
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('contacts_interactions_list', 'Query contact interaction history with filters (contact_id, platform, days, limit)', 'bundled', true),
  ('contacts_update_extra', 'Update a contact''s extra JSONB field with relationship metadata', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- 3. Upgrade Radar agent skills
UPDATE agents SET skills = ARRAY[
  'contacts_search', 'contacts_get', 'contacts_list', 'contacts_groups', 'contacts_group_members',
  'contacts_interactions_list', 'contacts_update_extra',
  'channel_send', 'channel_list',
  'gmail_search', 'gmail_read', 'gmail_send',
  'calendar_list_events', 'calendar_create_event',
  'obsidian_search', 'obsidian_read', 'obsidian_write',
  'tasks_create', 'tasks_list',
  'store_query', 'store_search'
] WHERE id = 'radar';
