-- Learning System: Episode recording + feedback-sourced memories

-- Seed "Learning Episodes" store collection
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

-- Expand memories.source CHECK to include 'feedback'
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_source_check;
ALTER TABLE memories ADD CONSTRAINT memories_source_check
  CHECK (source IN ('user','inferred','solution_capture','episode','flush','feedback'));
