import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { JoiConfig } from "../config/schema.js";
import { query } from "../db/client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolDefinitions, executeTool, type ToolContext } from "./tools.js";
import {
  getModelClient,
  getOllamaUrl,
  isAnthropicModel,
  type ModelProvider,
  type ModelTask,
} from "./model-router.js";
import { ollamaChatStream, type OllamaStreamResult } from "./ollama-llm.js";
import { loadSessionContextScoped } from "../knowledge/searcher.js";
import { afterAgentRun, type ToolInteraction } from "../knowledge/hooks.js";
import { maybeFlushContext } from "../knowledge/flush.js";
import { loadConversationScope, resolveAllowedScopes } from "../access/scope.js";
import { recordUsage, estimateCost } from "./usage-tracker.js";

/** Strip <think>...</think> reasoning tags from model output (e.g., Qwen 3.5) */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

const LIGHTWEIGHT_CHAT_MAX_CHARS = 80;
const LIGHTWEIGHT_CHAT_REGEX = /^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|test|ping|dd|why are you so slow)\b/i;
const TOOL_INTENT_REGEX = /\b(show|list|find|search|look up|lookup|check|run|execute|sync|update|create|delete|send|email|message|call|schedule|remind|task|todo|job|contact|calendar|note|memory|knowledge|log|report|status|health|settings|agent|autodev|review|analy[sz]e|summari[sz]e|write|read|open|fetch)\b/i;
const HISTORY_CONTENT_MAX_CHARS = 1400;
const HISTORY_TOOL_RESULT_MAX_CHARS = 1800;

