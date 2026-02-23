-- Quality Center: automated testing, issue tracking, and prompt optimization

-- ─── Test Suites ───

CREATE TABLE IF NOT EXISTS qa_test_suites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  agent_id TEXT NOT NULL DEFAULT 'personal',
  config JSONB DEFAULT '{}',         -- model overrides, tool gating config, etc.
  tags TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Test Cases ───

CREATE TABLE IF NOT EXISTS qa_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id UUID NOT NULL REFERENCES qa_test_suites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  input_message TEXT NOT NULL,
  expected_tools TEXT[] DEFAULT '{}',
  unexpected_tools TEXT[] DEFAULT '{}',
  expected_content_patterns TEXT[] DEFAULT '{}',   -- regex patterns
  max_latency_ms INT,
  min_quality_score FLOAT DEFAULT 0.5,
  enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_test_cases_suite_id ON qa_test_cases(suite_id);

-- ─── Test Runs ───

CREATE TABLE IF NOT EXISTS qa_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id UUID NOT NULL REFERENCES qa_test_suites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  triggered_by TEXT DEFAULT 'manual',   -- manual, cron, autodev
  model_config JSONB DEFAULT '{}',      -- snapshot of model routing at run time
  total_cases INT DEFAULT 0,
  passed INT DEFAULT 0,
  failed INT DEFAULT 0,
  errored INT DEFAULT 0,
  skipped INT DEFAULT 0,
  avg_correctness FLOAT,
  avg_tool_accuracy FLOAT,
  avg_response_quality FLOAT,
  total_latency_ms INT,
  total_cost_usd FLOAT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_test_runs_suite_id ON qa_test_runs(suite_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_status ON qa_test_runs(status);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_created_at ON qa_test_runs(created_at DESC);

-- ─── Test Results (per-case) ───

CREATE TABLE IF NOT EXISTS qa_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES qa_test_runs(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES qa_test_cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'passed', 'failed', 'errored', 'skipped')),
  actual_content TEXT,
  actual_tools JSONB DEFAULT '[]',        -- Array of { name, input, result }
  judge_scores JSONB,                      -- { correctness, tool_accuracy, response_quality, reasoning }
  rule_checks JSONB,                       -- { tools_ok, patterns_ok, latency_ok, details[] }
  failure_reasons TEXT[] DEFAULT '{}',
  latency_ms INT,
  cost_usd FLOAT DEFAULT 0,
  model TEXT,
  provider TEXT,
  conversation_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_test_results_run_id ON qa_test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_case_id ON qa_test_results(case_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_status ON qa_test_results(status);

-- ─── Issues ───

CREATE TABLE IF NOT EXISTS qa_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  category TEXT NOT NULL DEFAULT 'quality'
    CHECK (category IN ('regression', 'quality', 'latency', 'cost', 'tool_error', 'prompt')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'autodev_assigned', 'fixed', 'verified', 'closed')),
  test_case_id UUID REFERENCES qa_test_cases(id) ON DELETE SET NULL,
  test_run_id UUID REFERENCES qa_test_runs(id) ON DELETE SET NULL,
  test_result_id UUID REFERENCES qa_test_results(id) ON DELETE SET NULL,
  autodev_task_id TEXT,                    -- Things3 task UUID
  evidence JSONB DEFAULT '[]',             -- content blocks like review_queue
  resolution_notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_issues_status ON qa_issues(status);
CREATE INDEX IF NOT EXISTS idx_qa_issues_severity ON qa_issues(severity);
CREATE INDEX IF NOT EXISTS idx_qa_issues_test_case_id ON qa_issues(test_case_id);
CREATE INDEX IF NOT EXISTS idx_qa_issues_created_at ON qa_issues(created_at DESC);

-- ─── Prompt Versions ───

