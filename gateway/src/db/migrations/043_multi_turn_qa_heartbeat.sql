-- 043: Multi-turn QA test cases + Agent heartbeat system
-- Extends Quality Center with multi-turn conversation testing
-- Adds agent heartbeat tables for liveness/workload tracking

BEGIN;

-- ─── QA Schema Extensions ─────────────────────────────────────────

ALTER TABLE qa_test_cases
  ADD COLUMN IF NOT EXISTS turns JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS turn_count INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'single-turn';

ALTER TABLE qa_test_results
  ADD COLUMN IF NOT EXISTS turn_results JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS flow_coherence_score FLOAT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS flow_reasoning TEXT DEFAULT NULL;

-- ─── Agent Heartbeat Tables ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'idle',
  current_task TEXT,
  progress FLOAT,
  workload_summary JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  assigned_by TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority INT DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',
  input_data JSONB DEFAULT '{}',
  result_data JSONB,
  conversation_id UUID,
  result_conversation_id UUID,
  progress FLOAT DEFAULT 0,
  heartbeat_count INT DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_id ON agent_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_assigned_by ON agent_tasks(assigned_by);

-- ─── Heartbeat check cron job ─────────────────────────────────────

INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_every_ms,
  payload_kind, payload_text, enabled)
VALUES ('personal', 'check-agent-heartbeats', 'Check agent liveness and mark stale agents',
  'every', 120000, 'system_event', 'check_agent_heartbeats', true)
ON CONFLICT DO NOTHING;

-- ─── Multi-Turn Test Suites & Cases ───────────────────────────────

-- Suite: Multi-Turn Memory Flow
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Memory Flow', 'Tests memory storage, recall, and context retention across multiple turns', 'personal', ARRAY['multi-turn', 'memory'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Store CRUD
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Store CRUD', 'Tests the knowledge store create-query-update-search-delete lifecycle', 'personal', ARRAY['multi-turn', 'store'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Agent Delegation
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Agent Delegation', 'Tests discovering agents and delegating tasks across turns', 'personal', ARRAY['multi-turn', 'agents'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Scheduling
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Scheduling', 'Tests creating, listing, modifying, and verifying schedules', 'personal', ARRAY['multi-turn', 'scheduling'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Review Queue
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Review Queue', 'Tests creating approval items and checking review status', 'personal', ARRAY['multi-turn', 'review'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Contact Management
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Contact Management', 'Tests contact search, interaction tracking, and enrichment', 'personal', ARRAY['multi-turn', 'contacts'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Episode & Fact Learning
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Episode & Fact Learning', 'Tests episode creation from extended conversations and implicit fact learning', 'personal', ARRAY['multi-turn', 'memory', 'episodes'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Multi-Turn Tool Chain
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Multi-Turn Tool Chain', 'Tests multi-tool orchestration and model routing across turns', 'personal', ARRAY['multi-turn', 'tools', 'routing'])
ON CONFLICT (name) DO NOTHING;

-- Suite: Long Conversation Test
INSERT INTO qa_test_suites (name, description, agent_id, tags)
VALUES ('Long Conversation Test', 'Tests context retention across 10+ turn conversations', 'personal', ARRAY['multi-turn', 'long-form', 'context'])
ON CONFLICT (name) DO NOTHING;

-- ─── Multi-Turn Test Cases ────────────────────────────────────────

-- Helper: We need to use suite IDs by name since they are UUIDs.
-- Use DO blocks with variables.

DO $$
DECLARE
  suite_memory UUID;
  suite_store UUID;
  suite_agents UUID;
  suite_scheduling UUID;
  suite_review UUID;
  suite_contacts UUID;
  suite_episodes UUID;
  suite_toolchain UUID;
  suite_long UUID;
