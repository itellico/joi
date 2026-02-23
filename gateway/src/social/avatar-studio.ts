import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GoogleGenAI, Modality } from "@google/genai";
import type { JoiConfig } from "../config/schema.js";
import { query } from "../db/client.js";
import { storeMedia } from "../media/storage.js";

export type AvatarRenderMode = "nano" | "pro";

export const AVATAR_STYLE_NOTE_PATH = "🏆 Projects/joi/Agent Social/Avatar Style Guide.md";

const MODEL_BY_MODE: Record<AvatarRenderMode, string> = {
  nano: "gemini-2.5-flash-image",
  pro: "gemini-3-pro-image-preview",
};

const DEFAULT_AVATAR_STYLE_GUIDE = `# JOI Agent Avatar Style Guide

## Goal
Create coherent profile avatars for the JOI agent social network.

## Visual Identity
- Format: square avatar, optimized for circular crop.
- Mood: confident, curious, calm.
- Style: clean digital illustration, high detail, soft gradients, no photoreal skin textures.
- Composition: one clear subject, centered, chest-up framing.
- Background: subtle abstract tech backdrop, never busy.
- Palette: warm amber highlights + deep slate shadows + one accent color.
- Lighting: rim light + soft front fill, readable at small size.

## Hard Constraints
- No text overlays, no logos, no watermarks.
- No copyrighted characters or brands.
- Keep face and silhouette clean at 36px.
- Keep style consistent across all agents.
`;

function normalizeVaultPath(config: JoiConfig): string | null {
  const vault = config.obsidian.vaultPath;
  if (!vault) return null;
  return vault.replace(/^~/, process.env.HOME || "/Users/mm2");
}

function resolveStyleFile(vaultPath: string): string {
  const root = path.resolve(vaultPath);
  const full = path.resolve(root, AVATAR_STYLE_NOTE_PATH);
  if (!(full === root || full.startsWith(`${root}${path.sep}`))) {
    throw new Error("Invalid avatar style path.");
  }
  return full;
}

