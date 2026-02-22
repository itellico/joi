-- Media storage: downloaded files from channel messages

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  channel_type TEXT,
  channel_id TEXT,
  sender_id TEXT,
  media_type TEXT NOT NULL,  -- photo/video/audio/document/sticker/voice/unknown
  filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT,
  width INT,
  height INT,
  duration_seconds FLOAT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','downloading','ready','error','deleted')),
  error_message TEXT,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_message_id ON media(message_id);
CREATE INDEX IF NOT EXISTS idx_media_conversation_id ON media(conversation_id);
CREATE INDEX IF NOT EXISTS idx_media_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_channel_type ON media(channel_type);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);

-- Full-text search on filename + caption
ALTER TABLE media ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', COALESCE(filename, '') || ' ' || COALESCE(caption, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_media_fts ON media USING gin(fts);
