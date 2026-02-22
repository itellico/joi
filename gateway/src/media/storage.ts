// Media storage: file I/O + thumbnail generation

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import type { MediaConfig } from "../config/schema.js";

// Lazy-loaded sharp
let sharpFn: ((input?: Buffer | string) => any) | null = null;
async function loadSharp() {
  if (!sharpFn) {
    const mod = await import("sharp");
    sharpFn = mod.default;
  }
  return sharpFn!;
}

/** MIME type → file extension mapping */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
};

/** Get file extension from MIME type or filename */
export function getExtension(mimeType?: string | null, filename?: string | null): string {
  if (filename) {
    const ext = extname(filename);
    if (ext) return ext;
  }
  if (mimeType && MIME_EXT[mimeType]) return MIME_EXT[mimeType];
  if (mimeType) {
    const sub = mimeType.split("/")[1];
    if (sub) return `.${sub.replace(/[^a-z0-9]/gi, "")}`;
  }
  return ".bin";
}

/** Build storage path: YYYY/MM/{uuid}.ext */
export function buildStoragePath(mediaId: string, mimeType?: string | null, filename?: string | null): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const ext = getExtension(mimeType, filename);
  return `${year}/${month}/${mediaId}${ext}`;
}

/** Ensure directory exists */
async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/** Write media file to disk and optionally generate thumbnail for images */
export async function storeMedia(opts: {
  mediaId: string;
  buffer: Buffer;
  rootPath: string;
  mimeType?: string | null;
  filename?: string | null;
  mediaConfig: MediaConfig;
}): Promise<{
  storagePath: string;
  thumbnailPath: string | null;
  width: number | null;
  height: number | null;
}> {
  const storagePath = buildStoragePath(opts.mediaId, opts.mimeType, opts.filename);
  const fullPath = join(opts.rootPath, storagePath);

  await ensureDir(dirname(fullPath));
  await writeFile(fullPath, opts.buffer);

  let thumbnailPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;

  // Generate thumbnail for images
  const isImage = opts.mimeType?.startsWith("image/") && !opts.mimeType.includes("svg");
  if (isImage) {
    try {
      const sharp = await loadSharp();
      const meta = await sharp(opts.buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;

      const thumbDir = join(opts.rootPath, "thumbs", dirname(storagePath));
      await ensureDir(thumbDir);
      const thumbName = `${opts.mediaId}_thumb.webp`;
      const thumbFullPath = join(thumbDir, thumbName);
      thumbnailPath = `thumbs/${dirname(storagePath)}/${thumbName}`;

      await sharp(opts.buffer)
        .resize(opts.mediaConfig.thumbnailMaxWidth, undefined, { withoutEnlargement: true })
        .webp({ quality: opts.mediaConfig.thumbnailQuality })
        .toFile(thumbFullPath);
    } catch (err) {
      // Thumbnail generation is non-critical
      console.warn("[Media] Thumbnail generation failed:", err instanceof Error ? err.message : err);
    }
  }

  return { storagePath, thumbnailPath, width, height };
}

/** Resolve relative storage path to absolute */
export function resolveMediaPath(rootPath: string, storagePath: string): string {
  return join(rootPath, storagePath);
}
