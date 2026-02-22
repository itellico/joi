-- Skill Scout agent + skill audit tools

-- Register skill scout tools
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('skill_audit', 'Full cross-system skill audit: JOI gateway, Claude Code skills, and official Anthropic repositories with gap analysis', 'bundled', true),
  ('skill_scan_joi', 'Scan JOI skills_registry database for all registered tools', 'bundled', true),
  ('skill_scan_claude_code', 'Scan Claude Code skills directory for all installed skills', 'bundled', true),
  ('skill_scan_official', 'Check official Anthropic skills repository for available skills', 'bundled', true),
  ('skill_scan_agents', 'List all JOI agents with their assigned skills and tool counts', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Skill Scout agent
INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config) VALUES (
  'skill-scout',
  'Skill Scout',
  'Skills intelligence agent — audits JOI and Claude Code skills, monitors official Anthropic skill repositories, and suggests new skills and improvements.',
  'You are the Skill Scout agent for JOI. You monitor and optimize the skill ecosystem.

## Capabilities
- Audit all JOI gateway skills (tools registered in skills_registry)
- Audit all Claude Code skills (~/.claude/skills/)
- Check official Anthropic skill repositories for new/updated skills
- Analyze agent-to-skill assignments and suggest optimizations
- Identify gaps between systems (tools in code but not in DB, etc.)
- Suggest new skills based on usage patterns and available repositories

## Guidelines
- Always start with skill_audit for a complete picture
- Report findings in structured format with clear action items
- Prioritize suggestions by impact: security fixes > missing registrations > new capabilities
- When suggesting new skills, explain the value proposition
- Use German locale for dates when presenting to Marcus
- For cron-triggered runs, store findings as memories for later review

## Report Format
When generating an audit report:
1. Summary stats (total skills, agents, gaps)
2. Issues found (missing DB entries, unassigned agents)
3. New skills available (from official repos)
4. Recommendations (prioritized list of actions)',
  'claude-haiku-4-5-20251001',
  true,
  ARRAY['skill_audit', 'skill_scan_joi', 'skill_scan_claude_code', 'skill_scan_official', 'skill_scan_agents'],
  '{"role": "skill-scout", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();

-- Weekly cron job: Skill audit every Monday at 9:00 AM Vienna time
INSERT INTO cron_jobs (name, description, agent_id, enabled, schedule_kind, schedule_cron_expr, schedule_cron_tz, payload_kind, payload_text)
VALUES (
  'weekly-skill-audit',
  'Weekly skill audit: compare JOI, Claude Code, and official Anthropic skills',
  'skill-scout',
  true,
  'cron',
  '0 9 * * 1',
  'Europe/Vienna',
  'agent_turn',
  'Run a full skill audit. Compare JOI skills, Claude Code skills, and official Anthropic repositories. Report any gaps, missing registrations, new official skills available, and suggestions for improvement. Store a summary in memory for Marcus to review.'
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  agent_id = EXCLUDED.agent_id,
  schedule_cron_expr = EXCLUDED.schedule_cron_expr,
  payload_text = EXCLUDED.payload_text;
