-- Emby + Jellyseerr skills and dedicated media integration agent

INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('emby_servers', 'List configured Emby servers available to JOI.', 'bundled', true),
  ('emby_library', 'Browse Emby movie/series libraries with pagination and sorting.', 'bundled', true),
  ('emby_search', 'Search Emby library by title.', 'bundled', true),
  ('emby_item_details', 'Get detailed Emby metadata for a single item.', 'bundled', true),
  ('emby_recently_watched', 'Get Emby recently watched items.', 'bundled', true),
  ('emby_continue_watching', 'Get Emby continue-watching queue.', 'bundled', true),
  ('emby_next_up', 'Get Emby next-up episodes.', 'bundled', true),
  ('emby_now_playing', 'Get currently playing Emby sessions.', 'bundled', true),
  ('jellyseerr_servers', 'List configured Jellyseerr servers.', 'bundled', true),
  ('jellyseerr_search', 'Search media in Jellyseerr.', 'bundled', true),
  ('jellyseerr_requests', 'List Jellyseerr media requests.', 'bundled', true),
  ('jellyseerr_request_status', 'Get status for a Jellyseerr request by ID.', 'bundled', true),
  ('jellyseerr_create_request', 'Create a new Jellyseerr media request.', 'bundled', true),
  ('jellyseerr_cancel_request', 'Cancel a Jellyseerr request.', 'bundled', true),
  ('jellyseerr_trending', 'Get Jellyseerr trending/discover media.', 'bundled', true),
  ('jellyseerr_available', 'Check Jellyseerr availability for a TMDB title.', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  source = EXCLUDED.source,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config)
VALUES (
  'media-integrations',
  'Media Integrations',
  'Specialist for Emby + Jellyseerr catalog browsing and request management.',
  $PROMPT$You are JOI's Media Integrations specialist.

Your responsibilities:
1. Browse and audit Emby libraries (movies, series, watch progress, now playing).
2. Search and inspect Jellyseerr requests and statuses.
3. Create/cancel media requests safely when asked.
4. Explain clearly what is happening across Emby and Jellyseerr integrations.

Rules:
- Prefer tool calls over assumptions for media/library facts.
- If a server is not configured, return exactly what is missing (server URL or API key).
- For request operations, always echo request ID and resulting status.
- Keep responses concise and structured.
$PROMPT$,
  'claude-sonnet-4-20250514',
  true,
  ARRAY[
    'emby_servers',
    'emby_library',
    'emby_search',
    'emby_item_details',
    'emby_recently_watched',
    'emby_continue_watching',
    'emby_next_up',
    'emby_now_playing',
    'jellyseerr_servers',
    'jellyseerr_search',
    'jellyseerr_requests',
    'jellyseerr_request_status',
    'jellyseerr_create_request',
    'jellyseerr_cancel_request',
    'jellyseerr_trending',
    'jellyseerr_available'
  ],
  '{"role": "media-integrations", "maxSpawnDepth": 0}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  enabled = EXCLUDED.enabled,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config,
  updated_at = NOW();
