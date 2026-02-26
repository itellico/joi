/**
 * LLM-based Intent Classifier
 *
 * Replaces all regex-based intent detection with a single cheap LLM call.
 * Determines: should tools be enabled? What domain? Route to specialist agent?
 */

import Anthropic from "@anthropic-ai/sdk";
import type { JoiConfig } from "../config/schema.js";
import { getModelClient } from "./model-router.js";
import { ollamaChat } from "./ollama-llm.js";

export interface IntentClassification {
  needsTools: boolean;
  domain: string;
  routeToAgent: string | null;
  confidence: number;
}

const CLASSIFIER_SYSTEM_PROMPT = `You classify messages for a personal AI assistant named JOI.
Return ONLY a JSON object, no markdown fences.

{"needsTools":bool,"domain":string,"routeToAgent":string|null,"confidence":number}

needsTools: false ONLY for greetings ("hi","hey"), acknowledgments ("ok","thanks","cool"), or casual chat that needs NO data/action. true for EVERYTHING else — any question, request, command, or query.

domain — pick the best match:
- "media" — movies, series, TV, Emby, watching, streaming, Jellyseerr
- "email" — email, inbox, Gmail, compose, draft, reply
- "task" — tasks, todos, Things3, OKRs
- "calendar" — calendar, events, schedule
- "contact" — contacts, people, relationships
- "weather" — weather, forecast
- "message" — WhatsApp, Telegram, iMessage, SMS
- "accounting" — invoices, expenses, bank, payments
- "code" — coding, development, programming, debugging
- "lookup" — memory, knowledge, search, documents, notes
- "general" — anything else

routeToAgent: "media-integrations" if domain is media. "email" if domain is email. null otherwise.

confidence: 0.0-1.0 how confident you are.`;

const DEFAULT_CLASSIFICATION: IntentClassification = {
  needsTools: true,
  domain: "general",
  routeToAgent: null,
  confidence: 0.5,
};

const NO_TOOLS_CLASSIFICATION: IntentClassification = {
  needsTools: false,
  domain: "general",
  routeToAgent: null,
  confidence: 1.0,
};

// Cache to avoid redundant LLM calls for identical messages
const cache = new Map<string, { result: IntentClassification; ts: number }>();
const CACHE_TTL_MS = 120_000;
const CLASSIFIER_TIMEOUT_MS = 1500; // Hard timeout — fallback to tools-enabled if slower

function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) cache.delete(key);
  }
}

/**
 * Classify a user message using a cheap LLM call.
 * Returns structured intent: needsTools, domain, routeToAgent, confidence.
 * Falls back to tools-enabled on any error (safe default).
 */
export async function classifyIntent(
  message: string,
  config: JoiConfig,
): Promise<IntentClassification> {
  const trimmed = message.trim();
  if (!trimmed) return NO_TOOLS_CLASSIFICATION;

  // Check cache
  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  // Periodically clean stale entries
  if (cache.size > 200) cleanCache();

  const startMs = Date.now();

  try {
    const classifyPromise = classifyWithLLM(trimmed, config);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("classifier_timeout")), CLASSIFIER_TIMEOUT_MS),
    );

    const result = await Promise.race([classifyPromise, timeoutPromise]);

    // Cache result
    cache.set(trimmed, { result, ts: Date.now() });

    const latencyMs = Date.now() - startMs;
    console.log(
      `[intent-classifier] "${trimmed.slice(0, 60)}" → tools=${result.needsTools} domain=${result.domain} agent=${result.routeToAgent} conf=${result.confidence} (${latencyMs}ms)`,
    );
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const isTimeout = err instanceof Error && err.message === "classifier_timeout";
    console.warn(
      `[intent-classifier] ${isTimeout ? "Timeout" : "Failed"} after ${latencyMs}ms, defaulting to tools-enabled:`,
      isTimeout ? `>${CLASSIFIER_TIMEOUT_MS}ms` : (err instanceof Error ? err.message : err),
    );
    return DEFAULT_CLASSIFICATION;
  }
}

/** Internal: make the actual LLM call (separated for timeout wrapping) */
async function classifyWithLLM(message: string, config: JoiConfig): Promise<IntentClassification> {
  const { client, openaiClient, model, provider, ollamaUrl } = await getModelClient(config, "classifier");

  let responseText: string;

  if (provider === "ollama" && ollamaUrl) {
    const result = await ollamaChat(ollamaUrl, model, CLASSIFIER_SYSTEM_PROMPT, message, { maxTokens: 128, temperature: 0 });
    responseText = result.text;
  } else if (openaiClient) {
    const response = await openaiClient.chat.completions.create({
      model,
      max_tokens: 128,
      temperature: 0,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
    });
    responseText = response.choices[0]?.message?.content || "";
  } else if (client) {
    const response = await client.messages.create({
      model,
      max_tokens: 128,
      temperature: 0,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    });
    const textBlock = response.content.find((b: Anthropic.ContentBlock) => b.type === "text");
    responseText = (textBlock as Anthropic.TextBlock)?.text || "";
  } else {
    console.warn("[intent-classifier] No API client available, defaulting to tools-enabled");
    return DEFAULT_CLASSIFICATION;
  }

  // Parse JSON from response (handle possible markdown fences)
  const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[intent-classifier] No JSON in response:", responseText.slice(0, 200));
    return DEFAULT_CLASSIFICATION;
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    needsTools: typeof parsed.needsTools === "boolean" ? parsed.needsTools : true,
    domain: typeof parsed.domain === "string" ? parsed.domain : "general",
    routeToAgent: typeof parsed.routeToAgent === "string" ? parsed.routeToAgent : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

/** Map classifier domain to voice intent label for filler text */
export function domainToIntentLabel(domain: string): string {
  switch (domain) {
    case "task": return "task";
    case "email": return "inbox";
    case "calendar": return "calendar";
    case "contact": return "contact";
    case "weather": return "weather";
    case "message": return "message";
    case "media": return "lookup";
    case "accounting": return "lookup";
    case "code": return "lookup";
    case "lookup": return "lookup";
    default: return "request";
  }
}
