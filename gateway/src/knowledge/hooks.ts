// Auto-Learning Hooks: Fire-and-forget post-conversation learning pipeline
// Runs after each agent response — never blocks the chat flow.

import type { JoiConfig } from "../config/schema.js";
import { utilityCall } from "../agent/model-router.js";
import { writeMemory, supersedeMemory, updateMemory } from "./writer.js";
import { searchMemories } from "./searcher.js";
import type { MemoryArea } from "./types.js";
import { markConflictingFactsOutdated, proposeFact, type FactCategory } from "./facts.js";
import { ingestConversationToMem0, isMem0Enabled } from "./mem0-engine.js";
import { log, logWarn, logDebug } from "../logging.js";

export interface ToolInteraction {
  name: string;
  input: unknown;
  result: string;
}

export interface AfterAgentRunParams {
  conversationId: string;
  agentId: string;
  userMessage: string;
  assistantResponse: string;
  toolInteractions: ToolInteraction[];
  scope?: string;
  scopeMetadata?: Record<string, unknown>;
  companyId?: string;
  contactId?: string;
  config: JoiConfig;
}

// Cooldown: skip if last hook run was less than 10s ago
let lastHookRunAt = 0;
const HOOK_COOLDOWN_MS = 10_000;

// Orchestrator — called from runtime.ts after response is sent
export async function afterAgentRun(params: AfterAgentRunParams): Promise<void> {
  const { config } = params;
  if (!config.memory.autoLearn) return;

  const now = Date.now();
  if (now - lastHookRunAt < HOOK_COOLDOWN_MS) {
    logDebug("autolearn", "Skipped (cooldown)");
    return;
  }
  lastHookRunAt = now;

  // Run all hooks in parallel, fire-and-forget style
  await Promise.allSettled([
    extractFacts(params).catch((err) =>
      logWarn("autolearn", `extractFacts failed: ${err}`),
    ),
    captureSolutions(params).catch((err) =>
      logWarn("autolearn", `captureSolutions failed: ${err}`),
    ),
    detectCorrections(params).catch((err) =>
      logWarn("autolearn", `detectCorrections failed: ${err}`),
    ),
  ]);

  if (isMem0Enabled(config)) {
    ingestConversationToMem0(config, {
      conversationId: params.conversationId,
      agentId: params.agentId,
      userMessage: params.userMessage,
      assistantResponse: params.assistantResponse,
      toolCount: params.toolInteractions.length,
      tenantScope: params.scope,
      companyId: params.companyId,
      contactId: params.contactId,
    }).catch((err) => logWarn("autolearn", `mem0 ingest failed: ${err}`));
  }
}

// ─── Extract Facts ──────────────────────────────────────────────────

