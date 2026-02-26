// Model Router: Abstracts model calls across Anthropic direct + OpenRouter
// Routes different task types to appropriate models (cheap for utility, expensive for chat)
//
// OpenRouter has two endpoints:
//   /v1/messages      — Anthropic-compatible, only works with anthropic/* models
//   /v1/chat/completions — OpenAI-compatible, works with ALL models (openai/*, google/*, etc.)
// We use the Anthropic SDK for anthropic models, OpenAI SDK for everything else.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { JoiConfig } from "../config/schema.js";
import { query } from "../db/client.js";
import { logWarn } from "../logging.js";
import { ollamaChat } from "./ollama-llm.js";
import { recordUsage } from "./usage-tracker.js";

// Task types that determine which model to use
export type ModelTask =
  | "chat"           // Main conversation (user-facing, high quality)
  | "voice"          // Realtime voice responses (fast + natural)
  | "tool"           // Tool-calling agentic loop (can be cheaper)
  | "utility"        // Fact extraction, classification, consolidation (cheap + fast)
  | "triage"         // Inbox triage: classify inbound messages (cheap + fast)
  | "classifier"     // Intent classification: determines tools/routing/domain (ultra-cheap + fast)
  | "embedding";     // Vector embeddings (Ollama, local)

// Provider types
export type ModelProvider = "anthropic" | "openrouter" | "ollama";

export interface ModelRouteConfig {
  task: ModelTask;
  model: string;
  provider: ModelProvider;
}

// Map Anthropic date-suffixed model IDs to OpenRouter slugs
// OpenRouter uses short names (e.g. "anthropic/claude-sonnet-4") not date-suffixed ones
const ANTHROPIC_TO_OPENROUTER: Record<string, string> = {
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
  "claude-opus-4-20250514": "anthropic/claude-opus-4",
  "claude-haiku-3-20240307": "anthropic/claude-3-haiku",
  "claude-3-5-haiku-20241022": "anthropic/claude-3.5-haiku",
  "claude-3-5-sonnet-20241022": "anthropic/claude-3.5-sonnet",
};

/** Convert a bare Anthropic model ID to a valid OpenRouter slug */
function toOpenRouterSlug(model: string): string {
  // Already has provider prefix → pass through
  if (model.includes("/")) return model;
  // Check explicit mapping first
  if (ANTHROPIC_TO_OPENROUTER[model]) return ANTHROPIC_TO_OPENROUTER[model];
  // Fallback: strip date suffix and prepend anthropic/
  const stripped = model.replace(/-\d{8}$/, "");
  return `anthropic/${stripped}`;
}

// Models known to be unreliable for structured tool/function calling via OpenRouter.
// These models sometimes output code blocks (e.g. `print(default_api.xxx())`) instead
// of proper OpenAI-format tool_calls. When one of these is resolved as the tool model,
// we substitute a reliable alternative to force two-phase routing.
const UNRELIABLE_TOOL_CALLING_PREFIXES = ["google/"];

function isUnreliableForToolCalling(model: string): boolean {
  return UNRELIABLE_TOOL_CALLING_PREFIXES.some((prefix) => model.startsWith(prefix));
}

// Reliable cheap model for tool calling when the chat model can't do it
const RELIABLE_TOOL_MODEL: ModelRoute = { model: "openai/gpt-4o-mini", provider: "openrouter" };

function logToolRouteSubstitution(sourceModel: string, reason: "db_tool_route" | "fallback_to_chat_route"): void {
  const message =
    `[ModelRouter] Tool route ${sourceModel} is unreliable for function calling; using ${RELIABLE_TOOL_MODEL.model} instead`;
  console.warn(message);
  logWarn("agent", message, {
    sourceModel,
    substitutedModel: RELIABLE_TOOL_MODEL.model,
    reason,
  });
}

