-- Seed "Inbox Rules" store collection for rules engine
INSERT INTO store_collections (name, description, icon, schema, config)
VALUES (
  'Inbox Rules',
  'Rules that guide inbox triage classification and actions. Applied automatically to incoming messages.',
  '📋',
  '[
    {"name": "match_sender", "type": "text", "required": false},
    {"name": "match_channel", "type": "select", "required": false, "options": ["email", "whatsapp", "telegram", "imessage", "any"]},
    {"name": "match_keywords", "type": "text", "required": false},
    {"name": "match_intent", "type": "select", "required": false, "options": ["question", "request", "fyi", "urgent", "social", "spam", "any"]},
    {"name": "override_intent", "type": "select", "required": false, "options": ["question", "request", "fyi", "urgent", "social", "spam"]},
    {"name": "override_urgency", "type": "select", "required": false, "options": ["low", "medium", "high"]},
    {"name": "action_type", "type": "select", "required": true, "options": ["reply", "create_task", "extract", "label", "archive", "no_action"]},
    {"name": "action_config", "type": "json", "required": false},
    {"name": "auto_approve", "type": "checkbox", "required": false},
    {"name": "priority", "type": "number", "required": false},
    {"name": "hit_count", "type": "number", "required": false},
    {"name": "last_hit_at", "type": "date", "required": false}
  ]'::jsonb,
  '{"default_sort": "priority", "sort_direction": "DESC"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;