interface ExtractedFact {
  category?: "identity" | "preference";
  subject?: string;
  predicate?: string;
  object?: string;
  confidence?: number;
  notes?: string;
  // Backward compatibility with previous extractor schema.
  area?: "identity" | "preferences";
  content?: string;
  summary?: string;
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeLearningArea(area: string | undefined): "identity" | "preferences" | "knowledge" {
  if (area === "identity" || area === "preferences" || area === "knowledge") return area;
  return "knowledge";
}

function isLikelyLowSignalFact(area: "identity" | "preferences", content: string, summary?: string): boolean {
  const text = `${content}\n${summary || ""}`.toLowerCase();
  if (!content) return true;

  // Common assistant fallback language should never become memory.
  const fallbackMarkers = [
    "could you please provide more context",
    "i'm not sure what",
    "i do not know your name",
    "i don't know your name",
    "i'm afraid i don't have enough context",
  ];
  if (fallbackMarkers.some((m) => text.includes(m))) return true;

  // Never store timestamps and similarly volatile values as identity facts.
  if (area === "identity") {
    if (/^\d{1,2}:\d{2}(\s?[ap]m)?$/i.test(content)) return true;
    if (text.includes("current time")) return true;
  }

  // Avoid generic placeholders.
  if (["user", "assistant", "unknown"].includes(content.toLowerCase())) return true;

  // Avoid operational commands/tasks being learned as identity/preferences.
  if (/^(check|create|send|reply|review|update|fix|tasks?\b|task\s+to\s+do\b)/i.test(content)) return true;

  // Long sentence-like statements are usually summaries, not atomic facts.
  if (content.length > 220) return true;
  if (area === "identity" && content.length > 120) return true;
  if (/^[a-z].*[.!]$/.test(content) && content.length > 80) return true;

  // Backfill-style phrasing should not become raw fact objects.
  if (text.startsWith("user is ") || text.startsWith("user prefers ")) return true;

  // Questions are usually not facts/preferences.
  if (content.includes("?")) return true;

  return false;
}

function toFactProposal(raw: ExtractedFact, conversationId: string): {
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  confidence: number;
  notes?: string;
  source: string;
} | null {
  const mappedCategory = raw.category
    ? raw.category
    : raw.area === "preferences"
      ? "preference"
      : raw.area === "identity"
        ? "identity"
        : null;
  if (!mappedCategory) return null;

  const subject = normalizeText(raw.subject || "user");
  const predicate = normalizeText(raw.predicate || (mappedCategory === "preference" ? "prefers" : "is"));
  const object = normalizeText(raw.object || raw.content || "");
  const notes = normalizeText(raw.notes || raw.summary || "");
  const mappedArea = mappedCategory === "preference" ? "preferences" : "identity";

  if (!subject || !predicate || !object) return null;
  if (isLikelyLowSignalFact(mappedArea, object, notes)) return null;

  return {
    subject,
    predicate,
    object,
    category: mappedCategory,
    confidence: Math.min(mappedCategory === "identity" ? 0.85 : 0.9, Math.max(0.5, raw.confidence ?? 0.7)),
    notes: notes || undefined,
    source: `chat:${conversationId}`,
  };
}

async function extractFacts(params: AfterAgentRunParams): Promise<void> {
  const { userMessage, conversationId, config } = params;

  const raw = await utilityCall(
    config,
    `You extract candidate facts from a single user message.
Use only what the USER explicitly stated.
Do NOT infer from assistant text, placeholders, fallback language, or timestamps.

Return a JSON array of objects:
{
  "category": "identity" | "preference",
  "subject": "user or named entity",
  "predicate": "short predicate (snake_case preferred)",
  "object": "fact value",
  "confidence": 0.5-0.9,
  "notes": "optional context"
}

Return an empty array [] if nothing to extract. Only output valid JSON, no markdown fences.`,
    `User message:\n${userMessage}`,
    { maxTokens: 384, temperature: 0 },
  );

  let facts: ExtractedFact[];
  try {
    facts = JSON.parse(raw);
  } catch {
    return; // LLM didn't return valid JSON — skip
  }

  if (!Array.isArray(facts) || facts.length === 0) return;

  for (const fact of facts) {
    const proposal = toFactProposal(fact, conversationId);
    if (!proposal) continue;
    try {
      const result = await proposeFact({
        ...proposal,
        createdBy: "system:fact-learner",
        tags: ["auto", "chat", proposal.category],
      });
      log("autolearn", `Proposed ${proposal.category} fact (${result.created ? "new" : "updated"}): ${proposal.subject} ${proposal.predicate} ${proposal.object}`);
    } catch (err) {
      // Low-signal proposals are expected occasionally; skip without failing full extraction.
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("low-signal")) {
        logWarn("autolearn", `proposeFact failed: ${err}`);
      }
    }
  }
}

// ─── Capture Solutions ──────────────────────────────────────────────