BEGIN
  SELECT id INTO suite_memory FROM qa_test_suites WHERE name = 'Multi-Turn Memory Flow';
  SELECT id INTO suite_store FROM qa_test_suites WHERE name = 'Multi-Turn Store CRUD';
  SELECT id INTO suite_agents FROM qa_test_suites WHERE name = 'Multi-Turn Agent Delegation';
  SELECT id INTO suite_scheduling FROM qa_test_suites WHERE name = 'Multi-Turn Scheduling';
  SELECT id INTO suite_review FROM qa_test_suites WHERE name = 'Multi-Turn Review Queue';
  SELECT id INTO suite_contacts FROM qa_test_suites WHERE name = 'Multi-Turn Contact Management';
  SELECT id INTO suite_episodes FROM qa_test_suites WHERE name = 'Multi-Turn Episode & Fact Learning';
  SELECT id INTO suite_toolchain FROM qa_test_suites WHERE name = 'Multi-Turn Tool Chain';
  SELECT id INTO suite_long FROM qa_test_suites WHERE name = 'Long Conversation Test';

  -- ── Multi-Turn Memory Flow ──

  -- Case 1: Store then recall
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_memory, 'Store then recall preference', 'Store a preference in turn 1, recall it in turn 2',
    'multi-turn', 'multi-turn', 2,
    '[
      {"role": "user", "message": "Remember that my favorite programming language is Rust. I really love its type system and memory safety.", "expected_tools": ["memory_store"], "description": "Store preference"},
      {"role": "user", "message": "What is my favorite programming language and why do I like it?", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)rust", "(?i)(type system|memory safety)"], "description": "Recall preference"}
    ]'::jsonb,
    ARRAY['memory_store', 'memory_search'], 0.6, 1);

  -- Case 2: Preference learn and apply
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_memory, 'Learn and apply preference', 'Learn a communication preference and apply it',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "I prefer very concise, bullet-point style responses. No fluff please.", "expected_tools": ["memory_store"], "description": "State preference"},
      {"role": "user", "message": "Tell me about the benefits of TypeScript", "description": "Agent should apply concise style"},
      {"role": "user", "message": "Did you remember my communication preference?", "expected_tools": ["memory_search"], "description": "Verify preference retention"}
    ]'::jsonb,
    ARRAY['memory_store'], 0.5, 2);

  -- Case 3: Pronoun context resolution
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_memory, 'Pronoun context resolution', 'Test that agent resolves pronouns from earlier turns',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "I have a meeting with Sarah tomorrow at 3pm about the Q4 budget.", "description": "Set context with names and details"},
      {"role": "user", "message": "Can you remind me about it?", "expected_content_patterns": ["(?i)sarah", "(?i)(3\\s*pm|15:00)", "(?i)(budget|Q4)"], "description": "Pronoun resolution - it refers to meeting"},
      {"role": "user", "message": "What time was that again?", "expected_content_patterns": ["(?i)(3\\s*pm|15:00)"], "description": "Continued pronoun resolution"}
    ]'::jsonb,
    ARRAY[]::text[], 0.6, 3);

  -- Case 4: Error correction across turns
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_memory, 'Error correction across turns', 'User corrects information, agent updates understanding',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "Remember that my birthday is on March 15th.", "expected_tools": ["memory_store"], "description": "Store initial fact"},
      {"role": "user", "message": "Actually, I made a mistake. My birthday is on March 25th, not the 15th.", "expected_tools": ["memory_store"], "description": "Correct the fact"},
      {"role": "user", "message": "When is my birthday?", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)march 25"], "unexpected_tools": [], "description": "Verify corrected fact"}
    ]'::jsonb,
    ARRAY['memory_store', 'memory_search'], 0.6, 4);

  -- ── Multi-Turn Store CRUD ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_store, 'Store CRUD lifecycle', 'Create, query, update, search, and verify a knowledge store object',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "Create a new entry in the knowledge store: Project Alpha is a machine learning pipeline project, status is active, team lead is Sarah Chen, budget is $150k.", "expected_tools": ["store_upsert"], "description": "Create store object"},
      {"role": "user", "message": "What do we have stored about Project Alpha?", "expected_tools": ["store_query"], "expected_content_patterns": ["(?i)alpha", "(?i)sarah"], "description": "Query the object"},
      {"role": "user", "message": "Update Project Alpha - the budget has been increased to $200k and add a note that phase 1 is complete.", "expected_tools": ["store_upsert"], "description": "Update the object"},
      {"role": "user", "message": "Search the store for all active projects", "expected_tools": ["store_query"], "description": "Search by attribute"},
      {"role": "user", "message": "Delete the Project Alpha entry from the store", "expected_tools": ["store_delete"], "description": "Delete the object"}
    ]'::jsonb,
    ARRAY['store_upsert', 'store_query', 'store_delete'], 0.5, 1);

  -- ── Multi-Turn Agent Delegation ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_agents, 'Discover and delegate', 'Discover available agents, delegate a task, follow up on result',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "What specialized agents do you have available?", "description": "Discover agents"},
      {"role": "user", "message": "Can you ask the scout agent to find information about recent AI developments?", "expected_tools": ["spawn_agent"], "description": "Delegate to agent"},
      {"role": "user", "message": "What did the scout find?", "description": "Follow up on delegation result"}
    ]'::jsonb,
    ARRAY['spawn_agent'], 0.5, 1);

  -- ── Multi-Turn Scheduling ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_scheduling, 'Schedule lifecycle', 'Create schedules, list them, modify, and verify',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "Create a daily reminder at 9 AM to check my emails. Use cron expression.", "expected_tools": ["schedule_create"], "description": "Create recurring schedule"},
      {"role": "user", "message": "Also set a one-time reminder for tomorrow at 2 PM to call the dentist.", "expected_tools": ["schedule_create"], "description": "Create one-shot schedule"},
      {"role": "user", "message": "List all my scheduled tasks.", "expected_tools": ["schedule_list"], "description": "List schedules"},
      {"role": "user", "message": "Disable the daily email check reminder.", "expected_tools": ["schedule_manage"], "description": "Modify schedule"},
      {"role": "user", "message": "Show me my schedules again to confirm the change.", "expected_tools": ["schedule_list"], "description": "Verify modification"}
    ]'::jsonb,
    ARRAY['schedule_create', 'schedule_list', 'schedule_manage'], 0.5, 1);

  -- ── Multi-Turn Review Queue ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_review, 'Review queue workflow', 'Create a review item, check status, list pending reviews',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "I need you to create a review item for approving the Q1 marketing budget of $50,000. It needs human sign-off before proceeding.", "expected_tools": ["review_request"], "description": "Create approval review"},
      {"role": "user", "message": "What is the status of that review I just created?", "expected_tools": ["review_status"], "description": "Check review status"},
      {"role": "user", "message": "List all pending review items.", "expected_tools": ["review_status"], "description": "List all pending"}
    ]'::jsonb,
    ARRAY['review_request', 'review_status'], 0.5, 1);

  -- ── Multi-Turn Contact Management ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_contacts, 'Contact search and enrich', 'Search contacts, check interactions, enrich data, verify',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "Search my contacts for anyone named Marcus.", "expected_tools": ["contacts_search"], "description": "Search contacts"},
      {"role": "user", "message": "What interactions have I had with the first contact you found?", "expected_tools": ["contacts_interactions"], "description": "Check interactions"},
      {"role": "user", "message": "Remember that Marcus works at Anthropic as a software engineer.", "expected_tools": ["memory_store"], "description": "Enrich with fact"},
      {"role": "user", "message": "Now search my contacts for Marcus again and tell me what we know about him.", "expected_tools": ["contacts_search"], "description": "Verify enrichment"},
      {"role": "user", "message": "Search my memories for anything about Marcus.", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)(anthropic|software engineer)"], "description": "Cross-check memory"}
    ]'::jsonb,
    ARRAY['contacts_search', 'memory_store', 'memory_search'], 0.5, 1);

  -- ── Multi-Turn Episode & Fact Learning ──

  -- Case 1: Extended conversation for episode
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_episodes, 'Extended conversation episode', 'A 7-turn conversation that should generate an episode summary',
    'multi-turn', 'multi-turn', 7,
    '[
      {"role": "user", "message": "I want to plan a new feature for our app. It is a notification system.", "description": "Start planning session"},
      {"role": "user", "message": "The notifications should support email, push, and in-app channels.", "description": "Add requirements"},
      {"role": "user", "message": "We need priority levels: urgent, normal, and low. Urgent ones should be real-time push.", "description": "Priority details"},
      {"role": "user", "message": "Users should be able to configure their preferences per channel.", "description": "User preferences"},
      {"role": "user", "message": "We should also add a digest mode that batches low-priority notifications into a daily summary.", "description": "Digest feature"},
      {"role": "user", "message": "Can you summarize what we have discussed so far about this notification system?", "expected_content_patterns": ["(?i)notification", "(?i)(email|push|in-app)", "(?i)(urgent|priority)", "(?i)digest"], "description": "Summary request"},
      {"role": "user", "message": "Please store this planning session as an episode in your memory.", "expected_tools": ["memory_store"], "description": "Store as episode"}
    ]'::jsonb,
    ARRAY['memory_store'], 0.5, 1);

  -- Case 2: Implicit fact learning
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_episodes, 'Implicit fact learning', 'Agent should pick up on facts mentioned casually and store them',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "I just got back from Vienna. The weather was amazing - 25 degrees and sunny.", "description": "Casual mention of travel"},
      {"role": "user", "message": "My brother Thomas picked me up from the airport. He just got a new Tesla Model 3.", "description": "Mention family and details"},
      {"role": "user", "message": "We went to our favorite restaurant, Steirereck. Had the best Tafelspitz.", "description": "Mention restaurant preference"},
      {"role": "user", "message": "Can you remember the key things from what I just told you?", "expected_tools": ["memory_store"], "description": "Prompt to remember"},
      {"role": "user", "message": "What do you know about my brother?", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)thomas"], "description": "Verify recall"}
    ]'::jsonb,
    ARRAY['memory_store', 'memory_search'], 0.5, 2);

  -- ── Multi-Turn Tool Chain ──

  -- Case 1: Calendar + tasks chain
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_toolchain, 'Calendar and tasks chain', 'Cross-tool workflow: check calendar, create tasks, set reminders',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "What is on my calendar for today?", "expected_tools": ["calendar_list_events"], "description": "Check calendar"},
      {"role": "user", "message": "Create a task to prepare for my first meeting today.", "expected_tools": ["things_create_task"], "description": "Create related task"},
      {"role": "user", "message": "What time does my first meeting start?", "expected_content_patterns": ["\\d{1,2}[:\\.]\\d{2}"], "description": "Reference calendar data"},
      {"role": "user", "message": "Set a reminder 30 minutes before that meeting.", "expected_tools": ["schedule_create"], "description": "Create reminder from context"},
      {"role": "user", "message": "List all the tasks and reminders you just created for me.", "expected_tools": ["schedule_list"], "description": "Verify all created items"}
    ]'::jsonb,
    ARRAY['calendar_list_events', 'things_create_task', 'schedule_create'], 0.4, 1);

  -- Case 2: Mixed model routing
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_toolchain, 'Mixed complexity routing', 'Test that simple and complex turns use appropriate models',
    'multi-turn', 'multi-turn', 5,
    '[
      {"role": "user", "message": "Hi, how are you?", "unexpected_tools": ["memory_search", "memory_store", "document_search"], "description": "Simple greeting - should use cheap model, no tools"},
      {"role": "user", "message": "Search my memories for any project deadlines coming up this month.", "expected_tools": ["memory_search"], "description": "Tool-heavy query - needs capable model"},
      {"role": "user", "message": "Thanks!", "unexpected_tools": ["memory_search", "memory_store"], "description": "Simple acknowledgment - cheap model"},
      {"role": "user", "message": "Analyze the results and create a summary document of all upcoming deadlines, organized by priority.", "expected_tools": ["memory_store"], "description": "Complex analysis - needs capable model"},
      {"role": "user", "message": "Got it, sounds good.", "unexpected_tools": ["memory_search", "memory_store"], "description": "Simple response - cheap model"}
    ]'::jsonb,
    ARRAY[]::text[], 0.4, 2);

  -- ── Long Conversation Test ──

  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_long, 'Party planning marathon', '12-turn party planning with full context retention across all turns',
    'multi-turn', 'multi-turn', 12,
    '[
      {"role": "user", "message": "I want to plan a birthday party for my wife Anna. Her birthday is March 15th.", "description": "Start planning"},
      {"role": "user", "message": "She loves Italian food and jazz music. The party should have a sophisticated vibe.", "description": "Set preferences"},
      {"role": "user", "message": "We want to invite about 30 people. Budget is around 5000 euros.", "description": "Set constraints"},
      {"role": "user", "message": "Can you suggest a good venue? Maybe a restaurant with a private room.", "description": "Venue discussion"},
      {"role": "user", "message": "I like the restaurant idea. We should also hire a small jazz trio for live music.", "description": "Entertainment"},
      {"role": "user", "message": "For the menu, let us do a 4-course Italian dinner with wine pairing.", "description": "Menu planning"},
      {"role": "user", "message": "We need to send invitations. Can you help me draft one?", "expected_content_patterns": ["(?i)anna", "(?i)(march 15|birthday)"], "description": "Invitation draft - should reference Anna and date"},
      {"role": "user", "message": "What is our total estimated budget breakdown so far?", "expected_content_patterns": ["(?i)(5.?000|budget|euro)"], "description": "Budget check - should reference 5000 euro budget"},
      {"role": "user", "message": "Actually, let us increase the budget to 6000 euros. I want to add a custom cake.", "description": "Budget update"},
      {"role": "user", "message": "Remember all these party planning details for me.", "expected_tools": ["memory_store"], "description": "Store planning details"},
      {"role": "user", "message": "Give me a complete summary of the party plan.", "expected_content_patterns": ["(?i)anna", "(?i)italian", "(?i)jazz", "(?i)30", "(?i)6.?000"], "description": "Full summary - must retain ALL details"},
      {"role": "user", "message": "How many people are we inviting and what is the per-person budget?", "expected_content_patterns": ["(?i)30", "(?i)200"], "description": "Math check: 6000/30 = 200 per person"}
    ]'::jsonb,
    ARRAY['memory_store'], 0.5, 1);

  -- ── Additional multi-turn cases for variety ──

  -- Memory: Cross-area search
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_memory, 'Cross-area memory search', 'Store in different areas, then search across all',
    'multi-turn', 'multi-turn', 4,
    '[
      {"role": "user", "message": "Remember that I am allergic to shellfish. This is important health information about my identity.", "expected_tools": ["memory_store"], "description": "Store identity fact"},
      {"role": "user", "message": "Also store a solution: when dealing with API rate limits, implement exponential backoff with jitter.", "expected_tools": ["memory_store"], "description": "Store solution"},
      {"role": "user", "message": "Search all my memories for anything related to health.", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)(shellfish|allerg)"], "description": "Cross-area search"},
      {"role": "user", "message": "Now search for anything about API rate limits.", "expected_tools": ["memory_search"], "expected_content_patterns": ["(?i)(exponential backoff|jitter)"], "description": "Second cross-area search"}
    ]'::jsonb,
    ARRAY['memory_store', 'memory_search'], 0.5, 5);

  -- Scheduling: Complex schedule with timezone
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_scheduling, 'Timezone-aware scheduling', 'Create schedules with timezone considerations',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "Create a recurring check-in every Monday at 9 AM Vienna time.", "expected_tools": ["schedule_create"], "description": "Create with timezone"},
      {"role": "user", "message": "What time would that be in UTC?", "description": "Timezone conversion"},
      {"role": "user", "message": "List my schedules to confirm it was created correctly.", "expected_tools": ["schedule_list"], "description": "Verify creation"}
    ]'::jsonb,
    ARRAY['schedule_create', 'schedule_list'], 0.5, 2);

  -- Review: Batch reviews
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_review, 'Batch review creation', 'Create multiple related review items and check them',
    'multi-turn', 'multi-turn', 4,
    '[
      {"role": "user", "message": "I need to create 2 review items for expense approvals. First one: office supplies purchase for $250.", "expected_tools": ["review_request"], "description": "Create first review"},
      {"role": "user", "message": "Second one: software subscription renewal for $1200 per year.", "expected_tools": ["review_request"], "description": "Create second review"},
      {"role": "user", "message": "How many pending reviews do I have now?", "expected_tools": ["review_status"], "description": "Count pending"},
      {"role": "user", "message": "Show me all the review items you just created.", "expected_tools": ["review_status"], "description": "List all created"}
    ]'::jsonb,
    ARRAY['review_request', 'review_status'], 0.5, 2);

  -- Toolchain: Document search then store
  INSERT INTO qa_test_cases (suite_id, name, description, input_message, category, turn_count, turns,
    expected_tools, min_quality_score, sort_order)
  VALUES (suite_toolchain, 'Search and synthesize', 'Search documents, then store a synthesis in memory',
    'multi-turn', 'multi-turn', 3,
    '[
      {"role": "user", "message": "Search my documents for anything about deployment processes.", "expected_tools": ["document_search"], "description": "Search documents"},
      {"role": "user", "message": "Summarize what you found and store it as a knowledge memory.", "expected_tools": ["memory_store"], "description": "Synthesize and store"},
      {"role": "user", "message": "Now search my memories for deployment information to verify it was stored.", "expected_tools": ["memory_search"], "description": "Verify storage"}
    ]'::jsonb,
    ARRAY['document_search', 'memory_store', 'memory_search'], 0.4, 3);

END $$;

COMMIT;
