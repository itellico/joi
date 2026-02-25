-- Expand Media Integrations skills with person search, cross-source overview,
-- webhook activity visibility, and request summaries.

INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('emby_person_search', 'Search Emby people/person records by name.', 'bundled', true),
  ('emby_person_credits', 'List Emby titles for a person (actor/director/writer).', 'bundled', true),
  ('media_availability_overview', 'Cross-check Emby holdings and Jellyseerr catalog matches for the same query.', 'bundled', true),
  ('media_recent_activity', 'Show recent inbound media webhook activity (Emby/Jellyseerr/Webhook).', 'bundled', true),
  ('jellyseerr_requests_summary', 'Summarize Jellyseerr requests grouped by status.', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  source = EXCLUDED.source,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

UPDATE skills_registry
SET description = 'Search Emby library by title and people filters.'
WHERE name = 'emby_search';

UPDATE skills_registry
SET description = 'List Jellyseerr media requests with status filters and paging.'
WHERE name = 'jellyseerr_requests';

UPDATE agents
SET skills = ARRAY[
      'emby_servers',
      'emby_library',
      'emby_person_search',
      'emby_person_credits',
      'emby_search',
      'emby_item_details',
      'emby_recently_watched',
      'emby_continue_watching',
      'emby_next_up',
      'emby_now_playing',
      'media_availability_overview',
      'media_recent_activity',
      'jellyseerr_servers',
      'jellyseerr_search',
      'jellyseerr_requests',
      'jellyseerr_requests_summary',
      'jellyseerr_request_status',
      'jellyseerr_create_request',
      'jellyseerr_cancel_request',
      'jellyseerr_trending',
      'jellyseerr_available'
    ],
    description = 'Specialist for Emby + Jellyseerr catalog browsing, webhook activity, and request management.',
    updated_at = NOW()
WHERE id = 'media-integrations';
