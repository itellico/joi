-- Media agent + transcription skills registration

-- Seed transcription skills into skills_registry
INSERT INTO skills_registry (name, description, source, enabled) VALUES
  ('youtube_transcribe', 'Transcribe a YouTube video to text. 3-tier: captions API → yt-dlp subtitles → local mlx-whisper speech-to-text', 'bundled', true),
  ('audio_transcribe', 'Transcribe audio/video files to text using local mlx-whisper on Apple Silicon (MP3, MP4, WAV, M4A, WEBM)', 'bundled', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;

-- Media agent — handles transcription, audio/video processing
INSERT INTO agents (id, name, description, system_prompt, model, enabled, config) VALUES (
  'media',
  'Media',
  'Media processing agent — transcribes YouTube videos and audio files, extracts content from multimedia sources.',
  'You are the Media agent for JOI. You handle all media processing tasks for Marcus.

## Capabilities
- Transcribe YouTube videos (URL or video ID) — uses captions, yt-dlp, or local whisper
- Transcribe local audio/video files (MP3, MP4, WAV, M4A, WEBM) via mlx-whisper
- Summarize video/audio content after transcription
- Extract key points, quotes, and action items from media

## Guidelines
- Always report which transcription method was used (captions, yt-dlp, mlx-whisper)
- For YouTube videos, include the video title and channel when possible
- After transcription, offer to summarize or extract key points
- For long transcripts (>5000 words), provide a structured summary with sections
- Use German locale for dates when presenting to Marcus
- If transcription fails on one tier, the system automatically falls back to the next

## Tools
- youtube_transcribe: For YouTube URLs/IDs — fast 3-tier approach
- audio_transcribe: For local files — mlx-whisper on Apple Silicon

## Output Format
- Start with metadata: method used, language detected, segment count
- Then provide the full transcript or a summary depending on what was requested
- For summaries: use bullet points, group by topic/section, include timestamps for key moments',
  'claude-sonnet-4-20250514',
  true,
  '{"role": "media", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  config = EXCLUDED.config,
  updated_at = NOW();