CREATE TABLE IF NOT EXISTS qa_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'testing', 'active', 'retired')),
  parent_version_id UUID REFERENCES qa_prompt_versions(id) ON DELETE SET NULL,
  test_run_id UUID REFERENCES qa_test_runs(id) ON DELETE SET NULL,
  baseline_run_id UUID REFERENCES qa_test_runs(id) ON DELETE SET NULL,
  scores JSONB,                            -- aggregate scores from test run
  change_summary TEXT,
  review_queue_id UUID,                    -- link to review_queue for approval
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_prompt_versions_agent_id ON qa_prompt_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_qa_prompt_versions_status ON qa_prompt_versions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_prompt_versions_agent_version ON qa_prompt_versions(agent_id, version);

-- ─── Seed: Suite 1 — Core Agent Behavior ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Core Agent Behavior',
  'Foundational smoke tests: greetings, tool routing, latency, basic response quality.',
  'personal',
  ARRAY['core', 'smoke-test']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Simple greeting', 'hi', '{}', '{}', '{}', 3000, 1),
  ('a0000000-0000-0000-0000-000000000001', 'Time awareness', 'what time is it?', '{current_datetime}', '{}', '{}', 5000, 2),
  ('a0000000-0000-0000-0000-000000000001', 'Task listing', 'show my tasks', '{tasks_list}', '{}', '{}', 8000, 3),
  ('a0000000-0000-0000-0000-000000000001', 'No hallucinated tools on chat', 'tell me a joke', '{}', '{memory_search,tasks_list,gmail_search}', '{}', 5000, 4),
  ('a0000000-0000-0000-0000-000000000001', 'Multi-turn coherence', 'my name is TestUser. What did I just tell you?', '{}', '{}', '{TestUser}', 5000, 5)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 2 — Memory System ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'Memory System',
  'Tests memory_search, memory_store, memory_manage across all 5 areas (identity, preferences, knowledge, solutions, episodes). Validates hybrid search, temporal decay awareness, and contact enrichment from identity memories.',
  'personal',
  ARRAY['memory', 'knowledge', 'core']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000002', 'Identity recall — family', 'who is my son?', '{memory_search}', '{}', '{}', 8000, 1),
  ('a0000000-0000-0000-0000-000000000002', 'Identity recall — self', 'what do you know about me?', '{memory_search}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000002', 'Preference recall', 'how do I like my coffee?', '{memory_search}', '{}', '{}', 8000, 3),
  ('a0000000-0000-0000-0000-000000000002', 'Knowledge recall — project', 'what do you know about JOI?', '{memory_search}', '{}', '{}', 8000, 4),
  ('a0000000-0000-0000-0000-000000000002', 'Memory store — identity', 'remember that my dog is called Luna', '{memory_store}', '{}', '{}', 8000, 5),
  ('a0000000-0000-0000-0000-000000000002', 'Memory store — preference', 'I prefer dark mode in all my apps', '{memory_store}', '{}', '{}', 8000, 6),
  ('a0000000-0000-0000-0000-000000000002', 'Memory search — cross-area', 'what do you remember about my daily routines and preferences?', '{memory_search}', '{}', '{}', 10000, 7),
  ('a0000000-0000-0000-0000-000000000002', 'Solution recall', 'how did we fix the OrbStack networking issue last time?', '{memory_search}', '{}', '{}', 8000, 8)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 3 — Knowledge Store ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000003',
  'Knowledge Store',
  'Tests store_query, store_search, store_create_object, store_update_object, store_relate, store_audit. Validates schema enforcement, hybrid search, relations graph, and audit trail.',
  'personal',
  ARRAY['store', 'knowledge', 'core']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000003', 'List collections', 'what collections do I have in the store?', '{store_list_collections}', '{}', '{}', 5000, 1),
  ('a0000000-0000-0000-0000-000000000003', 'Query objects', 'show me all objects in the Facts collection', '{store_query}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000003', 'Semantic search', 'search the store for anything about deployment workflows', '{store_search}', '{}', '{}', 8000, 3),
  ('a0000000-0000-0000-0000-000000000003', 'Create object', 'add a fact to the store: JOI was started in January 2025', '{store_create_object}', '{}', '{}', 8000, 4),
  ('a0000000-0000-0000-0000-000000000003', 'Store audit', 'run a store audit and tell me what issues exist', '{store_audit}', '{}', '{}', 15000, 5)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 4 — Model Router & Tool Gating ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  'Model Router & Tool Gating',
  'Tests two-phase routing, tool gating (lightweight chat skips tools), model fallback behavior, and cost tracking. Validates that cheap queries skip tools while complex ones engage the tool loop.',
  'personal',
  ARRAY['router', 'model', 'tools']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000004', 'Tool gating — lightweight chat', 'what is 2+2?', '{}', '{memory_search,tasks_list,store_query}', '{4}', 3000, 1),
  ('a0000000-0000-0000-0000-000000000004', 'Tool gating — tool required', 'what tasks do I have for today?', '{tasks_list}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000004', 'Multi-tool orchestration', 'check my calendar for today and also show my tasks', '{tasks_list}', '{}', '{}', 12000, 3),
  ('a0000000-0000-0000-0000-000000000004', 'Knowledge question routes to memory', 'what is my home address?', '{memory_search}', '{gmail_search}', '{}', 8000, 4),
  ('a0000000-0000-0000-0000-000000000004', 'Ambiguous — should reason not hallucinate', 'what happened yesterday?', '{}', '{}', '{}', 8000, 5)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 5 — Review Queue & Triage ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000005',
  'Review Queue & Triage',
  'Tests review_request creation with various types (approve, classify, verify), content blocks, batch operations, and triage action execution post-approval.',
  'personal',
  ARRAY['review', 'triage', 'human-in-loop']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000005', 'Create approval review', 'I need you to create a review item asking me to approve buying a new monitor for 500 euros', '{review_request}', '{}', '{}', 10000, 1),
  ('a0000000-0000-0000-0000-000000000005', 'Check review status', 'what reviews are pending right now?', '{review_status}', '{}', '{}', 8000, 2)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 6 — Scheduling & Cron ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000006',
  'Scheduling & Cron',
  'Tests schedule_create (once, every, cron), schedule_list, schedule_manage. Validates timezone handling (Europe/Vienna), one-shot vs recurring, and cancellation.',
  'personal',
  ARRAY['scheduling', 'cron']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000006', 'List schedules', 'what scheduled jobs are running?', '{schedule_list}', '{}', '{}', 5000, 1),
  ('a0000000-0000-0000-0000-000000000006', 'Create one-time reminder', 'remind me to call the dentist tomorrow at 10am', '{schedule_create}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000006', 'Create recurring schedule', 'every Monday at 9am, remind me to review my OKRs', '{schedule_create}', '{}', '{}', 8000, 3)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 7 — Document Search & Obsidian ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000007',
  'Document Search & Obsidian',
  'Tests document_search (hybrid vector+FTS), obsidian_search_notes, obsidian_read_note. Validates multi-source indexing, scope filtering, and chunk-level relevance.',
  'personal',
  ARRAY['documents', 'obsidian', 'search']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000007', 'Document search', 'search my documents for anything about infrastructure setup', '{document_search}', '{}', '{}', 10000, 1),
  ('a0000000-0000-0000-0000-000000000007', 'Obsidian note search', 'find my Obsidian notes about project planning', '{obsidian_search_notes}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000007', 'Read specific note', 'read my daily note from today in Obsidian', '{obsidian_read_note}', '{}', '{}', 5000, 3)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 8 — Things3 Tasks & OKRs ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000008',
  'Things3 Tasks & OKRs',
  'Tests tasks_list, tasks_create, tasks_complete, projects_list, okr_report, okr_score_all. Validates task hierarchy, project/area filtering, and OKR score computation.',
  'personal',
  ARRAY['tasks', 'things3', 'okr']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000008', 'List today tasks', 'what are my tasks for today?', '{tasks_list}', '{}', '{}', 5000, 1),
  ('a0000000-0000-0000-0000-000000000008', 'Create task', 'add a task: review QA test results, due tomorrow', '{tasks_create}', '{}', '{}', 5000, 2),
  ('a0000000-0000-0000-0000-000000000008', 'List projects', 'what projects do I have in Things?', '{projects_list}', '{}', '{}', 5000, 3),
  ('a0000000-0000-0000-0000-000000000008', 'OKR report', 'show me my OKR progress report', '{okr_report}', '{}', '{}', 10000, 4),
  ('a0000000-0000-0000-0000-000000000008', 'OKR scoring', 'recalculate all my OKR scores', '{okr_score_all}', '{}', '{}', 10000, 5)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 9 — Contacts & Relationships ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000009',
  'Contacts & Relationships',
  'Tests contacts_search, contacts_get, contacts_interactions_list, and memory-based contact enrichment. Validates CRM integration and relationship intelligence.',
  'personal',
  ARRAY['contacts', 'crm', 'relationships']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000009', 'Search contacts', 'find the contact info for Moritz', '{contacts_search}', '{}', '{}', 5000, 1),
  ('a0000000-0000-0000-0000-000000000009', 'Contact interactions', 'when did I last talk to Moritz?', '{contacts_interactions_list}', '{}', '{}', 8000, 2),
  ('a0000000-0000-0000-0000-000000000009', 'Identity enrichment trigger', 'remember that Sarah works at Google as a product manager', '{memory_store}', '{}', '{}', 8000, 3)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 10 — Agent Spawning & Delegation ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000010',
  'Agent Spawning & Delegation',
  'Tests spawn_agent for delegating complex tasks to specialized agents. Validates context passing, sub-agent tool access, and result aggregation.',
  'personal',
  ARRAY['agents', 'spawn', 'delegation']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000010', 'Delegate to knowledge agent', 'ask the knowledge sync agent to check if there are any stale entries', '{spawn_agent}', '{}', '{}', 30000, 1),
  ('a0000000-0000-0000-0000-000000000010', 'Direct agent question', 'which agents are available and what are their specialties?', '{}', '{}', '{}', 8000, 2)
