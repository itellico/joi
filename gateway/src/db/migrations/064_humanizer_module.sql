-- Humanizer module: DB-driven filler/announcement templates + profile + audit events

CREATE TABLE IF NOT EXISTS humanizer_profiles (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  avoid_repeat_window INT NOT NULL DEFAULT 6 CHECK (avoid_repeat_window >= 0 AND avoid_repeat_window <= 50),
  emoji_probability NUMERIC(5,4) NOT NULL DEFAULT 0.35 CHECK (emoji_probability >= 0 AND emoji_probability <= 1),
  allow_emojis_in_chat BOOLEAN NOT NULL DEFAULT true,
  max_emojis INT NOT NULL DEFAULT 1 CHECK (max_emojis >= 0 AND max_emojis <= 5),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS humanizer_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'tool_announcement',
    'pre_tool_start',
    'pre_tool_progress',
    'tool_start',
    'tool_progress',
    'tool_long',
    'chat_streaming'
  )),
  channel TEXT NOT NULL DEFAULT 'any' CHECK (channel IN ('any', 'voice', 'chat')),
  language TEXT NOT NULL DEFAULT 'en',
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  skill_name TEXT,
  tool_pattern TEXT,
  template TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 100 CHECK (weight > 0),
  allow_emoji BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_humanizer_templates_unique
  ON humanizer_templates (
    stage,
    channel,
    language,
    COALESCE(agent_id, ''),
    COALESCE(skill_name, ''),
    COALESCE(tool_pattern, ''),
    template
  );

CREATE INDEX IF NOT EXISTS idx_humanizer_templates_lookup
  ON humanizer_templates (enabled, stage, channel, language, agent_id);

CREATE TABLE IF NOT EXISTS humanizer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('selection', 'audit')),
  conversation_id TEXT,
  agent_id TEXT,
  skill_name TEXT,
  tool_name TEXT,
  channel TEXT,
  stage TEXT,
  language TEXT,
  template_id UUID REFERENCES humanizer_templates(id) ON DELETE SET NULL,
  output_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_humanizer_events_created_at ON humanizer_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_humanizer_events_type ON humanizer_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_humanizer_events_stage ON humanizer_events(stage, created_at DESC);

