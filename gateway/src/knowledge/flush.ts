// Pre-Compaction Memory Flush
// Checks cumulative input tokens and extracts unsaved insights before context is lost.

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { writeMemory } from "./writer.js";
import type { JoiConfig } from "../config/schema.js";
import type { MemoryArea } from "./types.js";

interface FlushResult {
  flushed: boolean;
  memoriesCreated: number;
  totalTokens: number;
}

interface ExtractedMemory {
  area: MemoryArea;
  content: string;
  summary: string;
  tags: string[];
  confidence: number;
}

export async function maybeFlushContext(
  conversationId: string,
  config: JoiConfig,
): Promise<FlushResult> {
  const threshold = config.memory.flushTokenThreshold;

  // 1. Check cumulative input tokens
  const tokenResult = await query<{ total_tokens: number }>(
    `SELECT COALESCE(SUM((token_usage->>'inputTokens')::int), 0) AS total_tokens
     FROM messages WHERE conversation_id = $1`,
    [conversationId],
  );
  const totalTokens = tokenResult.rows[0]?.total_tokens ?? 0;

  if (totalTokens < threshold) {
    return { flushed: false, memoriesCreated: 0, totalTokens };
  }

  // 2. Check if we already flushed recently for this conversation
  const alreadyFlushed = await query(
    `SELECT 1 FROM memories WHERE conversation_id = $1 AND source = 'flush'
     AND created_at > NOW() - INTERVAL '1 hour'`,
    [conversationId],
  );
  if (alreadyFlushed.rows.length > 0) {
    return { flushed: false, memoriesCreated: 0, totalTokens };
  }

  // 3. Load recent messages for context
  const messagesResult = await query<{ role: string; content: string | null }>(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1 AND content IS NOT NULL
     ORDER BY created_at DESC LIMIT 20`,
    [conversationId],
  );
  const recentMessages = messagesResult.rows
    .reverse()
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  if (!recentMessages.trim()) {
    return { flushed: false, memoriesCreated: 0, totalTokens };
  }

  // 4. Load existing memories to avoid duplicates
  const existingResult = await query<{ content: string }>(
    `SELECT content FROM memories
     WHERE conversation_id = $1 AND superseded_by IS NULL
     ORDER BY created_at DESC LIMIT 20`,
    [conversationId],
  );
  const existingMemories = existingResult.rows.map((r) => r.content).join("\n---\n");

  // 5. Call utility model to extract insights
  const systemPrompt = `You are a memory extraction assistant. Extract key facts, decisions, and context from a conversation that should be preserved as long-term memories. Each memory should be self-contained and useful without the original conversation.

Return a JSON array of objects with these fields:
- area: one of "knowledge", "solutions", "episodes"
- content: the fact/insight (1-3 sentences, specific and actionable)
- summary: a one-line summary
- tags: relevant tags (2-4 strings)
- confidence: 0.0-1.0 (how certain this is correct/important)

Rules:
- Skip anything already covered by existing memories (provided below)
- Focus on NEW decisions, facts, or context from this conversation
- Return [] if nothing new worth remembering
- Return ONLY valid JSON, no markdown fencing`;

  const userMessage = `## Recent Conversation Messages
${recentMessages}

## Existing Memories (skip duplicates)
${existingMemories || "(none)"}

Extract new memories worth preserving. Return JSON array only.`;

  const raw = await utilityCall(config, systemPrompt, userMessage, {
    maxTokens: 2048,
    temperature: 0.2,
  });

  // 6. Parse response
  let extracted: ExtractedMemory[] = [];
  try {
    const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    extracted = JSON.parse(cleaned);
    if (!Array.isArray(extracted)) extracted = [];
  } catch {
    console.warn("[Flush] Failed to parse utility response:", raw.slice(0, 200));
    return { flushed: true, memoriesCreated: 0, totalTokens };
  }

  // 7. Write each memory
  const validAreas = new Set(["knowledge", "solutions", "episodes"]);
  let created = 0;

  for (const mem of extracted) {
    if (!mem.content || !validAreas.has(mem.area)) continue;
    try {
      await writeMemory(
        {
          area: mem.area,
          content: mem.content,
          summary: mem.summary || undefined,
          tags: mem.tags || [],
          confidence: Math.min(1, Math.max(0, mem.confidence ?? 0.6)),
          source: "flush",
          conversationId,
        },
        config,
      );
      created++;
    } catch (err) {
      console.warn("[Flush] Failed to write memory:", err);
    }
  }

  if (created > 0) {
    console.log(`[Flush] Saved ${created} memories from conversation ${conversationId} (${totalTokens} tokens)`);
  }

  return { flushed: true, memoriesCreated: created, totalTokens };
}
