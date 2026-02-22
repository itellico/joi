-- Add display_name and error_message to channel_configs

ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS error_message TEXT;
