-- Stabilization patch:
-- 1) Ensure feedback memories are schema-valid even when migration 028 was skipped.
-- 2) Ensure Learning Episodes collection exists.
-- 3) Pause aggressive inbox email scanning until rules/queue hygiene are configured.

-- Ensure "Learning Episodes" exists (idempotent).
INSERT INTO store_collections (name, description, icon, schema, config)
VALUES (
  'Learning Episodes',
  'Feedback episodes from review decisions. Source for preference and reflection extraction.',
  '🧠',
  '[
    {"name": "signal", "type": "select", "required": true,
     "options": ["approved", "rejected", "modified"]},
    {"name": "domain", "type": "select", "required": true,
     "options": ["triage", "skill", "chat", "other"]},
    {"name": "review_id", "type": "text", "required": true},
    {"name": "conversation_id", "type": "text", "required": false},
    {"name": "context_summary", "type": "text", "required": true},
    {"name": "proposed_action", "type": "json", "required": false},
    {"name": "actual_action", "type": "json", "required": false},
    {"name": "delta_summary", "type": "text", "required": false},
    {"name": "extracted_preference", "type": "text", "required": false},
    {"name": "extracted_reflection", "type": "text", "required": false}
  ]'::jsonb,
  '{"default_sort": "created_at", "sort_direction": "DESC"}'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Ensure memories.source supports "feedback".
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_source_check;
ALTER TABLE memories ADD CONSTRAINT memories_source_check
  CHECK (source IN ('user','inferred','solution_capture','episode','flush','feedback'));

-- Pause email inbox scanner (can be re-enabled manually from cron UI/API).
UPDATE cron_jobs
SET enabled = false,
    updated_at = NOW(),
    description = 'Paused by stabilization patch: enable after inbox rules and review flow are tuned'
WHERE name = 'scan_email_inboxes';
