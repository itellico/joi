-- Enforce specialist-first assignments:
-- do not leave orchestration agents with NULL skills (NULL = all tools).

UPDATE agents
SET skills = ARRAY[
  'obsidian_search',
  'obsidian_read',
  'outline_search',
  'outline_read'
]
WHERE id = 'personal' AND skills IS NULL;

UPDATE agents
SET skills = ARRAY[
  'run_claude_code'
]
WHERE id = 'app-dev' AND skills IS NULL;