function compactHistoryText(text: string | null | undefined, maxChars: number): string {
  const source = typeof text === "string" ? text : "";
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars)}\n\n[truncated ${source.length - maxChars} chars]`;
}

function shouldUseToolsForMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.length > LIGHTWEIGHT_CHAT_MAX_CHARS) return true;
  if (LIGHTWEIGHT_CHAT_REGEX.test(trimmed)) return false;
  return TOOL_INTENT_REGEX.test(trimmed);
}

// ── OpenAI format converters (for non-Anthropic models on OpenRouter) ──

/** Convert Anthropic tools to OpenAI function-calling format */
function toolsToOpenAI(tools: Anthropic.Tool[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: (t.input_schema || {}) as Record<string, unknown>,
    },
  }));
}

/** Convert Anthropic message history to OpenAI chat messages */
function messagesToOpenAI(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // May contain tool_result blocks or text
        const toolResults = msg.content.filter(
          (b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result",
        );
        const textBlocks = msg.content.filter(
          (b): b is Anthropic.TextBlockParam => b.type === "text",
        );
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          });
        }
        for (const tb of textBlocks) {
          result.push({ role: "user", content: tb.text });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: textParts.join("") || (toolCalls.length > 0 ? `[Called tools: ${toolCalls.map((tc) => "function" in tc ? tc.function.name : "tool").join(", ")}]` : null),
        };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      }
    }
  }
  return result;
}

/** Stream a response from OpenAI-compatible client, returns text + tool calls */
async function openaiStream(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  forceToolUse: boolean,
  onText: (delta: string) => void,
): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}> {
  const openaiMessages = messagesToOpenAI(systemPrompt, messages);
  const openaiTools = tools.length > 0 ? toolsToOpenAI(tools) : undefined;

  const stream = await client.chat.completions.create({
    model,
    max_tokens: 8192,
    messages: openaiMessages,
    tools: openaiTools,
    tool_choice: openaiTools && forceToolUse ? "required" : undefined,
    stream: true,
    stream_options: { include_usage: true },
  });

  let text = "";
  // Accumulate tool call deltas by index
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (choice) {
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        onText(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: "" });
          }
          const entry = toolCallMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
    }
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
  }

  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  for (const [, entry] of toolCallMap) {
    let input: unknown = {};
    try { input = JSON.parse(entry.args); } catch { input = {}; }
    toolCalls.push({ id: entry.id, name: entry.name, input });
  }

  const stopReason = finishReason === "tool_calls" ? "tool_use" : "end_turn";

  return { text, toolCalls, inputTokens, outputTokens, stopReason };
}

export interface AgentRunOptions {
  conversationId: string;
  agentId: string;
  userMessage: string;
  config: JoiConfig;
  model?: string;   // Client-requested model override (highest priority)
  toolTask?: ModelTask; // Model route for tool loop (default: "tool")
  chatTask?: ModelTask; // Model route for final response (default: "chat")
  depth?: number;
  systemPromptSuffix?: string; // Extra text appended to system prompt (e.g. voice mode instructions)
  enableTools?: boolean; // Disable tools for latency-sensitive paths (e.g. voice)
  historyLimit?: number; // Conversation history window size
  includeMemoryContext?: boolean; // Skip global memory context for faster turns
  includeSkillsPrompt?: boolean; // Exclude long skills index from system prompt on latency-sensitive routes
  forceToolUse?: boolean; // Force at least one tool call before answering (best for voice action intents)
  broadcast?: (type: string, data: unknown) => void;
  onStream?: (delta: string) => void;
  onToolPlan?: (toolCalls: Array<{ id: string; name: string; input: unknown }>) => void;
  onToolUse?: (name: string, input: unknown, id: string) => void;
  onToolResult?: (id: string, result: unknown) => void;
}

export interface AgentTimings {
  setupMs: number;
  memoryMs: number;
  promptMs: number;
  historyMs: number;
  llmMs: number;
  totalMs: number;
}

export interface AgentRunResult {
  messageId: string;
  content: string;
  model: string;
  provider: string;
  toolModel?: string;
  toolProvider?: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  timings: AgentTimings;
}

async function loadConversationHistory(
  conversationId: string,
  limit = 20,
): Promise<Anthropic.MessageParam[]> {
  const result = await query<{
    role: string;
    content: string | null;
    tool_calls: unknown;
    tool_results: unknown;
  }>(
    `SELECT role, content, tool_calls, tool_results
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );

  const messages: Anthropic.MessageParam[] = [];

  for (const row of result.rows.reverse()) {
    if (row.role === "user") {
      messages.push({ role: "user", content: compactHistoryText(row.content || "", HISTORY_CONTENT_MAX_CHARS) });
    } else if (row.role === "assistant") {
      const content: Anthropic.ContentBlock[] = [];
      if (row.content) {
        content.push({ type: "text", text: compactHistoryText(row.content, HISTORY_CONTENT_MAX_CHARS) } as Anthropic.TextBlock);
      }
      if (row.tool_calls && Array.isArray(row.tool_calls)) {
        for (const tc of row.tool_calls as Array<{ id: string; name: string; input: unknown }>) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input as Record<string, unknown>,
          });
        }
      }
      if (content.length > 0) {
        messages.push({ role: "assistant", content });
      }
    } else if (row.role === "tool" && row.tool_results && Array.isArray(row.tool_results)) {
      const toolContent: Anthropic.ToolResultBlockParam[] = (
        row.tool_results as Array<{ tool_use_id: string; content: string }>
      ).map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.tool_use_id,
        content: compactHistoryText(tr.content, HISTORY_TOOL_RESULT_MAX_CHARS),
      }));
      messages.push({ role: "user", content: toolContent });
    }
  }

  return messages;
}

export async function saveMessage(
  conversationId: string,
  role: string,
  content: string | null,
  model: string | null,
  toolCalls: unknown[] | null,
  toolResults: unknown[] | null,
  tokenUsage: unknown | null,
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO messages (conversation_id, role, content, model, tool_calls, tool_results, token_usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      conversationId,
      role,
      content,
      model,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
    ],
  );
  return result.rows[0].id;
}

