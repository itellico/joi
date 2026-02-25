-- Bookmarks: synced from Chrome, managed by JOI agents
-- Bidirectional sync with Chrome's Bookmarks JSON file

CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chrome_id TEXT,                          -- Chrome's internal bookmark ID
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  folder_path TEXT NOT NULL DEFAULT '/',   -- e.g. "/Dev/React" or "/Read Later"
  description TEXT,                        -- AI-generated summary or user note
  tags TEXT[] DEFAULT '{}',
  favicon_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active, archived, read_later, suggested
  source TEXT NOT NULL DEFAULT 'chrome',   -- chrome, agent, manual
  suggested_by TEXT,                       -- agent ID if source = 'agent'
  suggestion_action TEXT,                  -- add, move, delete, organize (for review)
  suggestion_reason TEXT,                  -- why agent suggested this
  read_at TIMESTAMPTZ,                     -- when user "read" the bookmark
  domain TEXT,                             -- extracted hostname for grouping
  url_clean TEXT,                          -- URL without tracking params
  content_hash TEXT,                       -- hash of clean URL for dedup
  chrome_date_added TEXT,                  -- Chrome's date_added field
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder_path);
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
CREATE INDEX IF NOT EXISTS idx_bookmarks_domain ON bookmarks(domain);
CREATE INDEX IF NOT EXISTS idx_bookmarks_hash ON bookmarks(content_hash);
CREATE INDEX IF NOT EXISTS idx_bookmarks_source ON bookmarks(source);
CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);

CREATE TABLE IF NOT EXISTS bookmark_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'chrome',
  profile_path TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_checksum TEXT,                      -- Chrome file checksum to detect changes
  bookmarks_count INTEGER DEFAULT 0,
  sync_direction TEXT DEFAULT 'bidirectional', -- pull, push, bidirectional
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default sync state for Chrome Profile 5
INSERT INTO bookmark_sync_state (id, profile_path)
VALUES ('chrome', '/Users/mm2/Library/Application Support/Google/Chrome/Profile 5/Bookmarks')
ON CONFLICT (id) DO NOTHING;
