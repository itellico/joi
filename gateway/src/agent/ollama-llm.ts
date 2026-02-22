// Ollama LLM Adapter: Bridges Ollama's /api/chat with Anthropic message format
// Enables using Ollama-hosted models (Qwen 3.5, etc.) as LLM providers in JOI

import type Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";

// --- Type conversions: Anthropic → Ollama ---

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: { temperature?: number; num_predict?: number };
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaStreamChunk {
  model: string;
  message: {
    role: string;
    content: string;
    thinking?: string; // Qwen 3.5 returns chain-of-thought reasoning
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

// Result format compatible with runtime expectations
export interface OllamaStreamResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  inputTokens: number;
  outputTokens: number;
  stopReason: "end_turn" | "tool_use";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
}

const OLLAMA_MODEL_PRIORITY = [
  "qwen3",
  "qwen3.5",
  "qwen2.5",
  "llama3.3",
  "llama3.2",
  "llama3",
  "deepseek-r1",
  "mistral",
  "gemma3",
];

function baseModelName(model: string): string {
  return model.split(":")[0]?.trim() || model.trim();
}

function isModelMissingError(status: number, body: string): boolean {
  if (status !== 404) return false;
  const normalized = body.toLowerCase();
  return normalized.includes("model") && normalized.includes("not found");
}

async function listInstalledModels(ollamaUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    const names = (data.models || [])
      .map((m) => m.name?.trim())
      .filter((name): name is string => Boolean(name));
    return [...new Set(names)];
  } catch {
    return [];
  }
}

function pickFallbackModel(requestedModel: string, installedModels: string[]): string | null {
  const llmModels = installedModels.filter((m) => !baseModelName(m).toLowerCase().includes("embed"));
  if (llmModels.length === 0) return null;

  const requestedBase = baseModelName(requestedModel);
  const priority = [requestedBase, ...OLLAMA_MODEL_PRIORITY];
  const seen = new Set<string>();

  for (const key of priority) {
    const normalized = key.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const exact = llmModels.find((m) => m === normalized);
    if (exact) return exact;

    const tagged = llmModels.find((m) => m.startsWith(`${normalized}:`));
    if (tagged) return tagged;
  }

  return llmModels[0];
}

async function postOllamaChat(
  ollamaUrl: string,
  body: OllamaChatRequest,
): Promise<Response> {
  const send = async (requestBody: OllamaChatRequest) => fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const response = await send(body);
  if (response.ok) return response;

  const errText = await response.text();
  if (!isModelMissingError(response.status, errText)) {
    throw new Error(`Ollama chat failed (${response.status}): ${errText}`);
  }

  const installedModels = await listInstalledModels(ollamaUrl);
  const fallbackModel = pickFallbackModel(body.model, installedModels);
  if (!fallbackModel) {
    throw new Error(
      `Ollama model '${body.model}' not found at ${ollamaUrl}, and no local LLM models are installed there. Pull one on the Mac mini (for example: 'ollama pull qwen3').`,
    );
  }

  if (fallbackModel !== body.model) {
    console.warn(`[Ollama] model '${body.model}' not found on ${ollamaUrl}. Retrying with '${fallbackModel}'.`);
  }

  const retryResponse = await send({ ...body, model: fallbackModel });
  if (!retryResponse.ok) {
    const retryErr = await retryResponse.text();
    throw new Error(`Ollama chat retry failed (${retryResponse.status}): ${retryErr}`);
  }
  return retryResponse;
}

