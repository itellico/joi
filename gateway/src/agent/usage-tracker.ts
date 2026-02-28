// Usage Tracker: Records every LLM API call to usage_log for statistics and cost tracking

import { query } from "../db/client.js";
import { AVAILABLE_MODELS, type ModelProvider } from "./model-router.js";

interface UsageEntry {
  provider: ModelProvider;
  model: string;
  task: "chat" | "lightweight" | "voice" | "tool" | "utility" | "triage" | "classifier" | "embedding";
  inputTokens: number;
  outputTokens: number;
  conversationId?: string | null;
  agentId?: string | null;
  latencyMs?: number;
  error?: boolean;
}

/** Calculate estimated cost in USD based on model pricing */
export function estimateCost(provider: ModelProvider, model: string, inputTokens: number, outputTokens: number): number {
  if (provider === "ollama") return 0; // Free

  const providerModels = AVAILABLE_MODELS[provider];
  if (!providerModels) return 0;

  const modelInfo = providerModels.find((m) => m.id === model);
  if (!modelInfo) return 0;

  // costPer1kIn/Out are per 1K tokens
  const inCost = (inputTokens / 1000) * modelInfo.costPer1kIn;
  const outCost = (outputTokens / 1000) * modelInfo.costPer1kOut;
  return inCost + outCost;
}

/** Record a usage entry to the database (fire-and-forget) */
export async function recordUsage(entry: UsageEntry): Promise<void> {
  try {
    const costUsd = estimateCost(entry.provider, entry.model, entry.inputTokens, entry.outputTokens);

    await query(
      `INSERT INTO usage_log (provider, model, task, input_tokens, output_tokens, cost_usd, conversation_id, agent_id, latency_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.provider,
        entry.model,
        entry.task,
        entry.inputTokens,
        entry.outputTokens,
        costUsd,
        entry.conversationId || null,
        entry.agentId || null,
        entry.latencyMs || null,
        entry.error || false,
      ],
    );
  } catch (err) {
    // Don't crash on usage tracking failures — table might not exist yet
    console.warn("[Usage] Failed to record usage:", (err as Error).message);
  }
}