// Models available via each provider
export const AVAILABLE_MODELS = {
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "mid", costPer1kIn: 0.003, costPer1kOut: 0.015 },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4", tier: "high", costPer1kIn: 0.015, costPer1kOut: 0.075 },
    { id: "claude-haiku-3-20240307", name: "Claude Haiku 3", tier: "low", costPer1kIn: 0.00025, costPer1kOut: 0.00125 },
  ],
  // OpenRouter supports all models:
  //   anthropic/* → via Anthropic SDK (/v1/messages)
  //   openai/*, google/* etc. → via OpenAI SDK (/v1/chat/completions)
  openrouter: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", tier: "mid", costPer1kIn: 0.003, costPer1kOut: 0.015 },
    { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", tier: "low", costPer1kIn: 0.0008, costPer1kOut: 0.004 },
    { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku", tier: "low", costPer1kIn: 0.00025, costPer1kOut: 0.00125 },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", tier: "low", costPer1kIn: 0.00015, costPer1kOut: 0.0006 },
    { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", tier: "low", costPer1kIn: 0.0004, costPer1kOut: 0.0016 },
    { id: "openai/gpt-4.1-nano", name: "GPT-4.1 Nano", tier: "low", costPer1kIn: 0.0001, costPer1kOut: 0.0004 },
    { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", tier: "low", costPer1kIn: 0.0001, costPer1kOut: 0.0004 },
  ],
  ollama: [
    { id: "qwen3", name: "Qwen 3 (Local)", tier: "mid", costPer1kIn: 0, costPer1kOut: 0 },
    { id: "qwen3.5", name: "Qwen 3.5 (Local)", tier: "high", costPer1kIn: 0, costPer1kOut: 0 },
    { id: "qwen2.5", name: "Qwen 2.5 (Local)", tier: "low", costPer1kIn: 0, costPer1kOut: 0 },
    { id: "llama3.3", name: "Llama 3.3 (Local)", tier: "low", costPer1kIn: 0, costPer1kOut: 0 },
    { id: "deepseek-r1", name: "DeepSeek R1 (Local)", tier: "mid", costPer1kIn: 0, costPer1kOut: 0 },
  ],
} as const;

// Route cache (refreshed from DB periodically)
let routeCache: Map<string, { model: string; provider: ModelProvider }> | null = null;
let routeCacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function loadRoutes(): Promise<Map<string, { model: string; provider: ModelProvider }>> {
  const now = Date.now();
  if (routeCache && now - routeCacheTime < CACHE_TTL_MS) return routeCache;

  try {
    const result = await query<{ task: string; model: string; provider: string }>(
      "SELECT task, model, provider FROM model_routes",
    );
    routeCache = new Map();
    for (const row of result.rows) {
      routeCache.set(row.task, { model: row.model, provider: row.provider as ModelProvider });
    }
    routeCacheTime = now;
  } catch {
    // DB might not have the table yet
    if (!routeCache) routeCache = new Map();
  }
  return routeCache;
}

// Client constructors

function createAnthropicClient(config: JoiConfig): Anthropic {
  const apiKey = config.auth.anthropicApiKey;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

function createOpenRouterAnthropicClient(config: JoiConfig): Anthropic {
  const apiKey = config.auth.openrouterApiKey;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured. Add it in Settings or .env");
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api",
  });
}

function createOpenRouterOpenAIClient(config: JoiConfig): OpenAI {
  const apiKey = config.auth.openrouterApiKey;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured. Add it in Settings or .env");
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

/** Check if an OpenRouter model uses the Anthropic-compatible endpoint */
export function isAnthropicModel(model: string): boolean {
  if (!model.includes("/")) return true; // bare model names are assumed Anthropic
  return model.startsWith("anthropic/");
}

/** Get the Ollama URL from config (used for LLM calls, not just embeddings) */
export function getOllamaUrl(config: JoiConfig): string {
  return config.memory.ollamaUrl || "http://localhost:11434";
}

export interface ModelRoute {
  model: string;
  provider: ModelProvider;
}

// Known Ollama model prefixes for detection
const OLLAMA_MODELS = new Set<string>(
  AVAILABLE_MODELS.ollama.map((m) => m.id),
);

function isOllamaModel(model: string): boolean {
  return OLLAMA_MODELS.has(model) || model.includes(":cloud") || model.includes(":local");
}

function normalizeOllamaModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "qwen3.5:cloud" || trimmed === "qwen3.5:397b-cloud") return "qwen3";
  if (trimmed.endsWith(":cloud")) return trimmed.replace(/:cloud$/, "");
  if (trimmed.endsWith(":local")) return trimmed.replace(/:local$/, "");
  return trimmed;
}