/** Convert Anthropic tools to Ollama format */
function convertTools(tools: Anthropic.Tool[]): OllamaTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/** Convert Anthropic messages array to Ollama format */
function convertMessages(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role as "user" | "assistant", content: msg.content });
      continue;
    }

    // Content is an array of blocks — cast to any[] for flexible type checking
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as unknown as Array<Record<string, unknown>>;

      // Check for tool_result blocks (user message with tool results)
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const blockContent = tr.content;
          let content = "";
          if (typeof blockContent === "string") {
            content = blockContent;
          } else if (Array.isArray(blockContent)) {
            content = (blockContent as Array<{ type: string; text?: string }>)
              .filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join("\n");
          }
          result.push({ role: "tool", content });
        }
        continue;
      }

      // Check for tool_use blocks (assistant message with tool calls)
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      if (toolUses.length > 0) {
        const textParts = blocks
          .filter((b) => b.type === "text")
          .map((b) => String(b.text || ""))
          .join("");

        result.push({
          role: "assistant",
          content: textParts || `[Called tools: ${toolUses.map((tu) => String(tu.name)).join(", ")}]`,
          tool_calls: toolUses.map((tu) => ({
            function: {
              name: String(tu.name),
              arguments: (tu.input || {}) as Record<string, unknown>,
            },
          })),
        });
        continue;
      }

      // Regular content blocks — join text
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text || ""))
        .join("\n");
      result.push({ role: msg.role as "user" | "assistant", content: text });
    }
  }

  return result;
}

/** Stream chat completion from Ollama, returning result in Anthropic-compatible format */
export async function ollamaChatStream(
  ollamaUrl: string,
  model: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  onText?: (delta: string) => void,
): Promise<OllamaStreamResult> {
  const ollamaMessages = convertMessages(systemPrompt, messages);
  const ollamaTools = tools.length > 0 ? convertTools(tools) : undefined;

  const body: OllamaChatRequest = {
    model,
    messages: ollamaMessages,
    stream: true,
    tools: ollamaTools,
  };

  const response = await postOllamaChat(ollamaUrl, body);

  if (!response.body) {
    throw new Error("Ollama returned no response body");
  }

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const allToolCalls: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }> = [];

  // Read NDJSON stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);

        if (chunk.message?.content) {
          fullText += chunk.message.content;
          onText?.(chunk.message.content);
        }

        if (chunk.message?.tool_calls) {
          allToolCalls.push(...chunk.message.tool_calls);
        }

        if (chunk.done) {
          inputTokens = chunk.prompt_eval_count || 0;
          outputTokens = chunk.eval_count || 0;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      const chunk: OllamaStreamChunk = JSON.parse(buffer);
      if (chunk.message?.content) {
        fullText += chunk.message.content;
        onText?.(chunk.message.content);
      }
      if (chunk.message?.tool_calls) {
        allToolCalls.push(...chunk.message.tool_calls);
      }
      if (chunk.done) {
        inputTokens = chunk.prompt_eval_count || 0;
        outputTokens = chunk.eval_count || 0;
      }
    } catch {
      // ignore
    }
  }

  // Convert tool calls to Anthropic format
  const toolCalls = allToolCalls.map((tc) => ({
    id: `toolu_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    name: tc.function.name,
    input: tc.function.arguments,
  }));

  // Build content blocks
  const content: OllamaStreamResult["content"] = [];
  if (fullText) {
    content.push({ type: "text", text: fullText });
  }
  for (const tc of toolCalls) {
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
  }

  const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";

  return {
    text: fullText,
    toolCalls,
    inputTokens,
    outputTokens,
    stopReason,
    content,
  };
}

/** Non-streaming chat completion (for utility calls) */
export async function ollamaChat(
  ollamaUrl: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const body: OllamaChatRequest = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
    options: {
      temperature: options?.temperature ?? 0.3,
      num_predict: options?.maxTokens ?? 1024,
    },
  };

  const response = await postOllamaChat(ollamaUrl, body);

  const data = (await response.json()) as OllamaStreamChunk;

  return {
    text: data.message?.content || "",
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
  };
}

/** Check if a specific model is available in Ollama */
export async function checkOllamaModel(
  ollamaUrl: string,
  model: string,
): Promise<{ available: boolean; error?: string }> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) {
      return { available: false, error: `Ollama not reachable (${response.status})` };
    }
    const data = (await response.json()) as OllamaTagsResponse;
    const found = (data.models || []).some(
      (m) => m.name === model || m.name.startsWith(model + ":"),
    );
    return { available: found };
  } catch (err) {
    return { available: false, error: (err as Error).message };
  }
}

/** Pull a model in Ollama (for LLM models like qwen3.5) */
export async function pullOllamaLLMModel(
  ollamaUrl: string,
  model: string,
): Promise<void> {
  const response = await fetch(`${ollamaUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to pull model ${model}: ${errText}`);
  }

  // Consume the stream (pull progress)
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}
