// Learning Pipeline: Extract preferences and reflections from review feedback
// Called fire-and-forget after review resolution — never blocks request path.

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { writeMemory, reinforceMemory } from "./writer.js";
import { searchMemories } from "./searcher.js";
import type { JoiConfig } from "../config/schema.js";
import { proposeFact } from "./facts.js";

// ─── Types ───

export interface FeedbackEvent {
  reviewId: string;
  signal: "approved" | "rejected" | "modified";
  domain: string;                          // triage, skill, chat, other
  conversationId: string | null;
  title: string;
  description: string | null;
  contentBlocks: unknown;                  // review_queue.content (JSONB)
  proposedAction: unknown;                 // review_queue.proposed_action
  resolution: unknown;                     // what the user chose (modified actions, etc.)
}

// ─── Entry Point ───

export async function processFeedback(event: FeedbackEvent, config: JoiConfig): Promise<void> {
  if (!config.memory.autoLearn) return;

  await recordEpisode(event, config);

  // Fire-and-forget: preference + reflection extraction in parallel
  Promise.allSettled([
    extractPreference(event, config),
    event.signal !== "approved"
      ? extractReflection(event, config)
      : Promise.resolve(),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") console.warn("[Learner] Extraction failed:", r.reason);
    }
  });
}

// ─── Episode Recording (0 LLM calls) ───

