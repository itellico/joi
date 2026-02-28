-- Enforce specialist-first skill policy:
-- 1) Replace legacy NULL (unrestricted/all-tools) with explicit assignments.
-- 2) Ensure agents.skills is never NULL going forward.

-- Known legacy defaults for core agents.
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

UPDATE agents
SET skills = ARRAY[
  'run_claude_code'
]
WHERE id = 'coder' AND skills IS NULL;

-- Any remaining NULL skills become explicit no-tools until configured.
UPDATE agents
SET skills = '{}'::text[]
WHERE skills IS NULL;

ALTER TABLE agents
  ALTER COLUMN skills SET DEFAULT '{}'::text[];

ALTER TABLE agents
  ALTER COLUMN skills SET NOT NULL;
