-- Push notification tokens and delivery log
-- Supports APNs (iOS/macOS/watchOS) with device tracking

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios', -- ios, macos, watchos
  device_name TEXT,
  app_version TEXT,
  environment TEXT NOT NULL DEFAULT 'development', -- development, production
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- review.created, agent.completed, channel.message, etc.
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}',
  device_token TEXT,
  apns_id TEXT, -- APNs response ID
  status TEXT NOT NULL DEFAULT 'sent', -- sent, delivered, failed
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_log_created ON notification_log (created_at DESC);
CREATE INDEX idx_notification_log_event ON notification_log (event_type);
CREATE INDEX idx_push_tokens_enabled ON push_tokens (enabled) WHERE enabled = true;
