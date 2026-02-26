-- Add snapshot storage for three-way merge sync
-- The snapshot records what Chrome looked like at last sync,
-- so we can diff both sides and merge properly.

ALTER TABLE bookmark_sync_state
  ADD COLUMN IF NOT EXISTS chrome_snapshot JSONB DEFAULT '{}';

-- Track JOI-side edits since last sync
ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS sync_dirty BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bookmarks_sync_dirty ON bookmarks(sync_dirty) WHERE sync_dirty = TRUE;
CREATE INDEX IF NOT EXISTS idx_bookmarks_chrome_id ON bookmarks(chrome_id);
