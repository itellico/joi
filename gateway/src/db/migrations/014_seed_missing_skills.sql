-- Seed missing tools into skills_registry + fix agent skill assignments

-- Gmail general tools (from google/gmail-tools.ts)
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('gmail_search', 'Search Gmail with any query using Gmail search syntax (from:, subject:, is:unread, newer_than:, etc.)', 'bundled', true),
  ('gmail_read', 'Read a single email by message ID with full headers and body', 'bundled', true),
  ('gmail_send', 'Send an email or reply to an existing thread', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Apple Contacts tools (from apple/contacts-tools.ts)
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('contacts_search', 'Search Apple Contacts by name, email, phone, or company', 'bundled', true),
  ('contacts_get', 'Get full contact details by contact ID', 'bundled', true),
  ('contacts_list', 'List contacts with optional limit and offset', 'bundled', true),
  ('contacts_groups', 'List all contact groups from Apple Contacts', 'bundled', true),
  ('contacts_group_members', 'Get all members of a specific contact group', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Fix agent skill assignments to use tool-level names
-- Media agent
UPDATE agents SET skills = ARRAY[
  'youtube_transcribe', 'audio_transcribe'
] WHERE id = 'media';

-- Email agent
UPDATE agents SET skills = ARRAY[
  'gmail_search', 'gmail_read', 'gmail_send'
] WHERE id = 'email';

-- Bridge agent - messaging across platforms
UPDATE agents SET skills = ARRAY[
  'channel_send', 'channel_list',
  'contacts_search', 'contacts_get', 'contacts_list'
] WHERE id = 'bridge';

-- Scout agent - daily briefing
UPDATE agents SET skills = ARRAY[
  'gmail_search', 'gmail_read',
  'calendar_list_events',
  'tasks_list', 'tasks_logbook',
  'channel_list',
  'obsidian_search', 'obsidian_read',
  'outline_search', 'outline_read'
] WHERE id = 'scout';

-- Radar agent - relationship/CRM
UPDATE agents SET skills = ARRAY[
  'contacts_search', 'contacts_get', 'contacts_list', 'contacts_groups', 'contacts_group_members',
  'channel_send', 'channel_list',
  'gmail_search', 'gmail_read', 'gmail_send',
  'calendar_list_events', 'calendar_create_event',
  'obsidian_search', 'obsidian_read', 'obsidian_write'
] WHERE id = 'radar';

-- Forge agent - content creation
UPDATE agents SET skills = ARRAY[
  'obsidian_search', 'obsidian_read', 'obsidian_write',
  'outline_search', 'outline_read',
  'document_search',
  'youtube_transcribe'
] WHERE id = 'forge';

-- Hawk agent - competitive intel
UPDATE agents SET skills = ARRAY[
  'obsidian_search', 'obsidian_read', 'obsidian_write',
  'outline_search', 'outline_read',
  'document_search'
] WHERE id = 'hawk';

-- Pulse agent - growth/CRO
UPDATE agents SET skills = ARRAY[
  'document_search',
  'obsidian_search', 'obsidian_read'
] WHERE id = 'pulse';

-- Blitz agent - launch commander
UPDATE agents SET skills = ARRAY[
  'gmail_search', 'gmail_read', 'gmail_send',
  'channel_send', 'channel_list',
  'calendar_list_events', 'calendar_create_event',
  'tasks_create', 'tasks_list',
  'obsidian_search', 'obsidian_read'
] WHERE id = 'blitz';

-- Accounting orchestrator
UPDATE agents SET skills = ARRAY[
  'gmail_scan', 'gmail_download', 'gmail_get_html', 'gmail_mark_processed',
  'drive_upload', 'drive_list',
  'invoice_save', 'invoice_classify', 'invoice_list',
  'transaction_import', 'transaction_match', 'transaction_list',
  'reconciliation_run'
] WHERE id = 'accounting-orchestrator';

-- Invoice collector
UPDATE agents SET skills = ARRAY[
  'gmail_scan', 'gmail_download', 'gmail_get_html', 'gmail_mark_processed',
  'drive_upload'
] WHERE id = 'invoice-collector';

-- Invoice processor
UPDATE agents SET skills = ARRAY[
  'invoice_save', 'invoice_classify', 'invoice_list',
  'drive_upload', 'drive_list'
] WHERE id = 'invoice-processor';

-- BMD uploader
UPDATE agents SET skills = ARRAY[
  'drive_list', 'invoice_list'
] WHERE id = 'bmd-uploader';

-- Reconciliation agent
UPDATE agents SET skills = ARRAY[
  'transaction_import', 'transaction_match', 'transaction_list',
  'invoice_list', 'reconciliation_run'
] WHERE id = 'reconciliation';

-- Personal JOI agent gets everything (null = all tools)
UPDATE agents SET skills = NULL WHERE id = 'personal';