// Resolve which model + provider to use for a given task
//
// Priority:
// 1. DB route (model_routes table) — the user's explicit setting in Settings UI.
//    The route's PROVIDER is authoritative. Agent overrides cannot change it.
// 2. Agent model override — selects a model within the route's provider,
//    or applies fully when no DB route exists for this task.
// 3. Hardcoded fallbacks — last resort when no route and no override.
export async function resolveModel(config: JoiConfig, task: ModelTask, override?: string): Promise<ModelRoute> {
  // Load routes from DB (cached)
  const routes = await loadRoutes();

  if (task !== "embedding") {
    const dbRoute = routes.get(task);
    if (dbRoute) {
      // DB route is fully authoritative — the user's explicit Settings selection
      // always wins over agent model overrides.

      // Guard: if a model unreliable for tool calling is set as the tool route,
      // override with a reliable model to prevent code-block output instead of tool_calls.
      if (task === "tool" && dbRoute.provider === "openrouter" && isUnreliableForToolCalling(dbRoute.model)) {
        if (config.auth.openrouterApiKey) {
          logToolRouteSubstitution(dbRoute.model, "db_tool_route");
          return RELIABLE_TOOL_MODEL;
        }
      }

      // Verify the provider key is available, fall back if not
      if (dbRoute.provider === "anthropic" && !config.auth.anthropicApiKey && config.auth.openrouterApiKey) {
        return { model: toOpenRouterSlug(dbRoute.model), provider: "openrouter" };
      }
      if (dbRoute.provider === "openrouter" && !config.auth.openrouterApiKey && config.auth.anthropicApiKey) {
        const directModel = dbRoute.model.includes("/") ? dbRoute.model.split("/").pop()! : dbRoute.model;
        return { model: directModel, provider: "anthropic" };
      }
      if (dbRoute.provider === "ollama") {
        return { model: normalizeOllamaModel(dbRoute.model), provider: "ollama" };
      }
      return dbRoute;
    }
  }

  // No DB route — agent override applies fully
  if (override) {
    if (isOllamaModel(override)) {
      return { model: normalizeOllamaModel(override), provider: "ollama" };
    }
    if (override.includes("/")) {
      // Explicit provider/model format → OpenRouter
      if (!config.auth.openrouterApiKey && config.auth.anthropicApiKey) {
        return { model: override.split("/").pop()!, provider: "anthropic" };
      }
      return { model: override, provider: "openrouter" };
    }
    // Bare model name → prefer Anthropic direct, fall back to OpenRouter
    if (config.auth.anthropicApiKey) {
      return { model: override, provider: "anthropic" };
    }
    if (config.auth.openrouterApiKey) {
      return { model: toOpenRouterSlug(override), provider: "openrouter" };
    }
    return { model: override, provider: "anthropic" };
  }

  // Hardcoded fallbacks
  if (task === "chat") {
    if (config.auth.openrouterApiKey) return { model: "anthropic/claude-sonnet-4", provider: "openrouter" };
    if (config.auth.anthropicApiKey) return { model: "claude-sonnet-4-20250514", provider: "anthropic" };
    return { model: "qwen3", provider: "ollama" };
  }

  if (task === "voice") {
    // Voice defaults prioritize latency over depth.
    if (config.auth.openrouterApiKey) return { model: "openai/gpt-4o-mini", provider: "openrouter" };
    if (config.auth.anthropicApiKey) return { model: "claude-haiku-3-20240307", provider: "anthropic" };
    return { model: "qwen3", provider: "ollama" };
  }

  if (task === "tool") {
    // Fallback: delegate to chat model when no DB route for tool.
    // But if the chat model is unreliable for structured tool calling
    // (e.g. Gemini outputs code blocks instead of tool_calls), use a
    // known-reliable model to force two-phase routing.
    const chatRoute = await resolveModel(config, "chat", override);
    if (chatRoute.provider === "openrouter" && isUnreliableForToolCalling(chatRoute.model)) {
      if (config.auth.openrouterApiKey) {
        logToolRouteSubstitution(chatRoute.model, "fallback_to_chat_route");
        return RELIABLE_TOOL_MODEL;
      }
    }
    return chatRoute;
  }

  if (task === "triage") {
    // Fallback: delegate to utility model when no DB route for triage
    return resolveModel(config, "utility", override);
  }

  if (task === "utility") {
    if (config.auth.openrouterApiKey) return { model: "anthropic/claude-3-haiku", provider: "openrouter" };
    if (config.auth.anthropicApiKey) return { model: "claude-haiku-3-20240307", provider: "anthropic" };
    return { model: "qwen3", provider: "ollama" };
  }

  if (task === "classifier") {
    // Ultra-cheap/fast model for intent classification
    if (config.auth.openrouterApiKey) return { model: "openai/gpt-4.1-nano", provider: "openrouter" };
    if (config.auth.anthropicApiKey) return { model: "claude-haiku-3-20240307", provider: "anthropic" };
    return { model: "qwen3", provider: "ollama" };
  }

  throw new Error(`No route configured for task: ${task}`);
}

