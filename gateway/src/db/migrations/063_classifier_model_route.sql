-- Add 'classifier' and 'voice' task types to model_routes
-- The classifier route controls which LLM is used for intent classification
-- (replacing regex-based intent detection)

ALTER TABLE model_routes DROP CONSTRAINT IF EXISTS model_routes_task_check;
ALTER TABLE model_routes ADD CONSTRAINT model_routes_task_check
  CHECK (task IN ('chat', 'utility', 'embedding', 'tool', 'triage', 'classifier', 'voice'));

-- Default: gpt-4.1-nano on OpenRouter (ultra-cheap, ultra-fast)
INSERT INTO model_routes (task, model, provider)
VALUES ('classifier', 'openai/gpt-4.1-nano', 'openrouter')
ON CONFLICT (task) DO NOTHING;
