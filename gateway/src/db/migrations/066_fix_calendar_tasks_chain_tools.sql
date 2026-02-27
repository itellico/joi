-- Fix "Calendar and tasks chain" QA test: wrong tool names
-- Turn 2 expected "things_create_task" but actual tool is "tasks_create"
-- Turn 5 expected "schedule_list" but prompt didn't reliably trigger tool use
-- Also fix suite-level expected_tools array

UPDATE qa_test_cases
SET
  turns = jsonb_set(
    jsonb_set(
      turns,
      '{1,expected_tools}',       -- Turn 2 (0-indexed)
      '["tasks_create"]'::jsonb
    ),
    '{4}',                         -- Turn 5 (0-indexed) — rewrite whole turn
    '{
      "role": "user",
      "message": "Now verify by checking my scheduled reminders and listing my current tasks.",
      "expected_tools": ["schedule_list"],
      "description": "Verify created items via tool calls"
    }'::jsonb
  ),
  expected_tools = ARRAY['calendar_list_events', 'tasks_create', 'schedule_create']
WHERE name = 'Calendar and tasks chain';