async function captureSolutions(params: AfterAgentRunParams): Promise<void> {
  const { userMessage, assistantResponse, toolInteractions, conversationId, config } = params;

  // Only trigger when tools were actually used
  if (toolInteractions.length === 0) return;

  // Build a condensed summary of tool interactions
  const toolSummary = toolInteractions
    .map((t) => `Tool: ${t.name}\nResult: ${t.result.slice(0, 300)}`)
    .join("\n---\n");

  const raw = await utilityCall(
    config,
    `You summarize problem→solution pairs from conversations where tools were used.
If the conversation shows the assistant solving a problem using tools, return a JSON object:
{ "problem": string, "solution": string, "tags": string[] }
If no clear problem was solved, return null. Only output valid JSON, no markdown fences.`,
    `User: ${userMessage}\n\nTool interactions:\n${toolSummary}\n\nAssistant: ${assistantResponse}`,
    { maxTokens: 512 },
  );

  let parsed: { problem: string; solution: string; tags?: string[] } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!parsed || !parsed.problem || !parsed.solution) return;

  const content = `Problem: ${parsed.problem}\nSolution: ${parsed.solution}`;
  const summary = `${parsed.problem} → ${parsed.solution}`.slice(0, 200);

  await writeMemory(
    {
      area: "solutions",
      content,
      summary,
      tags: parsed.tags || [],
      confidence: 0.7,
      source: "solution_capture",
      conversationId,
    },
    config,
  );

  log("autolearn", `Captured solution: ${summary}`);
}

// ─── Detect Corrections ─────────────────────────────────────────────

async function detectCorrections(params: AfterAgentRunParams): Promise<void> {
  const { userMessage, assistantResponse, conversationId, config } = params;

  const raw = await utilityCall(
    config,
    `You detect when a user corrects the assistant's understanding.
Look for patterns like "no, I meant...", "actually...", "that's wrong", "not X, it's Y", corrections of facts/names/preferences.
If a correction is found, return a JSON object:
{ "incorrect": string (what was wrong), "correct": string (the right information), "area": "identity" | "preferences" | "knowledge", "subject": string, "predicate": string }
The "correct" value must be what the USER asserted. Never return assistant fallback text, timestamps, or placeholders.
If no correction detected, return null. Only output valid JSON, no markdown fences.`,
    `User message:\n${userMessage}\n\nAssistant context (for reference only):\n${assistantResponse}`,
    { maxTokens: 256, temperature: 0 },
  );

  let parsed: { incorrect: string; correct: string; area: string; subject?: string; predicate?: string } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!parsed || !parsed.incorrect || !parsed.correct) return;
  const area = normalizeLearningArea(parsed.area);
  const incorrect = normalizeText(parsed.incorrect);
  const correct = normalizeText(parsed.correct);
  if (area !== "knowledge" && isLikelyLowSignalFact(area, correct, `Corrected: ${correct}`)) return;

  if (area === "identity" || area === "preferences") {
    const category: FactCategory = area === "preferences" ? "preference" : "identity";
    const subject = normalizeText(parsed.subject || "user");
    const predicate = normalizeText(parsed.predicate || (area === "identity" ? "is" : "prefers"));
    if (!subject || !predicate || !correct) return;
    await markConflictingFactsOutdated(subject, predicate, correct);
    await proposeFact({
      subject,
      predicate,
      object: correct,
      category,
      confidence: 0.85,
      source: `correction:${conversationId}`,
      notes: `Corrected from: ${incorrect}`,
      createdBy: "system:fact-learner",
      tags: ["auto", "correction", category],
    });
    log("autolearn", `Correction fact proposed: ${subject} ${predicate} ${correct}`);
    return;
  }

  // Knowledge correction stays in memory, because it's operational context.
  // Search for the incorrect memory to supersede
  const oldMemories = await searchMemories(
    {
      query: incorrect,
      areas: ["knowledge"],
      limit: 3,
      minConfidence: 0.05,
    },
    config,
  );

  // Write the corrected memory
  const newMemory = await writeMemory(
    {
      area: "knowledge",
      content: correct,
      summary: `Corrected: ${correct}`,
      confidence: 0.85,
      source: "inferred",
      conversationId,
    },
    config,
  );

  // Supersede matching old memories
  for (const result of oldMemories) {
    if (result.score > 0.3) {
      await supersedeMemory(result.memory.id, newMemory.id);
      log("autolearn", `Superseded memory ${result.memory.id} with correction`);
    }
  }

  // Also reduce confidence on near-matches that weren't superseded
  for (const result of oldMemories) {
    if (result.score > 0.2 && result.score <= 0.3 && result.memory.confidence > 0.2) {
      await updateMemory(result.memory.id, { confidence: result.memory.confidence * 0.5 }, config);
    }
  }

  log("autolearn", `Correction detected: "${incorrect}" → "${correct}"`);
}
