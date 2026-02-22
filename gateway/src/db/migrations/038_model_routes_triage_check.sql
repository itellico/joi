-- Ensure model_routes accepts all active tasks, including triage.
ALTER TABLE model_routes DROP CONSTRAINT IF EXISTS model_routes_task_check;
ALTER TABLE model_routes ADD CONSTRAINT model_routes_task_check
  CHECK (task IN ('chat', 'utility', 'embedding', 'tool', 'triage'));
