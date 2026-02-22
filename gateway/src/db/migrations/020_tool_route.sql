-- Add 'tool' task to model_routes for cheap tool-calling model

-- Update the CHECK constraint on task to include 'tool'
ALTER TABLE model_routes DROP CONSTRAINT IF EXISTS model_routes_task_check;
ALTER TABLE model_routes ADD CONSTRAINT model_routes_task_check
  CHECK (task IN ('chat', 'utility', 'embedding', 'tool'));

-- Seed default tool route (cheap model for agentic tool loops)
INSERT INTO model_routes (task, model, provider, updated_at)
VALUES ('tool', 'openai/gpt-4o-mini', 'openrouter', NOW())
ON CONFLICT (task) DO NOTHING;