INSERT INTO humanizer_profiles (
  id,
  enabled,
  avoid_repeat_window,
  emoji_probability,
  allow_emojis_in_chat,
  max_emojis,
  config
)
VALUES (
  'default',
  true,
  6,
  0.35,
  true,
  1,
  jsonb_build_object(
    'description', 'Global profile for DB-driven humanization',
    'seeded_at', NOW()
  )
)
ON CONFLICT (id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  avoid_repeat_window = EXCLUDED.avoid_repeat_window,
  emoji_probability = EXCLUDED.emoji_probability,
  allow_emojis_in_chat = EXCLUDED.allow_emojis_in_chat,
  max_emojis = EXCLUDED.max_emojis,
  config = humanizer_profiles.config || EXCLUDED.config,
  updated_at = NOW();

-- Chat tool announcements + text streaming variants (EN/DE)
INSERT INTO humanizer_templates (name, stage, channel, language, tool_pattern, template, weight, allow_emoji, metadata)
VALUES
  ('chat-calendar-en-1', 'tool_announcement', 'chat', 'en', '(calendar|event|schedule)', 'Checking your calendar now{emoji}', 120, true, '{"emojis": ["📅", "📆", "⏱️"]}'::jsonb),
  ('chat-calendar-en-2', 'tool_announcement', 'chat', 'en', '(calendar|event|schedule)', 'Let me pull your schedule details{emoji}', 110, true, '{"emojis": ["📅", "⏳"]}'::jsonb),
  ('chat-mail-en-1', 'tool_announcement', 'chat', 'en', '(gmail|email|inbox|mail)', 'Checking your inbox now{emoji}', 120, true, '{"emojis": ["📬", "📨", "🔎"]}'::jsonb),
  ('chat-mail-en-2', 'tool_announcement', 'chat', 'en', '(gmail|email|inbox|mail)', 'Reviewing your latest messages now{emoji}', 105, true, '{"emojis": ["📬", "⏳"]}'::jsonb),
  ('chat-task-en-1', 'tool_announcement', 'chat', 'en', '(task|todo|things|okr)', 'Checking your task list now{emoji}', 120, true, '{"emojis": ["📋", "✅"]}'::jsonb),
  ('chat-contact-en-1', 'tool_announcement', 'chat', 'en', '(contact|person|people)', 'Looking up that contact now{emoji}', 120, true, '{"emojis": ["👥", "🔎"]}'::jsonb),
  ('chat-search-en-1', 'tool_announcement', 'chat', 'en', '(memory|knowledge|search|lookup|find)', 'Looking that up now{emoji}', 115, true, '{"emojis": ["🔎", "🧠"]}'::jsonb),
  ('chat-message-en-1', 'tool_announcement', 'chat', 'en', '(channel_send|whatsapp|telegram|imessage|sms|message)', 'Preparing that message now{emoji}', 115, true, '{"emojis": ["💬", "✉️"]}'::jsonb),
  ('chat-media-en-1', 'tool_announcement', 'chat', 'en', '(emby|jellyseerr|movie|series|watchlist)', 'Checking your media library now{emoji}', 130, true, '{"emojis": ["🎬", "📺", "🍿"]}'::jsonb),
  ('chat-code-en-1', 'tool_announcement', 'chat', 'en', '(code|autodev|terminal|shell|command|git)', 'Running that task now{emoji}', 110, true, '{"emojis": ["🛠️", "⌛"]}'::jsonb),
  ('chat-generic-en-1', 'tool_announcement', 'chat', 'en', NULL, 'Working on that now{emoji}', 90, true, '{"emojis": ["🤝", "✨", "⏳"]}'::jsonb),

  ('chat-calendar-de-1', 'tool_announcement', 'chat', 'de', '(calendar|event|schedule)', 'Ich pruefe jetzt deinen Kalender{emoji}', 120, true, '{"emojis": ["📅", "📆"]}'::jsonb),
  ('chat-mail-de-1', 'tool_announcement', 'chat', 'de', '(gmail|email|inbox|mail)', 'Ich pruefe jetzt dein Postfach{emoji}', 120, true, '{"emojis": ["📬", "🔎"]}'::jsonb),
  ('chat-task-de-1', 'tool_announcement', 'chat', 'de', '(task|todo|things|okr)', 'Ich pruefe jetzt deine Aufgabenliste{emoji}', 120, true, '{"emojis": ["📋", "✅"]}'::jsonb),
  ('chat-contact-de-1', 'tool_announcement', 'chat', 'de', '(contact|person|people)', 'Ich suche jetzt diesen Kontakt{emoji}', 120, true, '{"emojis": ["👥", "🔎"]}'::jsonb),
  ('chat-search-de-1', 'tool_announcement', 'chat', 'de', '(memory|knowledge|search|lookup|find)', 'Ich suche das jetzt nach{emoji}', 115, true, '{"emojis": ["🔎", "🧠"]}'::jsonb),
  ('chat-message-de-1', 'tool_announcement', 'chat', 'de', '(channel_send|whatsapp|telegram|imessage|sms|message)', 'Ich bereite jetzt diese Nachricht vor{emoji}', 115, true, '{"emojis": ["💬", "✉️"]}'::jsonb),
  ('chat-media-de-1', 'tool_announcement', 'chat', 'de', '(emby|jellyseerr|movie|series|watchlist)', 'Ich pruefe jetzt deine Mediathek{emoji}', 130, true, '{"emojis": ["🎬", "📺", "🍿"]}'::jsonb),
  ('chat-code-de-1', 'tool_announcement', 'chat', 'de', '(code|autodev|terminal|shell|command|git)', 'Ich fuehre jetzt diese Aufgabe aus{emoji}', 110, true, '{"emojis": ["🛠️", "⌛"]}'::jsonb),
  ('chat-generic-de-1', 'tool_announcement', 'chat', 'de', NULL, 'Ich arbeite jetzt daran{emoji}', 90, true, '{"emojis": ["✨", "⏳", "🤝"]}'::jsonb),

  ('chat-streaming-en-1', 'chat_streaming', 'chat', 'en', NULL, 'On it, pulling context now{emoji}', 110, true, '{"emojis": ["🔎", "✨", "⏳"]}'::jsonb),
  ('chat-streaming-en-2', 'chat_streaming', 'chat', 'en', NULL, 'Routing this through your tools and memory{emoji}', 100, true, '{"emojis": ["🧠", "📡", "📚"]}'::jsonb),
  ('chat-streaming-de-1', 'chat_streaming', 'chat', 'de', NULL, 'Alles klar, ich hole den Kontext{emoji}', 110, true, '{"emojis": ["🔎", "✨", "⏳"]}'::jsonb),
  ('chat-streaming-de-2', 'chat_streaming', 'chat', 'de', NULL, 'Ich route das jetzt ueber Tools und Memory{emoji}', 100, true, '{"emojis": ["🧠", "📡", "📚"]}'::jsonb),

  ('voice-pre-start-en-1', 'pre_tool_start', 'voice', 'en', NULL, 'On it, I am starting your check now.', 120, false, '{}'::jsonb),
  ('voice-pre-start-en-2', 'pre_tool_start', 'voice', 'en', NULL, 'Give me a second, I am preparing this now.', 110, false, '{}'::jsonb),
  ('voice-pre-progress-en-1', 'pre_tool_progress', 'voice', 'en', NULL, 'Still on it. I am checking cached context first, then fresh data.', 120, false, '{}'::jsonb),
  ('voice-pre-progress-en-2', 'pre_tool_progress', 'voice', 'en', NULL, 'Thanks for waiting. I am still processing your request.', 100, false, '{}'::jsonb),

  ('voice-tool-start-en-1', 'tool_start', 'voice', 'en', NULL, 'One moment while I work on {hint}.', 120, false, '{}'::jsonb),
  ('voice-tool-start-en-2', 'tool_start', 'voice', 'en', NULL, 'I am handling that now.', 100, false, '{}'::jsonb),
  ('voice-tool-progress-en-1', 'tool_progress', 'voice', 'en', NULL, 'Still on it. I am validating details for {hint}.', 120, false, '{}'::jsonb),
  ('voice-tool-progress-en-2', 'tool_progress', 'voice', 'en', NULL, 'This is taking a bit longer, but I am still working on it.', 100, false, '{}'::jsonb),
  ('voice-tool-long-en-1', 'tool_long', 'voice', 'en', NULL, 'Thanks for waiting. I am finishing the final step now.', 120, false, '{}'::jsonb),
  ('voice-tool-long-en-2', 'tool_long', 'voice', 'en', NULL, 'Still working on {hint}. I am almost there.', 100, false, '{}'::jsonb),

  ('voice-pre-start-de-1', 'pre_tool_start', 'voice', 'de', NULL, 'Alles klar, ich starte den Check jetzt.', 120, false, '{}'::jsonb),
  ('voice-pre-start-de-2', 'pre_tool_start', 'voice', 'de', NULL, 'Sekunde, ich bereite das gerade vor.', 110, false, '{}'::jsonb),
  ('voice-pre-progress-de-1', 'pre_tool_progress', 'voice', 'de', NULL, 'Ich bin noch dran und pruefe erst den Cache, dann frische Daten.', 120, false, '{}'::jsonb),
  ('voice-pre-progress-de-2', 'pre_tool_progress', 'voice', 'de', NULL, 'Danke fuers Warten, ich bearbeite das noch.', 100, false, '{}'::jsonb),

  ('voice-tool-start-de-1', 'tool_start', 'voice', 'de', NULL, 'Einen Moment, ich kuemmere mich um {hint}.', 120, false, '{}'::jsonb),
  ('voice-tool-start-de-2', 'tool_start', 'voice', 'de', NULL, 'Ich arbeite jetzt daran.', 100, false, '{}'::jsonb),
  ('voice-tool-progress-de-1', 'tool_progress', 'voice', 'de', NULL, 'Ich bin noch dran und validiere die Details zu {hint}.', 120, false, '{}'::jsonb),
  ('voice-tool-progress-de-2', 'tool_progress', 'voice', 'de', NULL, 'Das dauert etwas laenger, ich arbeite aber noch daran.', 100, false, '{}'::jsonb),
  ('voice-tool-long-de-1', 'tool_long', 'voice', 'de', NULL, 'Danke fuers Warten, ich schliesse den letzten Schritt ab.', 120, false, '{}'::jsonb),
  ('voice-tool-long-de-2', 'tool_long', 'voice', 'de', NULL, 'Ich arbeite noch an {hint} und bin gleich fertig.', 100, false, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- Daily humanizer audit
INSERT INTO cron_jobs (
  agent_id,
  name,
  description,
  schedule_kind,
  schedule_cron_expr,
  schedule_cron_tz,
  session_target,
  payload_kind,
  payload_text,
  enabled
)
VALUES (
  'system',
  'daily-humanizer-audit',
  'Daily audit for chat/voice humanizer variation and coverage',
  'cron',
  '20 4 * * *',
  'Europe/Vienna',
  'isolated',
  'system_event',
  'humanizer_audit',
  true
)
ON CONFLICT (name) DO UPDATE SET
  payload_text = EXCLUDED.payload_text,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();
