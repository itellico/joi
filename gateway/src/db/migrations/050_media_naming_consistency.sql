-- Normalize legacy media naming (MB/Cell) to canonical Emby/Jellyseerr labels.

-- Keep tool metadata and agent prompt wording consistent.
UPDATE skills_registry
SET description = 'List configured Emby servers available to JOI.',
    updated_at = NOW()
WHERE name = 'emby_servers';

UPDATE agents
SET system_prompt = REPLACE(
      system_prompt,
      'across MB (Emby) and Jellyseerr integrations.',
      'across Emby and Jellyseerr integrations.'
    ),
    updated_at = NOW()
WHERE id = 'media-integrations'
  AND system_prompt LIKE '%MB (Emby)%';

-- Backfill canonical display names when legacy labels are still in use.
UPDATE channel_configs
SET display_name = 'Emby',
    updated_at = NOW()
WHERE id = 'emby'
  AND (display_name IS NULL OR btrim(display_name) = '' OR lower(display_name) = 'mb');

UPDATE channel_configs
SET display_name = 'Jellyseerr',
    updated_at = NOW()
WHERE id = 'jellyseerr'
  AND (display_name IS NULL OR btrim(display_name) = '' OR lower(display_name) IN ('cell', 'jellyseer'));

-- Rewrite legacy channel references to canonical IDs.
UPDATE conversations SET channel_id = 'emby' WHERE channel_id = 'mb';
UPDATE messages SET channel_id = 'emby' WHERE channel_id = 'mb';
UPDATE media SET channel_id = 'emby' WHERE channel_id = 'mb';
UPDATE memories SET channel_id = 'emby' WHERE channel_id = 'mb';
UPDATE conversations
SET session_key = regexp_replace(session_key, '^mb:', 'emby:')
WHERE session_key LIKE 'mb:%';

UPDATE conversations SET channel_id = 'jellyseerr' WHERE channel_id = 'cell';
UPDATE messages SET channel_id = 'jellyseerr' WHERE channel_id = 'cell';
UPDATE media SET channel_id = 'jellyseerr' WHERE channel_id = 'cell';
UPDATE memories SET channel_id = 'jellyseerr' WHERE channel_id = 'cell';
UPDATE conversations
SET session_key = regexp_replace(session_key, '^cell:', 'jellyseerr:')
WHERE session_key LIKE 'cell:%';

-- Rename legacy channel_config IDs when canonical rows are missing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channel_configs WHERE id = 'mb')
     AND NOT EXISTS (SELECT 1 FROM channel_configs WHERE id = 'emby') THEN
    UPDATE channel_configs
    SET id = 'emby',
        channel_type = 'emby',
        display_name = COALESCE(NULLIF(display_name, ''), 'Emby'),
        updated_at = NOW()
    WHERE id = 'mb';
  END IF;

  IF EXISTS (SELECT 1 FROM channel_configs WHERE id = 'cell')
     AND NOT EXISTS (SELECT 1 FROM channel_configs WHERE id = 'jellyseerr') THEN
    UPDATE channel_configs
    SET id = 'jellyseerr',
        channel_type = 'jellyseerr',
        display_name = COALESCE(NULLIF(display_name, ''), 'Jellyseerr'),
        updated_at = NOW()
    WHERE id = 'cell';
  END IF;
END $$;

-- If both legacy + canonical rows exist, keep canonical rows only.
DELETE FROM channel_configs
WHERE id = 'mb'
  AND EXISTS (SELECT 1 FROM channel_configs c2 WHERE c2.id = 'emby');

DELETE FROM channel_configs
WHERE id = 'cell'
  AND EXISTS (SELECT 1 FROM channel_configs c2 WHERE c2.id = 'jellyseerr');

-- Normalize any stale channel_type values.
UPDATE channel_configs SET channel_type = 'emby', updated_at = NOW() WHERE channel_type = 'mb';
UPDATE channel_configs SET channel_type = 'jellyseerr', updated_at = NOW() WHERE channel_type = 'cell';
