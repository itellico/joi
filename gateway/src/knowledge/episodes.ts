// Episode Summarizer: Creates episode memories from conversation history
// Called by cron to summarize idle sessions.

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { writeMemory } from "./writer.js";
import type { JoiConfig } from "../config/schema.js";

// Summarize conversations idle for 30+ minutes that lack an episode memory
export async function summarizeIdleSessions(config: JoiConfig): Promise<void> {
  // Find conversations updated >30 min ago that don't yet have an episode
  const result = await query<{ id: string; title: string }>(
    `SELECT c.id, c.title
     FROM conversations c
     WHERE c.updated_at < NOW() - INTERVAL '30 minutes'
       AND c.updated_at > NOW() - INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM memories m
         WHERE m.conversation_id = c.id
           AND m.area = 'episodes'
           AND m.source = 'episode'
       )
       AND (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) >= 4
     ORDER BY c.updated_at DESC
     LIMIT 10`,
  );

  if (result.rows.length === 0) return;

  console.log(`[Episodes] Found ${result.rows.length} sessions to summarize`);

  for (const conv of result.rows) {
    try {
      await summarizeSession(conv.id, config);
    } catch (err) {
      console.warn(`[Episodes] Failed to summarize ${conv.id}:`, err);
    }
  }
}

// Summarize a specific session
export async function summarizeSession(
  conversationId: string,
  config: JoiConfig,
): Promise<void> {
  // Load the last 30 messages for context
  const messages = await query<{ role: string; content: string | null }>(
    `SELECT role, content
     FROM messages
     WHERE conversation_id = $1 AND content IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 30`,
    [conversationId],
  );

  if (messages.rows.length < 2) return;

  const transcript = messages.rows
    .map((m) => `${m.role}: ${(m.content || "").slice(0, 500)}`)
    .join("\n");

  const summary = await utilityCall(
    config,
    `Summarize this conversation in 2-3 concise sentences. Focus on what was discussed, what was accomplished, and any decisions made. Output only the summary text, no labels or formatting.`,
    transcript,
    { maxTokens: 256 },
  );

  if (!summary || summary.length < 10) return;

  await writeMemory(
    {
      area: "episodes",
      content: summary,
      summary: summary.slice(0, 200),
      confidence: 0.6,
      source: "episode",
      conversationId,
    },
    config,
  );

  console.log(`[Episodes] Summarized conversation ${conversationId}`);
}
