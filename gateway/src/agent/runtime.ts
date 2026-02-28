import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JoiConfig } from "../config/schema.js";
import { query } from "../db/client.js";
import { buildSystemPrompt, buildCachedSystemBlocks } from "./system-prompt.js";
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
import { logError, logWarn } from "../logging.js";
import { readSoulDocumentForAgent } from "./soul-documents.js";
import { chooseSoulForConversation, persistConversationSoulSelection } from "./soul-rollouts.js";
import { transcribeAudioFile } from "../youtube/transcriber.js";
import {
  maybeSimulateLatency,
  normalizeExecutionMode,
  type AgentExecutionMode,
  type AgentLatencyProfile,
} from "./execution-mode.js";
import { isLegacyUnrestrictedSkills, normalizeAgentSkills } from "./skill-policy.js";

/** Strip <think>...</think> reasoning tags from model output (e.g., Qwen 3.5) */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

function summarizeProviderError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return typeof err === "string" ? err : "Unknown provider error";
  }

  const rec = err as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof rec.status === "number") {
    parts.push(`status=${rec.status}`);
  }
  if (typeof rec.message === "string" && rec.message.trim().length > 0) {
    parts.push(rec.message.trim());
  }

  const providerError = rec.error;
  if (providerError && typeof providerError === "object") {
    const providerRec = providerError as Record<string, unknown>;
    const providerCode = typeof providerRec.code === "string" ? providerRec.code : null;
    const providerMessage = typeof providerRec.message === "string" ? providerRec.message : null;
    if (providerCode || providerMessage) {
      parts.push(`provider=${[providerCode, providerMessage].filter(Boolean).join(": ")}`);
    } else {
      try {
        const serialized = JSON.stringify(providerRec);
        if (serialized) parts.push(`provider=${serialized.slice(0, 280)}`);
      } catch {
        // ignore serialization errors
      }
    }
  }

  const responseObj = rec.response;
  if (responseObj && typeof responseObj === "object") {
    const body = (responseObj as Record<string, unknown>).body;
    if (typeof body === "string" && body.trim().length > 0) {
      parts.push(`body=${body.trim().slice(0, 280)}`);
    }
  }

  if (parts.length === 0) return "Unknown provider error";
  return parts.join(" | ");
}

// Tool gating is now handled by the LLM intent classifier in intent-classifier.ts.
// The caller passes enableTools based on the classification result.
const HISTORY_CONTENT_MAX_CHARS = 1400;
const HISTORY_TOOL_RESULT_MAX_CHARS = 1800;
const VISION_MAX_ATTACHMENTS = Math.max(
  1,
  Number.parseInt(process.env.JOI_VISION_MAX_ATTACHMENTS || "4", 10) || 4,
);
const VISION_MAX_IMAGE_BYTES = Math.max(
  256_000,
  Number.parseInt(process.env.JOI_VISION_MAX_IMAGE_BYTES || String(8 * 1024 * 1024), 10) || (8 * 1024 * 1024),
);
const ATTACHMENT_TEXT_MAX_CHARS = Math.max(
  2_000,
  Number.parseInt(process.env.JOI_ATTACHMENT_TEXT_MAX_CHARS || "12000", 10) || 12000,
);
const ATTACHMENT_TEXT_PER_FILE_MAX_CHARS = Math.max(
  1_000,
  Number.parseInt(process.env.JOI_ATTACHMENT_TEXT_PER_FILE_MAX_CHARS || "4000", 10) || 4000,
);
const ATTACHMENT_AUDIO_MAX_BYTES = Math.max(
  1_000_000,
  Number.parseInt(process.env.JOI_ATTACHMENT_AUDIO_MAX_BYTES || String(25 * 1024 * 1024), 10) || (25 * 1024 * 1024),
);

