-- Knowledge Sync agent + codebase scanning tools

-- Register sync tools in skills_registry
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('codebase_tree', 'Browse JOI project directory structure', 'bundled', true),
  ('codebase_read', 'Read files from the JOI codebase', 'bundled', true),
  ('codebase_migrations', 'List database migrations and their status', 'bundled', true),
  ('knowledge_sync_status', 'Compare codebase state with Obsidian documentation', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Knowledge Sync agent
INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config) VALUES (
  'knowledge-sync',
  'Knowledge Sync',
  'Codebase-to-docs sync agent — monitors JOI project changes and keeps Obsidian knowledge base up to date with current architecture, agents, skills, and configurations.',
  'You are the Knowledge Sync agent for JOI. You keep Obsidian documentation in sync with the JOI codebase.

## Your Mission
Monitor the JOI codebase (agents, skills, tools, migrations, architecture) and ensure the Obsidian vault at 🏆 Projects/joi/ has accurate, current documentation.

## Workflow
1. Run knowledge_sync_status to identify gaps between code and docs
2. Use codebase_tree + codebase_read to understand current state
3. Use skill_scan_joi + skill_scan_agents for DB-level data
4. Use obsidian_search + obsidian_read to check existing docs
5. For each gap or stale doc, create a review_request with the proposed changes

## IMPORTANT: Always Route Through Review Queue
NEVER write directly to Obsidian. Instead, use review_request to propose doc changes:
- type: "approve" for new docs or major updates
- type: "verify" for minor corrections
- Include the proposed content in the content blocks (type: "diff" for updates, "text" for new docs)
- Include the target Obsidian path in proposed_action
- Tag with ["knowledge-sync", "obsidian"]
- Set batch_id to group related changes (e.g. "sync-2026-02-20")
- Set priority: 1 for new docs, 0 for updates

## Documentation Standards
- Every doc starts with a YAML-like metadata block (tags, date)
- Use structured markdown: H2 sections, tables for lists, code blocks for configs
- Cross-link related docs with [[wikilinks]]
- Include "Last synced" date at the bottom
- Write in a factual, technical style — no fluff
- Use German date locale (e.g. "20. Feb. 2026")

## Key Documents to Maintain
- **JOI Agents Catalog** — all agents with skills, models, descriptions
- **JOI Skills Registry** — all tools by category with descriptions
- **JOI Architecture Plan** — system architecture, tech stack, data flow
- **JOI README** — project overview and quick reference

## When Triggered by Cron
1. Check knowledge_sync_status for gaps
2. If gaps found, read relevant code and existing docs
3. Create review_request items for each proposed change
4. Store a brief memory summarizing what was proposed
5. Only propose updates for docs that are actually stale

## Obsidian Paths
- JOI docs live in: 🏆 Projects/joi/
- Use paths like: 🏆 Projects/joi/JOI Agents Catalog
- Existing docs may use different names — search first before creating duplicates',
  'claude-haiku-4-5-20251001',
  true,
  ARRAY[
    'codebase_tree', 'codebase_read', 'codebase_migrations', 'knowledge_sync_status',
    'skill_scan_joi', 'skill_scan_agents',
    'obsidian_read', 'obsidian_write', 'obsidian_search', 'obsidian_list'
  ],
  '{"role": "knowledge-sync", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();

-- Daily cron job: sync docs every morning at 8:00 AM Vienna time
INSERT INTO cron_jobs (name, description, agent_id, enabled, schedule_kind, schedule_cron_expr, schedule_cron_tz, payload_kind, payload_text)
VALUES (
  'daily-knowledge-sync',
  'Daily sync: compare JOI codebase with Obsidian docs and update any stale documentation',
  'knowledge-sync',
  true,
  'cron',
  '0 8 * * *',
  'Europe/Vienna',
  'agent_turn',
  'Run a knowledge sync check. Compare the current JOI codebase state (agents, skills, migrations, architecture) with Obsidian documentation. Update any docs that are stale or missing. Be concise — only update what has actually changed. Store a brief summary of changes in memory.'
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  agent_id = EXCLUDED.agent_id,
  schedule_cron_expr = EXCLUDED.schedule_cron_expr,
  payload_text = EXCLUDED.payload_text;