async function recordEpisode(event: FeedbackEvent, _config: JoiConfig): Promise<void> {
  // Look up the "Learning Episodes" collection
  const collResult = await query<{ id: string }>(
    "SELECT id FROM store_collections WHERE name = 'Learning Episodes' LIMIT 1",
  );
  if (collResult.rows.length === 0) {
    console.warn("[Learner] 'Learning Episodes' collection not found — run migration 028");
    return;
  }
  const collectionId = collResult.rows[0].id;

  const contextSummary = event.title + (event.description ? ` — ${event.description}` : "");
  const deltaSummary = event.signal === "modified" && event.resolution
    ? summarizeDelta(event.proposedAction, event.resolution)
    : null;

  await query(
    `INSERT INTO store_objects (collection_id, title, data, tags, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      collectionId,
      `${event.signal}: ${event.title}`.slice(0, 200),
      JSON.stringify({
        signal: event.signal,
        domain: event.domain,
        review_id: event.reviewId,
        conversation_id: event.conversationId,
        context_summary: contextSummary,
        proposed_action: event.proposedAction,
        actual_action: event.signal === "modified" ? event.resolution : event.proposedAction,
        delta_summary: deltaSummary,
      }),
      [event.signal, event.domain],
      "system:learner",
    ],
  );

  console.log(`[Learner] Recorded episode: ${event.signal} (${event.domain})`);
}

// ─── Preference Extraction (1 utilityCall) ───

const PREFERENCE_SYSTEM_PROMPT = `You extract user preferences from review feedback.
Given a review decision (approve/reject/modify) and its context, identify if this reveals a user preference or behavioral pattern.

Rules:
- A preference is a general rule about how the user wants things handled (not a one-off decision)
- Approvals confirm existing behavior is correct — lower confidence
- Modifications reveal specific preferences about HOW things should be done — highest confidence
- Rejections reveal what the user does NOT want — high confidence

Return JSON: { "preference": "natural language rule", "confidence": 0.5-0.9 }
Or return null if no generalizable preference can be extracted.
Output only valid JSON, no markdown fences.`;

async function extractPreference(event: FeedbackEvent, config: JoiConfig): Promise<void> {
  const userMessage = buildExtractionContext(event);

  let raw: string;
  try {
    raw = await utilityCall(config, PREFERENCE_SYSTEM_PROMPT, userMessage, {
      maxTokens: 256,
      temperature: 0,
      task: "utility",
    });
  } catch (err) {
    console.warn("[Learner] Preference extraction LLM call failed:", err);
    return;
  }

  let parsed: { preference: string; confidence: number } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // LLM didn't return valid JSON
  }

  if (!parsed || !parsed.preference) return;

  // Clamp confidence based on signal type
  let confidence = Math.max(0.5, Math.min(0.9, parsed.confidence));
  if (event.signal === "approved") confidence = Math.min(confidence, 0.7);
  if (event.signal === "modified") confidence = Math.max(confidence, 0.75);

  await proposeFact({
    subject: "user",
    predicate: "prefers",
    object: parsed.preference,
    category: "preference",
    confidence,
    source: `feedback:${event.reviewId}`,
    notes: `Derived from ${event.signal} feedback in ${event.domain}`,
    createdBy: "system:learner",
    tags: [event.domain, `from_${event.signal}`],
  });

  await updateEpisodeField(event.reviewId, "extracted_preference", parsed.preference);
  console.log(`[Learner] Proposed preference fact: ${parsed.preference}`);
}

// ─── Reflection Extraction (1 utilityCall, reject/modify only) ───

const REFLECTION_SYSTEM_PROMPT = `You extract lessons from review feedback where the user rejected or modified an agent's proposal.
Identify what went wrong and what should be done differently next time.

Rules:
- Focus on the GAP between what was proposed and what the user wanted
- The lesson should be actionable and generalizable
- Format as a problem/lesson pair

Return JSON: { "problem": "what went wrong", "lesson": "what to do differently", "confidence": 0.5-0.9 }
Or return null if no clear lesson can be extracted.
Output only valid JSON, no markdown fences.`;

async function extractReflection(event: FeedbackEvent, config: JoiConfig): Promise<void> {
  const userMessage = buildExtractionContext(event);

  let raw: string;
  try {
    raw = await utilityCall(config, REFLECTION_SYSTEM_PROMPT, userMessage, {
      maxTokens: 256,
      temperature: 0,
      task: "utility",
    });
  } catch (err) {
    console.warn("[Learner] Reflection extraction LLM call failed:", err);
    return;
  }

  let parsed: { problem: string; lesson: string; confidence: number } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!parsed || !parsed.problem || !parsed.lesson) return;

  const confidence = Math.max(0.5, Math.min(0.9, parsed.confidence));
  const content = `Problem: ${parsed.problem}\nLesson: ${parsed.lesson}`;

  // Dedup: check for similar existing solution (use vectorScore to avoid decay/confidence bias)
  const existing = await searchMemories(
    { query: content, areas: ["solutions"], limit: 3, minConfidence: 0.1 },
    config,
  );

  const duplicate = existing.find((r) => r.vectorScore > 0.85);
  if (duplicate) {
    await reinforceMemory(duplicate.memory.id);
    console.log(`[Learner] Reinforced solution ${duplicate.memory.id}: ${duplicate.memory.summary || duplicate.memory.content.slice(0, 60)}`);

    await updateEpisodeField(event.reviewId, "extracted_reflection", content);
    return;
  }

  await writeMemory(
    {
      area: "solutions",
      content,
      summary: `${parsed.problem} → ${parsed.lesson}`.slice(0, 200),
      confidence,
      source: "feedback",
      tags: [event.domain, `from_${event.signal}`],
    },
    config,
  );

  await updateEpisodeField(event.reviewId, "extracted_reflection", content);
  console.log(`[Learner] Extracted reflection: ${parsed.problem} → ${parsed.lesson}`);
}

// ─── Helpers ───

function buildExtractionContext(event: FeedbackEvent): string {
  const parts = [
    `Signal: ${event.signal}`,
    `Domain: ${event.domain}`,
    `Review: ${event.title}`,
  ];

  if (event.description) parts.push(`Description: ${event.description}`);

  if (event.proposedAction) {
    parts.push(`Proposed action: ${JSON.stringify(event.proposedAction).slice(0, 500)}`);
  }

  if (event.signal === "modified" && event.resolution) {
    parts.push(`User's modification: ${JSON.stringify(event.resolution).slice(0, 500)}`);
  }

  if (event.signal === "rejected") {
    parts.push("The user rejected this proposal entirely.");
  }

  return parts.join("\n");
}

function summarizeDelta(proposed: unknown, actual: unknown): string {
  try {
    const p = JSON.stringify(proposed);
    const a = JSON.stringify(actual);
    if (p === a) return "No changes";
    return `Changed from ${p.slice(0, 200)} to ${a.slice(0, 200)}`;
  } catch {
    return "Unable to compute delta";
  }
}

async function updateEpisodeField(reviewId: string, field: string, value: string): Promise<void> {
  // Update the most recent episode for this review_id
  try {
    await query(
      `UPDATE store_objects
       SET data = jsonb_set(data, $1::text[], $2::jsonb), updated_at = NOW()
       WHERE id = (
         SELECT id FROM store_objects
         WHERE data->>'review_id' = $3
         ORDER BY created_at DESC LIMIT 1
       )`,
      [`{${field}}`, JSON.stringify(value), reviewId],
    );
  } catch (err) {
    console.warn("[Learner] Episode field update failed:", err);
  }
}