ON CONFLICT DO NOTHING;

-- ─── Seed: Suite 11 — Channel Messaging ───

INSERT INTO qa_test_suites (id, name, description, agent_id, tags)
VALUES (
  'a0000000-0000-0000-0000-000000000011',
  'Channel Messaging',
  'Tests channel_list and channel_send across WhatsApp, Telegram, iMessage, Email. Validates connection status checks, message delivery, and contact timeline linking.',
  'personal',
  ARRAY['channels', 'messaging']
) ON CONFLICT (name) DO NOTHING;

INSERT INTO qa_test_cases (suite_id, name, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000011', 'List channels', 'which messaging channels are connected?', '{channel_list}', '{}', '{}', 5000, 1),
  ('a0000000-0000-0000-0000-000000000011', 'Channel awareness', 'can you send a WhatsApp message?', '{}', '{}', '{}', 5000, 2)
ON CONFLICT DO NOTHING;

-- ─── Seed: QA Agent ───

INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config)
VALUES (
  'qa-agent',
  'Quality Assurance Agent',
  'Runs test suites, analyzes failures, proposes fixes, and tracks quality issues across the JOI system.',
  'You are the QA agent for JOI. Your job is to:
1. Run test suites against the JOI agent system
2. Analyze test failures and identify root causes
3. Create issues for persistent failures
4. Propose prompt improvements based on failure patterns
5. Track quality metrics over time

You have access to memory_search and store tools to investigate failures and store findings.',
  NULL,
  true,
  ARRAY['memory_search', 'memory_store', 'store_query', 'store_search', 'store_create_object'],
  '{"role": "qa-agent", "allowGlobalDataAccess": true}'
)
ON CONFLICT (id) DO NOTHING;

-- ─── Seed: QA Nightly Cron Job ───

INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
   schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
VALUES ('system', 'run_qa_tests', 'Nightly QA test suite execution across all enabled suites',
   'cron', '0 3 * * *', 'Europe/Vienna', 'isolated', 'system_event', 'run_qa_tests', true)
ON CONFLICT (name) DO NOTHING;
