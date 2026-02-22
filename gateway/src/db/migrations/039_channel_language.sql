-- Add per-channel language setting (e.g. "en", "de", "fr")
-- Drives STT language, TTS language, system prompt locale, and triage classification
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
