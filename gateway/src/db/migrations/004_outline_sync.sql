-- Outline <-> Obsidian two-way sync state tracking
CREATE TABLE IF NOT EXISTS outline_sync_state (
  outline_id          TEXT PRIMARY KEY,
  collection_id       TEXT,
  collection_name     TEXT,
  obsidian_path       TEXT NOT NULL,
  outline_content_hash TEXT,
  obsidian_content_hash TEXT,
  outline_updated_at  TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'synced',  -- synced | conflicted | deleted
  conflict_detected_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outline_sync_status ON outline_sync_state(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outline_sync_path ON outline_sync_state(obsidian_path);
CREATE INDEX IF NOT EXISTS idx_outline_sync_collection ON outline_sync_state(collection_id);