function compactHistoryText(text: string | null | undefined, maxChars: number): string {
  const source = typeof text === "string" ? text : "";
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars)}\n\n[truncated ${source.length - maxChars} chars]`;
}

export interface UserAttachmentInput {
  type: string;
  url?: string;
  data?: string;
  name?: string;
  mimeType?: string;
  mediaId?: string;
  size?: number;
}

type ResolvedImageAttachment = {
  mediaType: string;
  base64Data: string;
  label: string;
};

function normalizeImageMediaType(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const normalized = mimeType.trim().toLowerCase().replace(/;.*$/, "");
  if (!normalized.startsWith("image/")) return null;
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function isImageAttachment(att: UserAttachmentInput): boolean {
  if (normalizeImageMediaType(att.mimeType)) return true;
  if (att.type === "photo") return true;
  if (typeof att.data === "string" && att.data.trim().startsWith("data:image/")) return true;
  if (typeof att.url === "string" && /(\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.heic|\.heif)(\?|$)/i.test(att.url)) return true;
  return false;
}

function attachmentLabel(att: UserAttachmentInput, index: number): string {
  return att.name?.trim() || att.type || `attachment-${index + 1}`;
}

function parseImageDataUrl(raw: string, fallbackMimeType?: string): { mediaType: string; base64Data: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/s.exec(trimmed);
  if (dataUrlMatch) {
    const mediaType = normalizeImageMediaType(dataUrlMatch[1]);
    if (!mediaType) return null;
    const base64Data = dataUrlMatch[2].replace(/\s+/g, "");
    if (!base64Data) return null;
    return { mediaType, base64Data };
  }

  const fallback = normalizeImageMediaType(fallbackMimeType);
  if (!fallback) return null;
  return { mediaType: fallback, base64Data: trimmed.replace(/\s+/g, "") };
}

function estimateBase64Bytes(base64Data: string): number {
  const cleaned = base64Data.replace(/\s+/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function extractMediaIdFromAttachment(att: UserAttachmentInput): string | null {
  if (att.mediaId && att.mediaId.trim().length > 0) return att.mediaId.trim();
  if (!att.url) return null;
  const match = /\/api\/media\/([^/]+)\/file(?:\?|$)/.exec(att.url);
  return match?.[1] || null;
}

function trimAttachmentsForStorage(attachments: UserAttachmentInput[] | undefined): UserAttachmentInput[] | null {
  if (!attachments || attachments.length === 0) return null;
  const trimmed = attachments
    .slice(0, 16)
    .map((att) => {
      const next: UserAttachmentInput = { type: att.type || "unknown" };
      if (att.url) next.url = att.url;
      if (att.name) next.name = att.name.slice(0, 256);
      if (att.mimeType) next.mimeType = att.mimeType.slice(0, 128);
      if (att.mediaId) next.mediaId = att.mediaId;
      if (typeof att.size === "number" && Number.isFinite(att.size) && att.size > 0) {
        next.size = Math.floor(att.size);
      }
      return next;
    })
    .filter((att) => att.type.trim().length > 0);
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveImageAttachment(
  att: UserAttachmentInput,
  config: JoiConfig,
  index: number,
): Promise<ResolvedImageAttachment | null> {
  const label = attachmentLabel(att, index);

  if (typeof att.data === "string" && att.data.trim().length > 0) {
    const parsed = parseImageDataUrl(att.data, att.mimeType);
    if (!parsed) return null;
    if (estimateBase64Bytes(parsed.base64Data) > VISION_MAX_IMAGE_BYTES) return null;
    return { mediaType: parsed.mediaType, base64Data: parsed.base64Data, label };
  }

  const mediaId = extractMediaIdFromAttachment(att);
  if (!mediaId) return null;

  const mediaResult = await query<{ storage_path: string; mime_type: string | null }>(
    `SELECT storage_path, mime_type
     FROM media
     WHERE id = $1 AND status = 'ready'
     LIMIT 1`,
    [mediaId],
  );
  const mediaRow = mediaResult.rows[0];
  if (!mediaRow) return null;

  const mediaType = normalizeImageMediaType(mediaRow.mime_type || att.mimeType);
  if (!mediaType) return null;

  const filePath = path.join(config.media.storagePath, mediaRow.storage_path);
  const fileBytes = await readFile(filePath);
  if (fileBytes.length > VISION_MAX_IMAGE_BYTES) return null;

  return {
    mediaType,
    base64Data: fileBytes.toString("base64"),
    label,
  };
}

async function resolveImageAttachments(
  attachments: UserAttachmentInput[] | undefined,
  config: JoiConfig,
): Promise<{ images: ResolvedImageAttachment[]; skipped: string[] }> {
  if (!attachments || attachments.length === 0) {
    return { images: [], skipped: [] };
  }

  const images: ResolvedImageAttachment[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < attachments.length; i += 1) {
    if (images.length >= VISION_MAX_ATTACHMENTS) {
      skipped.push(`${attachments.length - i} additional image(s) skipped`);
      break;
    }
    const att = attachments[i];
    if (!isImageAttachment(att)) {
      skipped.push(`${attachmentLabel(att, i)} (unsupported type: ${att.type || "unknown"})`);
      continue;
    }
    try {
      const resolved = await resolveImageAttachment(att, config, i);
      if (resolved) {
        images.push(resolved);
      } else {
        skipped.push(`${attachmentLabel(att, i)} (unavailable image data)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push(`${attachmentLabel(att, i)} (${message})`);
    }
  }

  return { images, skipped };
}

function isAudioAttachment(att: UserAttachmentInput): boolean {
  const mime = att.mimeType?.trim().toLowerCase() || "";
  if (mime.startsWith("audio/")) return true;
  return att.type === "audio" || att.type === "voice";
}

function isDocumentAttachment(att: UserAttachmentInput): boolean {
  const mime = att.mimeType?.trim().toLowerCase() || "";
  if (mime.startsWith("text/")) return true;
  if (mime === "application/pdf") return true;
  if (mime === "application/json") return true;
  if (mime === "application/xml") return true;
  return att.type === "document";
}

function parseAnyDataUrl(raw: string): { mimeType: string | null; bytes: Buffer } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dataUrlMatch = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i.exec(trimmed);
  if (!dataUrlMatch) return null;
  const mimeType = dataUrlMatch[1] ? dataUrlMatch[1].trim().toLowerCase() : null;
  const isBase64 = Boolean(dataUrlMatch[2]);
  const payload = dataUrlMatch[3] || "";
  try {
    if (isBase64) {
      return { mimeType, bytes: Buffer.from(payload.replace(/\s+/g, ""), "base64") };
    }
    return { mimeType, bytes: Buffer.from(decodeURIComponent(payload), "utf8") };
  } catch {
    return null;
  }
}

async function resolveAttachmentBuffer(
  att: UserAttachmentInput,
  config: JoiConfig,
): Promise<{ bytes: Buffer; mimeType: string | null } | null> {
  if (typeof att.data === "string" && att.data.trim().length > 0) {
    const parsed = parseAnyDataUrl(att.data);
    if (parsed) {
      return {
        bytes: parsed.bytes,
        mimeType: parsed.mimeType || (att.mimeType ? att.mimeType.trim().toLowerCase() : null),
      };
    }
  }

  const mediaId = extractMediaIdFromAttachment(att);
  if (!mediaId) return null;

  const mediaResult = await query<{ storage_path: string; mime_type: string | null }>(
    `SELECT storage_path, mime_type
     FROM media
     WHERE id = $1 AND status = 'ready'
     LIMIT 1`,
    [mediaId],
  );
  const mediaRow = mediaResult.rows[0];
  if (!mediaRow) return null;

  const filePath = path.join(config.media.storagePath, mediaRow.storage_path);
  const bytes = await readFile(filePath);
  return { bytes, mimeType: mediaRow.mime_type || att.mimeType || null };
}

function clampAttachmentText(raw: string): string {
  const compact = raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (compact.length <= ATTACHMENT_TEXT_PER_FILE_MAX_CHARS) return compact;
  return `${compact.slice(0, ATTACHMENT_TEXT_PER_FILE_MAX_CHARS)}\n...[truncated]`;
}

function tryDecodePlainText(bytes: Buffer): string | null {
  if (bytes.length === 0) return null;
  const text = bytes.toString("utf8");
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (!cleaned) return null;
  return clampAttachmentText(cleaned);
}

