-- General-purpose Gmail tools + Email agent

-- Register Gmail tools as skills
INSERT INTO skills (id, name, description, content, source, enabled) VALUES
  ('gmail_search', 'Gmail Search', 'Search Gmail with any query using Gmail search syntax', 'tool:gmail_search', 'bundled', true),
  ('gmail_read', 'Gmail Read', 'Read a single email by message ID with full headers and body', 'tool:gmail_read', 'bundled', true),
  ('gmail_send', 'Gmail Send', 'Send an email or reply to an existing thread', 'tool:gmail_send', 'bundled', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  content = EXCLUDED.content,
  source = EXCLUDED.source;

-- Email agent — handles general email tasks
INSERT INTO agents (id, name, description, system_prompt, model, enabled, config) VALUES (
  'email',
  'Email',
  'General email agent — search, read, draft, and send emails via Gmail. Handles inbox triage, follow-ups, and email composition.',
  'You are the Email agent for JOI. You handle all general email tasks for Marcus.

## Capabilities
- Search emails with Gmail query syntax (from:, subject:, is:unread, newer_than:, etc.)
- Read individual emails
- Draft and send emails or replies
- Summarize unread mail, find specific threads, follow up on conversations

## Guidelines
- Be concise in email summaries — show sender, subject, date, and a 1-line summary
- When composing emails, match Marcus''s tone: professional but direct, no fluff
- For replies, always include reply_to_message_id and thread_id to maintain threading
- When asked to send, always confirm the recipient and content before sending
- Never fabricate email content — only report what you actually find
- Use German locale for dates when presenting to Marcus (e.g. "20. Feb. 2026")

## Common Queries
- Unread: "is:unread"
- Recent: "newer_than:1d" or "newer_than:7d"
- From someone: "from:name@example.com"
- With attachment: "has:attachment"
- Starred: "is:starred"
- Combined: "is:unread from:someone newer_than:3d"',
  'claude-sonnet-4-20250514',
  true,
  '{"role": "email", "maxSpawnDepth": 0}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  model = EXCLUDED.model,
  config = EXCLUDED.config,
  updated_at = NOW();