// Get an Anthropic-compatible client for the resolved route
// Returns null for Ollama and for non-Anthropic OpenRouter models
export function getClient(config: JoiConfig, route: ModelRoute): Anthropic | null {
  switch (route.provider) {
    case "anthropic":
      return createAnthropicClient(config);
    case "openrouter":
      // Only return Anthropic client for anthropic/* models
      if (isAnthropicModel(route.model)) {
        return createOpenRouterAnthropicClient(config);
      }
      return null; // Non-Anthropic models use OpenAI SDK
    case "ollama":
      return null; // Ollama uses its own adapter, not the Anthropic SDK
    default:
      throw new Error(`Unknown provider: ${route.provider}`);
  }
}

/** Get an OpenAI client for non-Anthropic OpenRouter models */
export function getOpenAIClient(config: JoiConfig, route: ModelRoute): OpenAI | null {
  if (route.provider !== "openrouter") return null;
  if (isAnthropicModel(route.model)) return null;
  return createOpenRouterOpenAIClient(config);
}

// Convenience: resolve + get client in one call
export async function getModelClient(
  config: JoiConfig,
  task: ModelTask,
  modelOverride?: string,
): Promise<{
  client: Anthropic | null;
  openaiClient: OpenAI | null;
  model: string;
  provider: ModelProvider;
  ollamaUrl?: string;
}> {
  const route = await resolveModel(config, task, modelOverride);
  const client = getClient(config, route);
  const openaiClient = getOpenAIClient(config, route);
  return {
    client,
    openaiClient,
    model: route.model,
    provider: route.provider,
    ollamaUrl: route.provider === "ollama" ? getOllamaUrl(config) : undefined,
  };
}

// Quick utility call for cheap tasks (fact extraction, classification, etc.)
// Pass task override to use a different model route (e.g. "triage" for inbox classification)
export async function utilityCall(
  config: JoiConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; temperature?: number; task?: ModelTask },
): Promise<string> {
  const task = options?.task ?? "utility";
  const { client, openaiClient, model, provider, ollamaUrl } = await getModelClient(config, task);

  // Ollama uses its own adapter
  if (provider === "ollama" && ollamaUrl) {
    const startMs = Date.now();
    const result = await ollamaChat(ollamaUrl, model, systemPrompt, userMessage, options);
    recordUsage({
      provider, model, task,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      latencyMs: Date.now() - startMs,
    }).catch(() => {});
    return result.text;
  }

  // Non-Anthropic OpenRouter models → OpenAI SDK
  if (openaiClient) {
    const startMs = Date.now();
    const response = await openaiClient.chat.completions.create({
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const text = response.choices[0]?.message?.content || "";
    recordUsage({
      provider, model, task,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startMs,
    }).catch(() => {});
    return text;
  }

  // Anthropic SDK (direct or OpenRouter with anthropic/* models)
  if (!client) throw new Error("No API client available for utility calls");

  const startMs = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  recordUsage({
    provider, model, task,
    inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
    latencyMs: Date.now() - startMs,
  }).catch(() => {});

  const textBlock = response.content.find((b) => b.type === "text");
  return (textBlock as Anthropic.TextBlock)?.text || "";
}

// Reset cached clients and routes (call when config changes)
export function resetClients(): void {
  routeCache = null;
  routeCacheTime = 0;
}