export async function ensureConversation(
  conversationId: string | undefined,
  agentId: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  if (conversationId) {
    const result = await query<{ id: string }>(
      "SELECT id FROM conversations WHERE id = $1",
      [conversationId],
    );
    if (result.rows.length > 0) return conversationId;
  }

  const result = await query<{ id: string }>(
    `INSERT INTO conversations (agent_id, title, metadata)
     VALUES ($1, 'New conversation', $2)
     RETURNING id`,
    [agentId, JSON.stringify(metadata || {})],
  );
  return result.rows[0].id;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const {
    conversationId: inputConvId,
    agentId,
    userMessage,
    config,
    model: clientModel,
    toolTask = "tool",
    chatTask = "chat",
    enableTools = true,
    historyLimit = 20,
    includeMemoryContext = true,
    includeSkillsPrompt = true,
    forceToolUse = false,
    depth = 0,
    systemPromptSuffix,
    broadcast,
    onStream,
    onToolPlan,
    onToolUse,
    onToolResult,
  } = options;
  const runStartedAt = Date.now();
  const timings = { setupMs: 0, memoryMs: 0, promptMs: 0, historyMs: 0, llmMs: 0, totalMs: 0 };
  let tMark = runStartedAt;

  console.log(`[runAgent] START agentId=${agentId}, hasOnStream=${!!onStream}, userMessage=${JSON.stringify(userMessage.slice(0, 100))}`);

  const conversationId = await ensureConversation(inputConvId, agentId);
  console.log(`[runAgent] conversationId=${conversationId}`);

  // Load channel language (conversation → channel_id → language)
  let channelLanguage = "en";
  let conversationScope = "personal";
  let conversationScopeMetadata: Record<string, unknown> = {};
  let conversationCompanyId: string | undefined;
  let conversationContactId: string | undefined;
  try {
    const scopeInfo = await loadConversationScope(conversationId);
    conversationScope = scopeInfo.scope;
    conversationScopeMetadata = scopeInfo.metadata;
    conversationCompanyId = scopeInfo.companyId;
    conversationContactId = scopeInfo.contactId;

    const convRow = await query<{ channel_id: string | null }>(
      "SELECT channel_id FROM conversations WHERE id = $1", [conversationId]);
    const chId = convRow.rows[0]?.channel_id;
    if (chId) {
      const chRow = await query<{ language: string | null }>(
        "SELECT language FROM channel_configs WHERE id = $1", [chId]);
      channelLanguage = chRow.rows[0]?.language || "en";
    }
  } catch { /* non-critical */ }

  // Save user message
  await saveMessage(conversationId, "user", userMessage, null, null, null, null);

  // Load agent config from DB
  const agentResult = await query<{
    system_prompt: string | null;
    model: string;
    skills: string[] | null;
    config: Record<string, unknown> | null;
  }>(
    "SELECT system_prompt, model, skills, config FROM agents WHERE id = $1",
    [agentId],
  );

  let agentRow = agentResult.rows[0];
  if (!agentRow) {
    console.error(`[runAgent] Agent "${agentId}" not found in database, falling back to "personal"`);
    const fallback = await query<{ system_prompt: string | null; model: string; skills: string[] | null; config: Record<string, unknown> | null }>(
      "SELECT system_prompt, model, skills, config FROM agents WHERE id = $1", ["personal"]);
    agentRow = fallback.rows[0];
  }
  // Client-requested model takes highest priority, then agent DB model
  const agentModelOverride = clientModel || agentRow?.model;
  const agentConfig = agentRow?.config || {};
  const maxSpawnDepth = (agentConfig.maxSpawnDepth as number) ?? 2;
  const systemGlobalAccessRoles = new Set([
    "store-auditor",
    "knowledge-sync",
    "knowledge-system",
    "skill-scout",
    "security-officer",
    "devops-agent",
  ]);
  const agentRole = typeof agentConfig.role === "string" ? agentConfig.role : "";
  const allowGlobalDataAccess =
    agentConfig.allowGlobalDataAccess === true
    || systemGlobalAccessRoles.has(agentRole)
    || systemGlobalAccessRoles.has(agentId);
  const configuredAllowedScopes = Array.isArray(agentConfig.allowedScopes)
    ? (agentConfig.allowedScopes as unknown[])
      .filter((item): item is string => typeof item === "string")
    : null;
  const allowedScopes = resolveAllowedScopes({
    scope: conversationScope,
    allowedScopes: configuredAllowedScopes,
    allowGlobalDataAccess,
  });

  // Get tool definitions (filtered by agent skills, or all if skills is null).
  // For short personal-chat turns, skip the tool layer to avoid an unnecessary
  // two-phase roundtrip (tool model + chat model) and large tool-schema prompts.
  const smartToolGatingEnabled = process.env.JOI_SMART_TOOL_GATING !== "0";
  const disableToolsForTurn =
    smartToolGatingEnabled &&
    enableTools &&
    !forceToolUse &&
    depth === 0 &&
    agentId === "personal" &&
    !shouldUseToolsForMessage(userMessage);

  const agentSkills = agentRow?.skills ?? null;
  const tools = enableTools && !disableToolsForTurn ? getToolDefinitions(agentSkills) : [];
  if (disableToolsForTurn) {
    console.log("[runAgent] Smart tool gating: disabled tools + memory + skills, reduced history for lightweight personal turn");
  }

  // Two-phase model routing:
  // - "tool" model: cheap/fast, handles tool-calling loop (GPT-4o-mini)
  // - "chat" model: smart, generates the final response (Claude Sonnet, Qwen, etc.)
  // When tool and chat routes differ, we use the tool model for orchestration,
  // then switch to the chat model for the final answer.
  console.log(`[runAgent] Resolving models: agentModelOverride=${agentModelOverride}, tools=${tools.length}`);
  const toolRoute = tools.length > 0 ? await getModelClient(config, toolTask, agentModelOverride) : null;
  const chatRoute = await getModelClient(config, chatTask, agentModelOverride);
  console.log(`[runAgent] toolRoute: ${toolRoute ? `${toolRoute.provider}/${toolRoute.model}` : "none"}, chatRoute: ${chatRoute.provider}/${chatRoute.model}`);

  // If tool route is the same model as chat, or no tools, just use one model
  const isTwoPhase = toolRoute !== null && toolRoute.model !== chatRoute.model;

  // Start with tool model for orchestration (or chat model if same)
  const activeRoute = isTwoPhase ? toolRoute : chatRoute;
  let { client, openaiClient, model, provider } = activeRoute;
  console.log(`[runAgent] Using provider=${provider}, model=${model}, isTwoPhase=${isTwoPhase}, hasAnthropicClient=${!!client}, hasOpenAIClient=${!!openaiClient}`);

  timings.setupMs = Date.now() - tMark;
  tMark = Date.now();

  // Load memory context for system prompt
  // Skip memory for lightweight turns (tools already disabled, memory won't help)
  let memoryContext = "";
  if (includeMemoryContext && !disableToolsForTurn) {
    try {
      const ctx = await loadSessionContextScoped(config, {
        tenantScope: allowGlobalDataAccess ? undefined : conversationScope,
        companyId: allowGlobalDataAccess ? undefined : conversationCompanyId,
        contactId: allowGlobalDataAccess ? undefined : conversationContactId,
      });
      const sections: string[] = [];

      if (ctx.identity.length > 0) {
        sections.push(`## About the User\n${ctx.identity.map((m) => `- ${m}`).join("\n")}`);
      }
      if (ctx.preferences.length > 0) {
        sections.push(`## User Preferences\n${ctx.preferences.map((m) => `- ${m}`).join("\n")}`);
      }
      if (ctx.solutions.length > 0) {
        sections.push(`## Learned Approaches\nYou have handled similar situations before. Use these lessons:\n${ctx.solutions.map((m) => `- ${m}`).join("\n")}`);
      }
      if (ctx.recentEpisodes.length > 0) {
        sections.push(`## Recent Context (Last 3 Days)\n${ctx.recentEpisodes.map((m) => `- ${m}`).join("\n")}`);
      }

      if (sections.length > 0) {
        memoryContext = "\n\n" + sections.join("\n\n");
      }
    } catch (err) {
      // Memory system might not be migrated yet — that's OK
      console.warn("Failed to load memory context (memories table may not exist yet):", (err as Error).message);
    }
  }

  timings.memoryMs = Date.now() - tMark;
  tMark = Date.now();

  // Skip skills prompt for lightweight turns (tools are disabled anyway)
  const effectiveIncludeSkills = disableToolsForTurn ? false : includeSkillsPrompt;

  const systemPrompt = buildSystemPrompt(agentRow?.system_prompt || undefined, {
    includeSkillsPrompt: effectiveIncludeSkills,
    language: channelLanguage,
  }) + memoryContext
    + (systemPromptSuffix ? "\n\n" + systemPromptSuffix : "");

  timings.promptMs = Date.now() - tMark;
  tMark = Date.now();

  // Load history (reduce for lightweight turns — full history is unnecessary)
  const effectiveHistoryLimit = disableToolsForTurn ? 10 : historyLimit;
  const history = await loadConversationHistory(conversationId, effectiveHistoryLimit);

  // Pre-compaction memory flush (fire-and-forget)
  if (config.memory.autoLearn) {
    maybeFlushContext(conversationId, config)
      .catch((err) => console.warn("[Flush] Pre-compaction flush failed:", err));
  }

  timings.historyMs = Date.now() - tMark;
  tMark = Date.now();

  // Tool use loop (max 10 iterations)
  let messages = [...history];
  let fullContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  const toolInteractions: ToolInteraction[] = [];
  let toolsWereCalled = false;
  let assistantMessageId: string | null = null;

  for (let i = 0; i < 10; i++) {
    console.log(`[runAgent] Loop iteration ${i}, provider=${provider}, model=${model}`);
    let assistantText = "";
    let toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let iterInputTokens = 0;
    let iterOutputTokens = 0;
    let stopReason: string = "end_turn";
    const forceToolsThisIteration = forceToolUse && !toolsWereCalled;

    if (provider === "ollama") {
      // Use Ollama adapter
      const ollamaUrl = getOllamaUrl(config);
      const result: OllamaStreamResult = await ollamaChatStream(
        ollamaUrl,
        model,
        systemPrompt,
        messages,
        tools.length > 0 ? tools : [],
        // In two-phase mode, never stream tool model text — chat model handles final response
        (delta) => { if (!isTwoPhase) onStream?.(delta); },
      );
      assistantText = result.text;
      toolCalls = result.toolCalls;
      iterInputTokens = result.inputTokens;
      iterOutputTokens = result.outputTokens;
      stopReason = result.stopReason;
    } else if (openaiClient) {
      // Use OpenAI SDK (non-Anthropic models on OpenRouter)
      const result = await openaiStream(
        openaiClient,
        model,
        systemPrompt,
        messages,
        tools,
        forceToolsThisIteration,
        (delta) => { if (!isTwoPhase) onStream?.(delta); },
      );
      assistantText = result.text;
      toolCalls = result.toolCalls;
      iterInputTokens = result.inputTokens;
      iterOutputTokens = result.outputTokens;
      stopReason = result.stopReason;
    } else {
      // Use Anthropic SDK (direct or OpenRouter with anthropic/* models)
      const stream = client!.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 && forceToolsThisIteration ? { type: "any" } : undefined,
      });

      stream.on("text", (delta) => {
        assistantText += delta;
        // In two-phase mode, never stream tool model text — chat model handles final response
        if (!isTwoPhase) onStream?.(delta);
      });

      const response = await stream.finalMessage();
      iterInputTokens = response.usage.input_tokens;
      iterOutputTokens = response.usage.output_tokens;
      stopReason = response.stop_reason || "end_turn";

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }
    }

    console.log(`[runAgent] Iteration ${i} done: stopReason=${stopReason}, textLen=${assistantText.length}, toolCalls=${toolCalls.length}, tokens=${iterInputTokens}/${iterOutputTokens}`);

    totalInputTokens += iterInputTokens;
    totalOutputTokens += iterOutputTokens;

    // Record usage and accumulate cost
    totalCostUsd += estimateCost(provider as ModelProvider, model, iterInputTokens, iterOutputTokens);
    recordUsage({
      provider,
      model,
      task: isTwoPhase ? (toolTask === "voice" ? "voice" : "tool") : (chatTask === "voice" ? "voice" : "chat"),
      inputTokens: iterInputTokens,
      outputTokens: iterOutputTokens,
      conversationId,
      agentId,
    }).catch(() => {});

    if (stopReason !== "tool_use" || toolCalls.length === 0) {
      // No more tool calls
      if (isTwoPhase) {
        // Two-phase: don't save the tool model's final text to DB.
        // The chat model will generate the actual response below.
        // (Avoids consecutive assistant messages in history.)
      } else {
        // Single-phase: save the response normally
        const cleanedText = stripThinkTags(assistantText);
        assistantMessageId = await saveMessage(
          conversationId, "assistant", cleanedText || null, model,
          null, null,
          {
            inputTokens: iterInputTokens,
            outputTokens: iterOutputTokens,
            latencyMs: Date.now() - runStartedAt,
          },
        );
        fullContent += cleanedText;
      }
      break;
    }

    // Tools were called — save assistant message (includes tool_use blocks)
    onToolPlan?.(toolCalls);
    toolsWereCalled = true;
    assistantMessageId = await saveMessage(
      conversationId, "assistant", assistantText || null, model,
      toolCalls, null,
      { inputTokens: iterInputTokens, outputTokens: iterOutputTokens },
    );
    fullContent += assistantText;

    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    const toolContext: ToolContext = {
      config,
      conversationId,
      agentId,
      agentConfig,
      scope: conversationScope,
      scopeMetadata: conversationScopeMetadata,
      allowedScopes,
      allowGlobalDataAccess,
      companyId: conversationCompanyId,
      contactId: conversationContactId,
      depth,
      maxDepth: maxSpawnDepth,
      broadcast,
      spawnAgent: async (opts) => {
        const childResult = await runAgent({
          conversationId: opts.parentConversationId || "",
          agentId: opts.agentId,
          userMessage: opts.message,
          config,
          depth: depth + 1,
          broadcast,
        });
        return {
          content: childResult.content,
          model: childResult.model,
          usage: childResult.usage,
        };
      },
    };

    for (const tc of toolCalls) {
      onToolUse?.(tc.name, tc.input, tc.id);
      const result = await executeTool(tc.name, tc.input, toolContext);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      toolResults.push({ tool_use_id: tc.id, content: resultStr });
      toolInteractions.push({ name: tc.name, input: tc.input, result: resultStr });
      onToolResult?.(tc.id, result);
    }

    await saveMessage(conversationId, "tool", null, null, null, toolResults, null);

    messages = [...messages];
    const assistantContent: Anthropic.ContentBlock[] = [];
    if (assistantText) {
      assistantContent.push({ type: "text", text: assistantText } as Anthropic.TextBlock);
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input as Record<string, unknown>,
      });
    }
    messages.push({ role: "assistant", content: assistantContent });

    messages.push({
      role: "user",
      content: toolResults.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    });
  }

  // ── Two-phase: final response with chat model ──
  // In two-phase mode, always use the smart chat model for the final response.
  // This ensures high-quality output whether or not tools were called.
  if (isTwoPhase) {
    const chatClient = chatRoute.client;
    const chatOpenAIClient = chatRoute.openaiClient;
    const chatModel = chatRoute.model;
    const chatProvider = chatRoute.provider;

    let finalText = "";
    let finalInputTokens = 0;
    let finalOutputTokens = 0;

    if (chatProvider === "ollama") {
      const ollamaUrl = getOllamaUrl(config);
      const result: OllamaStreamResult = await ollamaChatStream(
        ollamaUrl,
        chatModel,
        systemPrompt,
        messages,
        [], // No tools — just generate text
        (delta) => onStream?.(delta),
      );
      finalText = result.text;
      finalInputTokens = result.inputTokens;
      finalOutputTokens = result.outputTokens;
    } else if (chatOpenAIClient) {
      // Non-Anthropic model on OpenRouter → OpenAI SDK
      const result = await openaiStream(
        chatOpenAIClient,
        chatModel,
        systemPrompt,
        messages,
        [], // No tools — pure text response
        false,
        (delta) => onStream?.(delta),
      );
      finalText = result.text;
      finalInputTokens = result.inputTokens;
      finalOutputTokens = result.outputTokens;
    } else {
      const stream = chatClient!.messages.stream({
        model: chatModel,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        // No tools — pure text response
      });

      stream.on("text", (delta) => {
        finalText += delta;
        onStream?.(delta);
      });

      const response = await stream.finalMessage();
      finalInputTokens = response.usage.input_tokens;
      finalOutputTokens = response.usage.output_tokens;
    }

    totalInputTokens += finalInputTokens;
    totalOutputTokens += finalOutputTokens;
    totalCostUsd += estimateCost(chatProvider as ModelProvider, chatModel, finalInputTokens, finalOutputTokens);
    finalText = stripThinkTags(finalText);
    fullContent = finalText; // Replace with chat model's response

    recordUsage({
      provider: chatProvider,
      model: chatModel,
      task: chatTask === "voice" ? "voice" : "chat",
      inputTokens: finalInputTokens,
      outputTokens: finalOutputTokens,
      conversationId,
      agentId,
    }).catch(() => {});

    assistantMessageId = await saveMessage(
      conversationId,
      "assistant",
      finalText,
      chatModel,
      null,
      null,
      {
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        latencyMs: Date.now() - runStartedAt,
      },
    );

    // Return the chat model info (the one that generated the final response)
    model = chatModel;
    provider = chatProvider;
  }

  // Update conversation title
  const msgCount = await query<{ count: string }>(
    "SELECT count(*) FROM messages WHERE conversation_id = $1",
    [conversationId],
  );
  if (Number(msgCount.rows[0].count) <= 3) {
    const title = userMessage.length > 50
      ? userMessage.substring(0, 50) + "..."
      : userMessage;
    await query(
      "UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2",
      [title, conversationId],
    );
  } else {
    await query(
      "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
      [conversationId],
    );
  }

  // Auto-learn from this conversation (fire-and-forget)
  if (config.memory.autoLearn) {
    afterAgentRun({
      conversationId,
      agentId,
      userMessage,
      assistantResponse: fullContent,
      toolInteractions,
      scope: allowGlobalDataAccess ? undefined : conversationScope,
      scopeMetadata: conversationScopeMetadata,
      companyId: allowGlobalDataAccess ? undefined : conversationCompanyId,
      contactId: allowGlobalDataAccess ? undefined : conversationContactId,
      config,
    }).catch((err) => console.warn("[AutoLearn] Hook failed:", err));
  }

  timings.llmMs = Date.now() - tMark;
  timings.totalMs = Date.now() - runStartedAt;
  console.log(`[runAgent] TIMINGS setup=${timings.setupMs}ms mem=${timings.memoryMs}ms prompt=${timings.promptMs}ms hist=${timings.historyMs}ms llm=${timings.llmMs}ms total=${timings.totalMs}ms`);

  return {
    messageId: assistantMessageId || crypto.randomUUID(),
    content: fullContent,
    model,
    provider,
    toolModel: isTwoPhase ? toolRoute!.model : undefined,
    toolProvider: isTwoPhase ? toolRoute!.provider : undefined,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
    costUsd: totalCostUsd,
    timings,
  };
}
