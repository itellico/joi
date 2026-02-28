-- Add 'lightweight' task type to model_routes for casual/no-tool turns.

ALTER TABLE model_routes DROP CONSTRAINT IF EXISTS model_routes_task_check;
ALTER TABLE model_routes ADD CONSTRAINT model_routes_task_check
  CHECK (task IN ('chat', 'lightweight', 'utility', 'embedding', 'tool', 'triage', 'classifier', 'voice'));

-- Default lightweight route: cheap and fast.
INSERT INTO model_routes (task, model, provider)
VALUES ('lightweight', 'openai/gpt-4o-mini', 'openrouter')
ON CONFLICT (task) DO NOTHING;