function compactLine(input: string, maxChars: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function sanitizeName(input: string): string {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "agent";
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

function extractTextFromResponse(response: any): string {
  const parts = Array.isArray(response?.candidates)
    ? response.candidates.flatMap((candidate: any) => candidate?.content?.parts || [])
    : [];
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter((text: string) => text.trim().length > 0)
    .join("\n")
    .trim();
}

function extractInlineImage(response: any): { data: string; mimeType: string } | null {
  const parts = Array.isArray(response?.candidates)
    ? response.candidates.flatMap((candidate: any) => candidate?.content?.parts || [])
    : [];

  for (const part of parts) {
    const inline = part?.inlineData;
    const data = typeof inline?.data === "string" ? inline.data : "";
    if (!data) continue;
    const mimeType = typeof inline?.mimeType === "string" && inline.mimeType.trim()
      ? inline.mimeType
      : "image/png";
    return { data, mimeType };
  }
  return null;
}

function resolveGoogleApiKey(config: JoiConfig): string | null {
  const key = config.auth.googleApiKey || process.env.GOOGLE_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

function buildAvatarPrompt(opts: {
  agentId: string;
  agentName: string;
  prompt: string;
  soulDocument?: string;
  styleGuide: string;
}): string {
  return [
    "Create one profile avatar image for an autonomous software agent.",
    "Return image output only.",
    "",
    `Agent id: ${opts.agentId}`,
    `Agent name: ${opts.agentName}`,
    `Persona hint: ${opts.soulDocument ? compactLine(opts.soulDocument, 260) : "n/a"}`,
    `User direction: ${compactLine(opts.prompt, 300)}`,
    "",
    "Follow this style guide exactly:",
    opts.styleGuide,
  ].join("\n");
}

export interface AvatarStyleGuide {
  source: "obsidian" | "builtin";
  notePath: string;
  absolutePath: string | null;
  content: string;
  created: boolean;
}

export async function ensureAvatarStyleGuide(config: JoiConfig): Promise<AvatarStyleGuide> {
  const vaultPath = normalizeVaultPath(config);
  if (!vaultPath) {
    return {
      source: "builtin",
      notePath: AVATAR_STYLE_NOTE_PATH,
      absolutePath: null,
      content: DEFAULT_AVATAR_STYLE_GUIDE,
      created: false,
    };
  }

  const absolutePath = resolveStyleFile(vaultPath);
  const dir = path.dirname(absolutePath);
  await fs.promises.mkdir(dir, { recursive: true });

  if (fs.existsSync(absolutePath)) {
    const existing = await fs.promises.readFile(absolutePath, "utf-8");
    const content = existing.trim().length > 0 ? existing : DEFAULT_AVATAR_STYLE_GUIDE;
    if (existing.trim().length === 0) {
      await fs.promises.writeFile(absolutePath, DEFAULT_AVATAR_STYLE_GUIDE, "utf-8");
    }
    return {
      source: "obsidian",
      notePath: AVATAR_STYLE_NOTE_PATH,
      absolutePath,
      content,
      created: false,
    };
  }

  await fs.promises.writeFile(absolutePath, DEFAULT_AVATAR_STYLE_GUIDE, "utf-8");
  return {
    source: "obsidian",
    notePath: AVATAR_STYLE_NOTE_PATH,
    absolutePath,
    content: DEFAULT_AVATAR_STYLE_GUIDE,
    created: true,
  };
}

export async function saveAvatarStyleGuide(config: JoiConfig, content: string): Promise<AvatarStyleGuide> {
  const vaultPath = normalizeVaultPath(config);
  if (!vaultPath) {
    throw new Error("Obsidian vault path is not configured.");
  }
  const absolutePath = resolveStyleFile(vaultPath);
  const dir = path.dirname(absolutePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const normalized = content.trim();
  if (!normalized) {
    throw new Error("Avatar style guide cannot be empty.");
  }

  await fs.promises.writeFile(absolutePath, `${normalized}\n`, "utf-8");
  return {
    source: "obsidian",
    notePath: AVATAR_STYLE_NOTE_PATH,
    absolutePath,
    content: normalized,
    created: false,
  };
}

export interface GenerateAvatarOptions {
  config: JoiConfig;
  agentId: string;
  agentName: string;
  prompt: string;
  soulDocument?: string;
  mode?: AvatarRenderMode;
  model?: string;
  conversationId?: string | null;
}

export interface GenerateAvatarResult {
  mediaId: string;
  model: string;
  mode: AvatarRenderMode;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  storagePath: string;
  styleSource: "obsidian" | "builtin";
  stylePath: string;
  promptUsed: string;
  modelText: string | null;
}

export async function generateAvatarAndStore(opts: GenerateAvatarOptions): Promise<GenerateAvatarResult> {
  const apiKey = resolveGoogleApiKey(opts.config);
  if (!apiKey) {
    throw new Error("Google API key is missing. Set GOOGLE_API_KEY or auth.googleApiKey in Settings.");
  }

  const styleGuide = await ensureAvatarStyleGuide(opts.config);
  const mode: AvatarRenderMode = opts.mode || "nano";
  const model = opts.model || MODEL_BY_MODE[mode];
  const promptUsed = buildAvatarPrompt({
    agentId: opts.agentId,
    agentName: opts.agentName,
    prompt: opts.prompt,
    soulDocument: opts.soulDocument,
    styleGuide: styleGuide.content,
  });

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model,
    contents: promptUsed,
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  });

  const image = extractInlineImage(response);
  const modelText = extractTextFromResponse(response) || null;
  if (!image) {
    const message = modelText ? `Gemini returned no image data: ${compactLine(modelText, 220)}` : "Gemini returned no image data.";
    throw new Error(message);
  }

  const buffer = Buffer.from(image.data, "base64");
  if (!buffer || buffer.length === 0) {
    throw new Error("Gemini returned empty image payload.");
  }

  const mediaId = randomUUID();
  const extension = extensionForMimeType(image.mimeType);
  const filename = `${sanitizeName(opts.agentName)}-avatar-${Date.now()}.${extension}`;
  const stored = await storeMedia({
    mediaId,
    buffer,
    rootPath: opts.config.media.storagePath,
    mimeType: image.mimeType,
    filename,
    mediaConfig: opts.config.media,
  });

  await query(
    `INSERT INTO media (
       id, message_id, conversation_id, channel_type, channel_id, sender_id,
       media_type, filename, mime_type, size_bytes, storage_path, thumbnail_path,
       width, height, duration_seconds, status, caption
     ) VALUES (
       $1, NULL, $2, $3, $4, $5,
       'photo', $6, $7, $8, $9, $10,
       $11, $12, NULL, 'ready', $13
     )`,
    [
      mediaId,
      opts.conversationId || null,
      "agent-social",
      "agent-social",
      opts.agentId,
      filename,
      image.mimeType,
      buffer.length,
      stored.storagePath,
      stored.thumbnailPath,
      stored.width,
      stored.height,
      `Agent avatar for ${opts.agentName} (${opts.agentId})`,
    ],
  );

  return {
    mediaId,
    model,
    mode,
    mimeType: image.mimeType,
    fileUrl: `/api/media/${mediaId}/file`,
    thumbnailUrl: stored.thumbnailPath ? `/api/media/${mediaId}/thumbnail` : null,
    storagePath: stored.storagePath,
    styleSource: styleGuide.source,
    stylePath: styleGuide.notePath,
    promptUsed,
    modelText,
  };
}
