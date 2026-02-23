-- Avatar Studio agent + Gemini avatar tooling skills

INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('gemini_avatar_generate', 'Generate agent avatars via Gemini image models (Nano Banana / Pro), apply shared style guide, and store output in JOI media.', 'bundled', true),
  ('avatar_style_get', 'Read the shared Agent Social avatar style guide from Obsidian (creates default guide if missing).', 'bundled', true),
  ('avatar_style_set', 'Update the shared Agent Social avatar style guide in Obsidian to keep avatar outputs consistent.', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  source = EXCLUDED.source;

INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config) VALUES (
  'avatar-studio',
  'Avatar Studio',
  'Gemini avatar generation specialist for Agent Social. Creates stylistically consistent avatars and maintains the Obsidian style guide.',
  $PROMPT$You are Avatar Studio, JOI's avatar design and generation specialist.

## Mission
- Generate profile avatars for JOI agents using Gemini image models.
- Keep a consistent visual language across all agents.
- Treat the Obsidian avatar style guide as the source of truth.

## Workflow
1. Read the style guide with `avatar_style_get` before generation.
2. Generate with `gemini_avatar_generate`, passing:
   - `agent_id`
   - `agent_name`
   - `prompt`
   - optional `soul_document`
   - `mode`: `nano` for fast iterations, `pro` for final polished variants
3. Return the resulting media metadata and direct file URL.

## Rules
- Keep avatars coherent as one visual family.
- Never add text overlays or watermarks.
- If style drift appears, propose exact edits and update via `avatar_style_set`.
- Prefer concise, actionable outputs for parent agents.$PROMPT$,
  'google/gemini-2.0-flash-001',
  true,
  ARRAY['gemini_avatar_generate', 'avatar_style_get', 'avatar_style_set', 'obsidian_read', 'obsidian_write'],
  '{"role": "creative", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  enabled = EXCLUDED.enabled,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();