function extractPdfText(bytes: Buffer): string | null {
  if (bytes.length === 0) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joi-pdf-"));
  const pdfPath = path.join(tmpDir, "attachment.pdf");
  try {
    fs.writeFileSync(pdfPath, bytes);
    const output = execFileSync(
      "pdftotext",
      ["-layout", "-nopgbrk", pdfPath, "-"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const cleaned = output.replace(/\u0000/g, "").trim();
    if (!cleaned) return null;
    return clampAttachmentText(cleaned);
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function audioExtensionForMime(mimeType: string | null | undefined): string {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (normalized.includes("wav")) return ".wav";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return ".m4a";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
  if (normalized.includes("ogg") || normalized.includes("opus")) return ".ogg";
  if (normalized.includes("webm")) return ".webm";
  return ".wav";
}

async function transcribeAudioBytes(
  bytes: Buffer,
  mimeType: string | null | undefined,
  transcriberModel?: string,
): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > ATTACHMENT_AUDIO_MAX_BYTES) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joi-audio-"));
  const ext = audioExtensionForMime(mimeType);
  const audioPath = path.join(tmpDir, `attachment${ext}`);
  try {
    fs.writeFileSync(audioPath, bytes);
    const result = await transcribeAudioFile(audioPath, "auto", transcriberModel);
    const text = result.text?.trim() || "";
    if (!text) return null;
    return clampAttachmentText(text);
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function resolveAttachmentTextBlocks(
  attachments: UserAttachmentInput[] | undefined,
  config: JoiConfig,
  transcriberModel?: string,
): Promise<{ blocks: string[]; skipped: string[] }> {
  if (!attachments || attachments.length === 0) return { blocks: [], skipped: [] };

  const blocks: string[] = [];
  const skipped: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < attachments.length; i += 1) {
    const att = attachments[i];
    if (isImageAttachment(att)) continue;
    const label = attachmentLabel(att, i);
    const mime = att.mimeType?.trim().toLowerCase() || "unknown";

    let text: string | null = null;
    if (isAudioAttachment(att) || isDocumentAttachment(att)) {
      try {
        const payload = await resolveAttachmentBuffer(att, config);
        if (!payload) {
          skipped.push(`${label} (unavailable attachment data)`);
          continue;
        }
        const payloadMime = (payload.mimeType || mime || "").trim().toLowerCase();
        if (payloadMime === "application/pdf" || /\.pdf$/i.test(att.name || "")) {
          text = extractPdfText(payload.bytes);
          if (!text) {
            skipped.push(`${label} (could not extract PDF text; install pdftotext for best results)`);
            continue;
          }
        } else if (payloadMime.startsWith("audio/") || isAudioAttachment(att)) {
          text = await transcribeAudioBytes(payload.bytes, payloadMime, transcriberModel);
          if (!text) {
            skipped.push(`${label} (audio transcription failed or file too large)`);
            continue;
          }
        } else {
          text = tryDecodePlainText(payload.bytes);
          if (!text) {
            skipped.push(`${label} (unsupported document format)`);
            continue;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push(`${label} (${message})`);
        continue;
      }
    } else {
      skipped.push(`${label} (unsupported type: ${att.type || "unknown"})`);
      continue;
    }

    if (!text) continue;
    const block = `Attachment "${label}" (${mime}):\n${text}`;
    const projected = totalChars + block.length;
    if (projected > ATTACHMENT_TEXT_MAX_CHARS) {
      skipped.push(`${label} (text truncated due to context limit)`);
      break;
    }
    blocks.push(block);
    totalChars = projected;
  }

  return { blocks, skipped };
}

function buildUserTurnContent(
  userMessage: string,
  images: ResolvedImageAttachment[],
  attachmentTextBlocks: string[],
  skipped: string[],
): Anthropic.MessageParam["content"] {
  if (images.length === 0 && attachmentTextBlocks.length === 0 && skipped.length === 0) return userMessage;

  const blocks: Anthropic.ContentBlockParam[] = [];
  const textParts: string[] = [];
  const trimmed = userMessage.trim();
  if (trimmed.length > 0) textParts.push(trimmed);

  if (images.length > 0) {
    if (trimmed.length === 0) {
      textParts.push("Please analyze the attached image(s).");
    }
    textParts.push(`Image count: ${images.length}.`);
  }

  if (attachmentTextBlocks.length > 0) {
    if (trimmed.length === 0 && images.length === 0) {
      textParts.push("Please analyze the attached file(s).");
    }
    textParts.push("Attachment extracts:");
    textParts.push(attachmentTextBlocks.join("\n\n---\n\n"));
  }

  if (skipped.length > 0) {
    textParts.push(`Unavailable attachments: ${skipped.join("; ")}`);
  }

  if (textParts.length > 0) {
    blocks.push({ type: "text", text: textParts.join("\n") } as Anthropic.TextBlockParam);
  }

  for (const image of images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.base64Data,
      },
    } as unknown as Anthropic.ContentBlockParam);
  }

  return blocks;
}

const OPENAI_TOOL_MAX = Math.max(
  8,
  Number.parseInt(process.env.JOI_OPENAI_TOOL_MAX || "120", 10) || 120,
);

function extractIntentTokens(message: string): string[] {
  const matches = message.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  return [...new Set(matches)];
}

function relevanceScoreForTool(tool: Anthropic.Tool, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = tool.name.toLowerCase();
  const description = (tool.description || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 100;
    else if (name.includes(token)) score += 30;
    if (description.includes(token)) score += 6;
  }
  return score;
}

function trimToolsForOpenAI(tools: Anthropic.Tool[], message: string, maxTools: number): Anthropic.Tool[] {
  if (tools.length <= maxTools) return tools;
  const tokens = extractIntentTokens(message);
  const ranked = tools
    .map((tool, index) => ({
      tool,
      index,
      score: relevanceScoreForTool(tool, tokens),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return ranked
    .slice(0, maxTools)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.tool);
}

// ── Tool result minimization (Phase 3) ──
// Reduces tool result context sent to LLM while preserving full results for storage.

const TOOL_RESULT_SUMMARY_MAX_CHARS = 4000;
const EMBY_SUMMARY_TOOLS = new Set(["emby_search", "emby_library", "emby_recently_watched", "emby_continue_watching", "emby_next_up", "emby_now_playing"]);

/** Essential fields to keep per item in Emby envelope results */
const EMBY_ITEM_ESSENTIAL_KEYS = ["id", "name", "type", "year", "communityRating"];

function summarizeEmbyEnvelope(parsed: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(parsed.items) ? parsed.items as Record<string, unknown>[] : [];
  const summarizedItems = items.map((item) => {
    const slim: Record<string, unknown> = {};
    for (const key of EMBY_ITEM_ESSENTIAL_KEYS) {
      if (item[key] !== undefined) slim[key] = item[key];
    }
    return slim;
  });
  // Emby envelopes nest pagination under `page: { returned, hasMore, startIndex, limit }`
  const page = (parsed.page && typeof parsed.page === "object") ? parsed.page as Record<string, unknown> : null;
  return {
    count: parsed.count,
    page: page ? { returned: page.returned, hasMore: page.hasMore } : undefined,
    items: summarizedItems,
  };
}

/**
 * Summarize a tool result for LLM context. Returns the original if no summarization applies.
 * Feature-gated by JOI_TOOL_RESULT_SUMMARY=1.
 */
export function summarizeToolResult(toolName: string, resultStr: string): string {
  if (process.env.JOI_TOOL_RESULT_SUMMARY !== "1") return resultStr;

  // Only summarize specific tools
  if (!EMBY_SUMMARY_TOOLS.has(toolName)) {
    // Hard cap fallback for any tool
    if (resultStr.length > TOOL_RESULT_SUMMARY_MAX_CHARS) {
      return resultStr.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) + `\n[truncated ${resultStr.length - TOOL_RESULT_SUMMARY_MAX_CHARS} chars]`;
    }
    return resultStr;
  }

  try {
    const parsed = JSON.parse(resultStr);
    // Envelope shape: { count, items, ... }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      const summarized = summarizeEmbyEnvelope(parsed);
      return JSON.stringify(summarized);
    }
  } catch {
    // Not JSON or parse error — return as-is with hard cap
  }

  if (resultStr.length > TOOL_RESULT_SUMMARY_MAX_CHARS) {
    return resultStr.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) + `\n[truncated ${resultStr.length - TOOL_RESULT_SUMMARY_MAX_CHARS} chars]`;
  }
  return resultStr;
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

/** Convert Anthropic message history to OpenAI chat messages.
 *  Uses proper OpenAI tool_calls / tool role messages so the model
 *  understands tool interactions as structured data (not text to reproduce). */
function messagesToOpenAI(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];
  const toolResultToText = (content: unknown): string => {
    if (typeof content === "string") return content || "{}";
    return JSON.stringify(content) ?? "{}";
  };

  // Track valid tool_call_ids from assistant messages so we can skip orphaned tool_results
  // (happens when conversation history is truncated at message boundaries)
  const knownToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const userContentParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
        const toolResults: Array<{ tool_use_id: string; content: string }> = [];
        for (const block of msg.content) {
          if (block.type === "tool_result") {
            const id = (block as { tool_use_id: string }).tool_use_id;
            if (knownToolCallIds.has(id)) {
              toolResults.push({
                tool_use_id: id,
                content: toolResultToText((block as { content: unknown }).content),
              });
            }
            // Skip orphaned tool_results — no matching tool_call in preceding assistant message
          } else if (block.type === "text") {
            userContentParts.push({ type: "text", text: (block as { text: string }).text });
          } else if (block.type === "image") {
            const imageBlock = block as {
              source?: {
                type?: string;
                media_type?: string;
                data?: string;
              };
            };
            const src = imageBlock.source;
            if (src?.type === "base64" && typeof src.media_type === "string" && typeof src.data === "string") {
              userContentParts.push({
                type: "image_url",
                image_url: {
                  url: `data:${src.media_type};base64,${src.data}`,
                },
              });
            }
          }
        }
        // Emit tool results as proper OpenAI "tool" role messages
        for (const tr of toolResults) {
          result.push({
            role: "tool" as const,
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          } as OpenAI.ChatCompletionToolMessageParam);
        }
        // Emit user multimodal message (text + optional images)
        if (userContentParts.length === 1 && userContentParts[0].type === "text") {
          result.push({ role: "user", content: userContentParts[0].text });
        } else if (userContentParts.length > 0) {
          result.push({
            role: "user",
            content: userContentParts as unknown as OpenAI.ChatCompletionUserMessageParam["content"],
          } as OpenAI.ChatCompletionUserMessageParam);
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
            textParts.push((block as Anthropic.TextBlock).text);
          } else if (block.type === "tool_use") {
            const tu = block as Anthropic.ToolUseBlock;
            knownToolCallIds.add(tu.id);
            toolCalls.push({
              id: tu.id,
              type: "function",
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input),
              },
            });
          }
        }
        // Skip empty assistant messages (no text, no tool_calls)
        if (textParts.length === 0 && toolCalls.length === 0) continue;
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: textParts.join("") || null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
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
  cacheReadTokens: number;
  stopReason: string;
}> {
  const openaiMessages = messagesToOpenAI(systemPrompt, messages);
  const openaiTools = tools.length > 0 ? toolsToOpenAI(tools) : undefined;

  let stream: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>;
  try {
    stream = await client.chat.completions.create({
      model,
      max_tokens: 8192,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: openaiTools && forceToolUse ? "required" : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });
  } catch (err) {
    const detail = summarizeProviderError(err);
    const message = `[openaiStream] Provider call failed model=${model}: ${detail}`;
    console.error(message);
    logError("agent", message, {
      model,
      forceToolUse,
      toolCount: tools.length,
    });
    throw new Error(`Provider call failed for ${model}: ${detail}`);
  }

  let text = "";
  // Accumulate tool call deltas by index
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
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
      // OpenAI/OpenRouter: capture cached tokens from prompt_tokens_details
      const details = (chunk.usage as unknown as Record<string, unknown>).prompt_tokens_details as Record<string, unknown> | undefined;
      if (details && typeof details.cached_tokens === "number") {
        cacheReadTokens = details.cached_tokens as number;
      }
    }
  }

  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  for (const [, entry] of toolCallMap) {
    let input: unknown = {};
    try { input = JSON.parse(entry.args); } catch { input = {}; }
    toolCalls.push({ id: entry.id, name: entry.name, input });
  }

  const stopReason = finishReason === "tool_calls" ? "tool_use" : "end_turn";

  // Detect models that output tool-call-like code instead of structured tool_calls
  if (toolCalls.length === 0 && text && /\bdefault_api\.\w+\(|print\(\s*\w+_api\./i.test(text)) {
    console.warn(`[openaiStream] Model ${model} produced code-block tool calls instead of structured tool_calls. Text contains API call patterns. Consider using a model with reliable function calling.`);
  }

  return { text, toolCalls, inputTokens, outputTokens, cacheReadTokens, stopReason };
}

export interface AgentRunOptions {
  conversationId: string;
  agentId: string;
  userMessage: string;
  replyToMessageId?: string | null;
  forwardOfMessageId?: string | null;
  mentions?: unknown[] | null;
  forwardingMetadata?: Record<string, unknown> | null;
  attachments?: UserAttachmentInput[];
  transcriberModel?: string;
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
  executionMode?: AgentExecutionMode; // live = full side effects, shadow = read-mostly, dry_run = simulated tools
  persistMessages?: boolean; // Default true in live/shadow, false in dry_run
  latencyProfile?: AgentLatencyProfile; // Optional latency simulation profile for test runs
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
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  assistantUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  toolUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  assistantCostUsd: number;
  toolCostUsd: number;
  costUsd: number;
  timings: AgentTimings;
  agentId?: string;
  agentName?: string;
  routeReason?: string;
  routeConfidence?: number;
  delegations?: Array<{
    delegationId?: string;
    agentId: string;
    task: string;
    durationMs: number;
    status: "success" | "error";
  }>;
}

export interface MessageRelationsInput {
  replyToMessageId?: string | null;
  forwardOfMessageId?: string | null;
  mentions?: unknown[] | null;
  forwardingMetadata?: Record<string, unknown> | null;
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
  attachments?: UserAttachmentInput[] | null,
  relations?: MessageRelationsInput | null,
): Promise<string> {
  const relationPayload = relations || null;
  const mentions = Array.isArray(relationPayload?.mentions) && relationPayload.mentions.length > 0
    ? relationPayload.mentions
    : null;
  const forwardingMetadata = relationPayload?.forwardingMetadata
    && typeof relationPayload.forwardingMetadata === "object"
    ? relationPayload.forwardingMetadata
    : null;
  const result = await query<{ id: string }>(
    `INSERT INTO messages (
       conversation_id,
       role,
       content,
       model,
       tool_calls,
       tool_results,
       token_usage,
       attachments,
       reply_to_message_id,
       forward_of_message_id,
       mentions,
       forwarding_metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      conversationId,
      role,
      content,
      model,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      attachments ? JSON.stringify(attachments) : null,
      relationPayload?.replyToMessageId || null,
      relationPayload?.forwardOfMessageId || null,
      mentions ? JSON.stringify(mentions) : null,
      forwardingMetadata ? JSON.stringify(forwardingMetadata) : null,
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
    replyToMessageId = null,
    forwardOfMessageId = null,
    mentions = null,
    forwardingMetadata = null,
    attachments,
    transcriberModel,
    config,
    model: clientModel,
    toolTask = "tool",
    chatTask = "chat",
    enableTools = true,
    historyLimit = 20,
    includeMemoryContext = true,
    includeSkillsPrompt = true,
    forceToolUse = false,
    executionMode: rawExecutionMode = "live",
    persistMessages: rawPersistMessages,
    latencyProfile,
    depth = 0,
    systemPromptSuffix,
    broadcast,
    onStream,
    onToolPlan,
    onToolUse,
    onToolResult,
  } = options;
  const executionMode = normalizeExecutionMode(rawExecutionMode, "live");
  const persistMessages = rawPersistMessages ?? executionMode !== "dry_run";
  const shouldPersistMessages = persistMessages && executionMode !== "dry_run";
  const persistedAttachments = trimAttachmentsForStorage(attachments);
  const runStartedAt = Date.now();
  const timings = { setupMs: 0, memoryMs: 0, promptMs: 0, historyMs: 0, llmMs: 0, totalMs: 0 };
  let tMark = runStartedAt;

  console.log(`[runAgent] START agentId=${agentId}, hasOnStream=${!!onStream}, userMessage=${JSON.stringify(userMessage.slice(0, 100))}`);

  const conversationId = shouldPersistMessages
    ? await ensureConversation(inputConvId, agentId)
    : (inputConvId && inputConvId.trim() ? inputConvId : crypto.randomUUID());
  console.log(`[runAgent] conversationId=${conversationId}`);

  // Load channel language (conversation → channel_id → language)
  let channelLanguage = config.livekit?.language || "en";
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
      channelLanguage = chRow.rows[0]?.language || config.livekit?.language || "en";
    }
  } catch { /* non-critical */ }

  // Save user message
  if (shouldPersistMessages) {
    await saveMessage(
      conversationId,
      "user",
      userMessage,
      null,
      null,
      null,
      null,
      persistedAttachments,
      {
        replyToMessageId,
        forwardOfMessageId,
        mentions,
        forwardingMetadata,
      },
    );
  }

  // Load agent config from DB
  const agentResult = await query<{
    id: string;
    name: string | null;
    system_prompt: string | null;
    model: string;
    skills: string[] | null;
    config: Record<string, unknown> | null;
  }>(
    "SELECT id, name, system_prompt, model, skills, config FROM agents WHERE id = $1",
    [agentId],
  );

  let agentRow = agentResult.rows[0];
  if (!agentRow) {
    console.error(`[runAgent] Agent "${agentId}" not found in database, falling back to "personal"`);
    const fallback = await query<{ id: string; name: string | null; system_prompt: string | null; model: string; skills: string[] | null; config: Record<string, unknown> | null }>(
      "SELECT id, name, system_prompt, model, skills, config FROM agents WHERE id = $1", ["personal"]);
    agentRow = fallback.rows[0];
  }
  const agentName = agentRow?.name || null;
  const promptAgentId = agentRow?.id || agentId;
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

  // Get tool definitions (strict policy: null skills are normalized to explicit lists).
  // Tool gating is now handled by the LLM intent classifier (caller passes enableTools).
  const rawAgentSkills = agentRow?.skills;
  const agentSkills = normalizeAgentSkills(promptAgentId, rawAgentSkills);
  if (isLegacyUnrestrictedSkills(rawAgentSkills)) {
    logWarn(
      "agent",
      `[runAgent] Agent "${promptAgentId}" had legacy NULL skills; normalized to explicit list (${agentSkills.length} tools).`,
      { agentId: promptAgentId, normalizedToolCount: agentSkills.length },
    );
  }
  let tools = enableTools ? getToolDefinitions(agentSkills) : [];
  if (!enableTools) {
    console.log("[runAgent] Tools disabled by intent classifier for this turn");
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
  if (openaiClient && tools.length > OPENAI_TOOL_MAX) {
    const originalCount = tools.length;
    tools = trimToolsForOpenAI(tools, userMessage, OPENAI_TOOL_MAX);
    logWarn(
      "agent",
      `[runAgent] Trimmed tools for OpenAI-compatible model ${model}: ${originalCount} -> ${tools.length}`,
      {
        model,
        provider,
        originalCount,
        trimmedCount: tools.length,
        forceToolUse,
      },
    );
  }
  console.log(`[runAgent] Using provider=${provider}, model=${model}, isTwoPhase=${isTwoPhase}, hasAnthropicClient=${!!client}, hasOpenAIClient=${!!openaiClient}`);

  timings.setupMs = Date.now() - tMark;
  tMark = Date.now();

  // Load memory context for system prompt
  // Skip memory for lightweight turns (tools already disabled, memory won't help)
  let memoryContext = "";
  if (includeMemoryContext && enableTools) {
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
  const effectiveIncludeSkills = !enableTools ? false : includeSkillsPrompt;
  const fallbackSoulContent = readSoulDocumentForAgent(promptAgentId).content;
  let selectedSoulContent = fallbackSoulContent;
  try {
    const soulSelection = await chooseSoulForConversation({
      agentId: promptAgentId,
      conversationId,
      fallbackContent: fallbackSoulContent,
    });
    selectedSoulContent = soulSelection.selectedContent || fallbackSoulContent;
    if (shouldPersistMessages) {
      await persistConversationSoulSelection(conversationId, soulSelection);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[runAgent] Failed to resolve soul rollout for ${promptAgentId}: ${message}`);
  }

  const promptOptions = {
    includeSkillsPrompt: effectiveIncludeSkills,
    language: channelLanguage,
    agentId: promptAgentId,
    soulDocument: selectedSoulContent,
  };
  const systemPrompt = buildSystemPrompt(agentRow?.system_prompt || undefined, promptOptions)
    + memoryContext
    + (systemPromptSuffix ? "\n\n" + systemPromptSuffix : "");

  // Build cached system blocks for Anthropic prompt caching (Phase 2)
  const usePromptCache = process.env.JOI_PROMPT_CACHE === "1";
  let cachedSystemBlocks: Anthropic.TextBlockParam[] | null = null;
  if (usePromptCache && enableTools) {
    const blocks = buildCachedSystemBlocks(agentRow?.system_prompt || undefined, promptOptions);
    // Append memory + suffix to dynamic block
    const dynamicSuffix = memoryContext + (systemPromptSuffix ? "\n\n" + systemPromptSuffix : "");
    if (dynamicSuffix) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        text: blocks[blocks.length - 1].text + dynamicSuffix,
      };
    }
    cachedSystemBlocks = blocks;
  }

  // Structured prompt size logging
  const promptStaticChars = cachedSystemBlocks
    ? cachedSystemBlocks[0].text.length
    : systemPrompt.length;
  const promptDynamicChars = cachedSystemBlocks
    ? cachedSystemBlocks.slice(1).reduce((sum, b) => sum + b.text.length, 0)
    : 0;
  console.log(`[runAgent] PROMPT agent=${agentId} totalChars=${systemPrompt.length} staticChars=${promptStaticChars} dynamicChars=${promptDynamicChars} memoryChars=${memoryContext.length} suffixChars=${(systemPromptSuffix || "").length} cache=${usePromptCache}`);

  timings.promptMs = Date.now() - tMark;
  tMark = Date.now();

  // Load history (reduce for lightweight turns — full history is unnecessary)
  const effectiveHistoryLimit = !enableTools ? 10 : historyLimit;
  const history = await loadConversationHistory(conversationId, effectiveHistoryLimit);
  const visionCapableProvider = provider !== "ollama";
  const { images: resolvedImages, skipped: skippedAttachments } = await resolveImageAttachments(
    visionCapableProvider ? attachments : undefined,
    config,
  );
  const { blocks: attachmentTextBlocks, skipped: skippedTextAttachments } = await resolveAttachmentTextBlocks(
    attachments,
    config,
    transcriberModel,
  );
  skippedAttachments.push(...skippedTextAttachments);
  if (!visionCapableProvider && attachments?.some((att) => isImageAttachment(att))) {
    skippedAttachments.push("image analysis is not supported for Ollama models in JOI yet");
  }

  // Pre-compaction memory flush (fire-and-forget)
  if (config.memory.autoLearn && shouldPersistMessages && executionMode === "live") {
    maybeFlushContext(conversationId, config)
      .catch((err) => console.warn("[Flush] Pre-compaction flush failed:", err));
  }

  timings.historyMs = Date.now() - tMark;
  tMark = Date.now();

  // Tool use loop (max 10 iterations)
  let messages = [...history];
  const compactCurrentUser = compactHistoryText(userMessage, HISTORY_CONTENT_MAX_CHARS);
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user" && typeof lastMsg.content === "string" && lastMsg.content === compactCurrentUser) {
      messages = messages.slice(0, -1);
    }
  }
  messages.push({
    role: "user",
    content: buildUserTurnContent(userMessage, resolvedImages, attachmentTextBlocks, skippedAttachments),
  });
  let fullContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let assistantInputTokens = 0;
  let assistantOutputTokens = 0;
  let assistantCacheReadTokens = 0;
  let assistantCacheWriteTokens = 0;
  let toolInputTokens = 0;
  let toolOutputTokens = 0;
  let toolCacheReadTokens = 0;
  let toolCacheWriteTokens = 0;
  let totalCostUsd = 0;
  let assistantCostUsd = 0;
  let toolCostUsd = 0;
  const toolInteractions: ToolInteraction[] = [];
  const delegations: Array<{ delegationId: string; agentId: string; task: string; durationMs: number; status: "success" | "error" }> = [];
  let toolsWereCalled = false;
  let assistantMessageId: string | null = null;

  for (let i = 0; i < 10; i++) {
    console.log(`[runAgent] Loop iteration ${i}, provider=${provider}, model=${model}`);
    let assistantText = "";
    let toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let iterInputTokens = 0;
    let iterOutputTokens = 0;
    let iterCacheReadTokens = 0;
    let iterCacheWriteTokens = 0;
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
      if (result.cacheReadTokens) iterCacheReadTokens += result.cacheReadTokens;
      stopReason = result.stopReason;
    } else {
      // Use Anthropic SDK (direct or OpenRouter with anthropic/* models)
      const useBlocks = cachedSystemBlocks && isAnthropicModel(model);
      const stream = client!.messages.stream({
        model,
        max_tokens: 8192,
        system: useBlocks ? cachedSystemBlocks! : systemPrompt,
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
      // Capture cache tokens from Anthropic response
      const usage = response.usage as unknown as Record<string, unknown>;
      if (typeof usage.cache_read_input_tokens === "number") {
        iterCacheReadTokens += usage.cache_read_input_tokens as number;
      }
      if (typeof usage.cache_creation_input_tokens === "number") {
        iterCacheWriteTokens += usage.cache_creation_input_tokens as number;
      }
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
    totalCacheReadTokens += iterCacheReadTokens;
    totalCacheWriteTokens += iterCacheWriteTokens;

    // Record usage and accumulate cost
    const iterCostUsd = estimateCost(provider as ModelProvider, model, iterInputTokens, iterOutputTokens);
    totalCostUsd += iterCostUsd;
    if (isTwoPhase) {
      toolInputTokens += iterInputTokens;
      toolOutputTokens += iterOutputTokens;
      toolCacheReadTokens += iterCacheReadTokens;
      toolCacheWriteTokens += iterCacheWriteTokens;
      toolCostUsd += iterCostUsd;
    } else {
      assistantInputTokens += iterInputTokens;
      assistantOutputTokens += iterOutputTokens;
      assistantCacheReadTokens += iterCacheReadTokens;
      assistantCacheWriteTokens += iterCacheWriteTokens;
      assistantCostUsd += iterCostUsd;
    }
    if (executionMode === "live") {
      recordUsage({
        provider,
        model,
        task: isTwoPhase ? (toolTask === "voice" ? "voice" : "tool") : chatTask,
        inputTokens: iterInputTokens,
        outputTokens: iterOutputTokens,
        conversationId,
        agentId,
      }).catch(() => {});
    }

    if (stopReason !== "tool_use" || toolCalls.length === 0) {
      // No more tool calls
      if (isTwoPhase) {
        // Two-phase: don't save the tool model's final text to DB.
        // The chat model will generate the actual response below.
        // (Avoids consecutive assistant messages in history.)
      } else {
        // Single-phase: save the response normally
        const cleanedText = stripThinkTags(assistantText);
        await maybeSimulateLatency(latencyProfile, "response");
        if (shouldPersistMessages) {
          assistantMessageId = await saveMessage(
            conversationId, "assistant", cleanedText || null, model,
            null, null,
            {
              inputTokens: iterInputTokens,
              outputTokens: iterOutputTokens,
              cacheReadTokens: iterCacheReadTokens || undefined,
              cacheWriteTokens: iterCacheWriteTokens || undefined,
              assistantUsage: {
                inputTokens: iterInputTokens,
                outputTokens: iterOutputTokens,
                cacheReadTokens: iterCacheReadTokens || undefined,
                cacheWriteTokens: iterCacheWriteTokens || undefined,
              },
              assistantCostUsd: iterCostUsd,
              costUsd: iterCostUsd,
              latencyMs: Date.now() - runStartedAt,
            },
          );
        } else if (!assistantMessageId) {
          assistantMessageId = crypto.randomUUID();
        }
        fullContent += cleanedText;
      }
      break;
    }

    // Tools were called — save assistant message (includes tool_use blocks)
    onToolPlan?.(toolCalls);
    toolsWereCalled = true;
    if (shouldPersistMessages) {
      assistantMessageId = await saveMessage(
        conversationId, "assistant", assistantText || null, model,
        toolCalls, null,
        { inputTokens: iterInputTokens, outputTokens: iterOutputTokens },
      );
    } else if (!assistantMessageId) {
      assistantMessageId = crypto.randomUUID();
    }
    fullContent += assistantText;

    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    const toolContext: ToolContext = {
      config,
      conversationId,
      agentId,
      agentConfig,
      executionMode,
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
        const spawnStartMs = Date.now();
        const delegationId = crypto.randomUUID();
        const delegationVisible = process.env.JOI_AGENT_VISIBILITY === "1";
        if (delegationVisible) {
          broadcast?.("chat.agent_spawn", {
            conversationId,
            delegationId,
            parentAgentId: agentId,
            childAgentId: opts.agentId,
            task: opts.message.slice(0, 200),
          });
        }
        try {
          const childResult = await runAgent({
            conversationId: opts.parentConversationId || "",
            agentId: opts.agentId,
            userMessage: opts.message,
            config,
            depth: depth + 1,
            executionMode,
            persistMessages: shouldPersistMessages,
            latencyProfile,
            broadcast,
          });
          const spawnDurationMs = Date.now() - spawnStartMs;
          delegations.push({
            delegationId,
            agentId: opts.agentId,
            task: opts.message.slice(0, 200),
            durationMs: spawnDurationMs,
            status: "success",
          });
          if (delegationVisible) {
            broadcast?.("chat.agent_result", {
              conversationId,
              delegationId,
              childAgentId: opts.agentId,
              status: "success",
              durationMs: spawnDurationMs,
            });
          }
          return {
            content: childResult.content,
            model: childResult.model,
            usage: childResult.usage,
          };
        } catch (err) {
          const spawnDurationMs = Date.now() - spawnStartMs;
          delegations.push({
            delegationId,
            agentId: opts.agentId,
            task: opts.message.slice(0, 200),
            durationMs: spawnDurationMs,
            status: "error",
          });
          if (delegationVisible) {
            broadcast?.("chat.agent_result", {
              conversationId,
              delegationId,
              childAgentId: opts.agentId,
              status: "error",
              durationMs: spawnDurationMs,
            });
          }
          throw err;
        }
      },
    };

    // Collect full results (for DB) and summarized results (for LLM context)
    const llmToolResults: Array<{ tool_use_id: string; content: string }> = [];
    for (const tc of toolCalls) {
      onToolUse?.(tc.name, tc.input, tc.id);
      await maybeSimulateLatency(latencyProfile, "tool");
      const result = await executeTool(tc.name, tc.input, toolContext);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      toolResults.push({ tool_use_id: tc.id, content: resultStr });
      toolInteractions.push({ name: tc.name, input: tc.input, result: resultStr });
      // Summarize for LLM context (feature-gated)
      const llmResultStr = summarizeToolResult(tc.name, resultStr);
      llmToolResults.push({ tool_use_id: tc.id, content: llmResultStr });
      onToolResult?.(tc.id, result);
    }

    // Log tool result sizes for telemetry
    for (let ti = 0; ti < toolResults.length; ti++) {
      const fullChars = toolResults[ti].content.length;
      const llmChars = llmToolResults[ti].content.length;
      const reduction = fullChars > 0 ? Math.round((1 - llmChars / fullChars) * 100) : 0;
      console.log(`[runAgent] TOOL_RESULT tool=${toolCalls[ti].name} fullChars=${fullChars} llmChars=${llmChars} reduction=${reduction}%`);
    }

    // Save full results to DB
    if (shouldPersistMessages) {
      await saveMessage(conversationId, "tool", null, null, null, toolResults, null);
    }

    // Feed summarized results to LLM context
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
      content: llmToolResults.map((tr) => ({
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
    let finalCacheReadTokens = 0;
    let finalCacheWriteTokens = 0;

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
      if (result.cacheReadTokens) finalCacheReadTokens += result.cacheReadTokens;
    } else {
      const useFinalBlocks = cachedSystemBlocks && isAnthropicModel(chatModel);
      const stream = chatClient!.messages.stream({
        model: chatModel,
        max_tokens: 8192,
        system: useFinalBlocks ? cachedSystemBlocks! : systemPrompt,
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
      // Capture cache tokens from two-phase final response
      const finalUsage = response.usage as unknown as Record<string, unknown>;
      if (typeof finalUsage.cache_read_input_tokens === "number") {
        finalCacheReadTokens += finalUsage.cache_read_input_tokens as number;
      }
      if (typeof finalUsage.cache_creation_input_tokens === "number") {
        finalCacheWriteTokens += finalUsage.cache_creation_input_tokens as number;
      }
    }

    totalInputTokens += finalInputTokens;
    totalOutputTokens += finalOutputTokens;
    totalCacheReadTokens += finalCacheReadTokens;
    totalCacheWriteTokens += finalCacheWriteTokens;
    const finalCostUsd = estimateCost(chatProvider as ModelProvider, chatModel, finalInputTokens, finalOutputTokens);
    totalCostUsd += finalCostUsd;
    assistantInputTokens += finalInputTokens;
    assistantOutputTokens += finalOutputTokens;
    assistantCacheReadTokens += finalCacheReadTokens;
    assistantCacheWriteTokens += finalCacheWriteTokens;
    assistantCostUsd += finalCostUsd;
    finalText = stripThinkTags(finalText);
    fullContent = finalText; // Replace with chat model's response

    if (executionMode === "live") {
      recordUsage({
        provider: chatProvider,
        model: chatModel,
        task: chatTask,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        conversationId,
        agentId,
      }).catch(() => {});
    }

    await maybeSimulateLatency(latencyProfile, "response");
    if (shouldPersistMessages) {
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
          cacheReadTokens: finalCacheReadTokens || undefined,
          cacheWriteTokens: finalCacheWriteTokens || undefined,
          assistantUsage: {
            inputTokens: finalInputTokens,
            outputTokens: finalOutputTokens,
            cacheReadTokens: finalCacheReadTokens || undefined,
            cacheWriteTokens: finalCacheWriteTokens || undefined,
          },
          toolUsage: toolInputTokens > 0 || toolOutputTokens > 0 || toolCacheReadTokens > 0 || toolCacheWriteTokens > 0
            ? {
                inputTokens: toolInputTokens,
                outputTokens: toolOutputTokens,
                cacheReadTokens: toolCacheReadTokens || undefined,
                cacheWriteTokens: toolCacheWriteTokens || undefined,
              }
            : undefined,
          assistantCostUsd: finalCostUsd,
          toolCostUsd,
          costUsd: finalCostUsd + toolCostUsd,
          latencyMs: Date.now() - runStartedAt,
        },
      );
    } else if (!assistantMessageId) {
      assistantMessageId = crypto.randomUUID();
    }

    // Return the chat model info (the one that generated the final response)
    model = chatModel;
    provider = chatProvider;
  }

  // Update conversation title
  if (shouldPersistMessages) {
    const msgCount = await query<{ count: string }>(
      "SELECT count(*) FROM messages WHERE conversation_id = $1",
      [conversationId],
    );
    if (Number(msgCount.rows[0].count) <= 3) {
      const titleSeed = userMessage.trim().length > 0
        ? userMessage
        : (persistedAttachments && persistedAttachments.length > 0 ? "Image analysis" : "New conversation");
      const title = titleSeed.length > 50
        ? titleSeed.substring(0, 50) + "..."
        : titleSeed;
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
  }

  // Auto-learn from this conversation (fire-and-forget)
  if (config.memory.autoLearn && shouldPersistMessages && executionMode === "live") {
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
  console.log(`[runAgent] TOKENS agent=${agentId} input=${totalInputTokens} output=${totalOutputTokens} cacheRead=${totalCacheReadTokens} cacheWrite=${totalCacheWriteTokens} cost=$${totalCostUsd.toFixed(4)}`);

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
      cacheReadTokens: totalCacheReadTokens || undefined,
      cacheWriteTokens: totalCacheWriteTokens || undefined,
    },
    assistantUsage: {
      inputTokens: assistantInputTokens,
      outputTokens: assistantOutputTokens,
      cacheReadTokens: assistantCacheReadTokens || undefined,
      cacheWriteTokens: assistantCacheWriteTokens || undefined,
    },
    toolUsage: toolInputTokens > 0 || toolOutputTokens > 0 || toolCacheReadTokens > 0 || toolCacheWriteTokens > 0
      ? {
          inputTokens: toolInputTokens,
          outputTokens: toolOutputTokens,
          cacheReadTokens: toolCacheReadTokens || undefined,
          cacheWriteTokens: toolCacheWriteTokens || undefined,
        }
      : undefined,
    assistantCostUsd,
    toolCostUsd,
    costUsd: totalCostUsd,
    timings,
    agentId,
    agentName: agentName || undefined,
    delegations: delegations.length > 0 ? delegations : undefined,
  };
}
