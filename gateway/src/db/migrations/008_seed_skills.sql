-- Seed skills_registry with all actual agent tools
-- Replaces the 4 placeholder entries from migration 003

-- Clear old placeholders
DELETE FROM skills_registry WHERE source = 'bundled';

-- Memory & Knowledge
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('memory_search', 'Search memories and knowledge using hybrid BM25 + vector search across 5 areas (identity, preferences, knowledge, solutions, episodes)', 'bundled', true),
  ('memory_store', 'Store structured memories across 5 areas with tags, confidence, and source tracking', 'bundled', true),
  ('memory_manage', 'Update, delete, pin/unpin existing memories by ID', 'bundled', true),
  ('document_search', 'Search indexed documents from Outline wiki, Obsidian vault, and other ingested sources using hybrid vector + full-text search', 'bundled', true),
  ('current_datetime', 'Get the current date, time, and timezone', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Scheduling
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('schedule_create', 'Create a scheduled or recurring task (one-time, interval, or cron). Agent receives message at scheduled time', 'bundled', true),
  ('schedule_list', 'List all scheduled tasks with status, last run info, and schedule', 'bundled', true),
  ('schedule_manage', 'Delete, enable, or disable a scheduled task by ID', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Agent System
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('spawn_agent', 'Spawn a specialized sub-agent (e.g. invoice-processor, reconciliation) to handle a delegated task', 'bundled', true),
  ('review_request', 'Submit an item for human review in the JOI dashboard. Supports approve, classify, match, verify, freeform types', 'bundled', true),
  ('review_status', 'Check status of review items. Filter by ID, status, or batch', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Google Gmail
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('gmail_scan', 'Scan Gmail inbox for unprocessed invoice emails with PDF attachments', 'bundled', true),
  ('gmail_download', 'Download an email attachment and upload to Google Drive staging folder', 'bundled', true),
  ('gmail_get_html', 'Get the HTML body of an email (for HTML-based invoices like Apple receipts)', 'bundled', true),
  ('gmail_mark_processed', 'Mark a Gmail message as processed (add label, archive from inbox)', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Google Drive
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('drive_upload', 'Upload a file to Google Drive at a specific folder path', 'bundled', true),
  ('drive_list', 'List files in a Google Drive folder', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Google Calendar
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('calendar_list_calendars', 'List all Google Calendars available to the user', 'bundled', true),
  ('calendar_list_events', 'List events from Google Calendar with time range, search, and calendar filters', 'bundled', true),
  ('calendar_create_event', 'Create a new Google Calendar event (timed or all-day, with attendees and recurrence)', 'bundled', true),
  ('calendar_update_event', 'Update an existing Google Calendar event', 'bundled', true),
  ('calendar_delete_event', 'Delete a Google Calendar event', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Accounting
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('invoice_save', 'Save extracted invoice data (vendor, amount, date, etc.) to the database', 'bundled', true),
  ('invoice_classify', 'Classify an invoice into a BMD folder and set payment method', 'bundled', true),
  ('invoice_list', 'List invoices with optional filters (status, vendor, month)', 'bundled', true),
  ('transaction_import', 'Import bank/credit card transactions from parsed CSV export data', 'bundled', true),
  ('transaction_match', 'Match a bank transaction to an invoice for reconciliation', 'bundled', true),
  ('transaction_list', 'List bank transactions with optional filters', 'bundled', true),
  ('reconciliation_run', 'Manage reconciliation runs: start, update stats, or mark complete', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Channels
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('channel_send', 'Send a message through a connected channel (WhatsApp, Telegram, iMessage)', 'bundled', true),
  ('channel_list', 'List all configured messaging channels and their connection status', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Things3 Task Management
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('tasks_list', 'List active tasks from Things3. Filter by list (inbox/today/upcoming/anytime/someday), project, or area', 'bundled', true),
  ('tasks_create', 'Create a new task in Things3 with optional list, project, deadline, tags, and checklist items', 'bundled', true),
  ('tasks_complete', 'Mark a Things3 task as complete', 'bundled', true),
  ('tasks_update', 'Update a Things3 task: change title, notes, deadline, schedule, or tags', 'bundled', true),
  ('tasks_move', 'Move a Things3 task to a different list', 'bundled', true),
  ('tasks_projects', 'List all active Things3 projects with areas and task counts', 'bundled', true),
  ('tasks_logbook', 'List recently completed tasks from the Things3 logbook', 'bundled', true),
  ('tasks_create_project', 'Create a new project in Things3 with optional notes, area, deadline, and tags', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Obsidian Vault
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('obsidian_read', 'Read a note from the Obsidian vault by path', 'bundled', true),
  ('obsidian_write', 'Write or append to a note in the Obsidian vault', 'bundled', true),
  ('obsidian_search', 'Search notes in the Obsidian vault by content or title', 'bundled', true),
  ('obsidian_list', 'List notes and folders in the Obsidian vault', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Outline Wiki
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('outline_search', 'Search documents in the Outline wiki (company wiki: processes, infrastructure, product docs)', 'bundled', true),
  ('outline_read', 'Read the full content of an Outline wiki document by ID', 'bundled', true),
  ('outline_list_collections', 'List all collections (spaces) in the Outline wiki', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;
