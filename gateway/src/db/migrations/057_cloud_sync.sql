-- Cloud Sync: provider-agnostic file sync management
-- Supports Google Drive, iCloud (via SFTP), Dropbox, and any rclone-compatible remote

CREATE TABLE IF NOT EXISTS sync_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- local, gdrive, icloud, dropbox, sftp, s3, onedrive
  rclone_remote TEXT,  -- rclone remote name (e.g., "gdrive:", "studio:") — NULL for local
  config JSONB DEFAULT '{}',  -- provider-specific config (sftp host, base path, etc.)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, connected, error
  status_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_provider_id TEXT NOT NULL REFERENCES sync_providers(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  target_provider_id TEXT NOT NULL REFERENCES sync_providers(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'bisync',  -- push, pull, bisync
  schedule TEXT NOT NULL DEFAULT 'manual',   -- manual, 15m, 30m, 1h, 2h, daily
  enabled BOOLEAN DEFAULT true,
  exclude_patterns TEXT[] DEFAULT ARRAY['.DS_Store', '._*', '.Trash', 'Thumbs.db', '.git'],
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,   -- success, error, running
  last_sync_message TEXT,
  files_synced INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES sync_pairs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',  -- running, success, error
  direction TEXT NOT NULL,
  files_transferred INTEGER DEFAULT 0,
  files_deleted INTEGER DEFAULT 0,
  bytes_transferred BIGINT DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_pair ON sync_runs(pair_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_enabled ON sync_pairs(enabled);

-- Seed default local provider for External SSD
INSERT INTO sync_providers (id, name, type, rclone_remote, config, status)
VALUES ('local', 'Local Filesystem', 'local', NULL, '{"description": "Local paths on this Mac"}', 'connected')
ON CONFLICT (id) DO NOTHING;
