// Core Outline <-> Obsidian sync orchestrator

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { query } from "../db/client.js";
import { log, logWarn, logError } from "../logging.js";
import * as api from "./outline-api.js";
import type { JoiConfig } from "../config/schema.js";
import type { OutlineDocument, SyncState } from "./outline-types.js";

// Paths currently being written by sync — Chokidar watcher should skip these
export const writingPaths = new Set<string>();

// Collection name cache to avoid repeated API calls
const collectionNameCache = new Map<string, string>();

// ── Helpers ──

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

function resolveVaultPath(config: JoiConfig): string {
  const vaultPath = config.obsidian.vaultPath;
  if (!vaultPath) throw new Error("No Obsidian vault path configured");
  return vaultPath.replace(/^~/, process.env.HOME || "/root");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
}

// ── Frontmatter ──

interface Frontmatter {
  outline_id?: string;
  collection?: string;
  outline_updated_at?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }
  const endIdx = content.indexOf("\n---\n", 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }
  const fmBlock = content.slice(4, endIdx);
  const frontmatter: Frontmatter = {};
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }
  const body = content.slice(endIdx + 5); // skip "\n---\n"
  return { frontmatter, body };
}

function buildFrontmatter(fm: Frontmatter): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function buildMarkdown(doc: OutlineDocument, collectionName: string): string {
  const fm: Frontmatter = {
    outline_id: doc.id,
    collection: collectionName,
    outline_updated_at: doc.updatedAt,
  };
  return buildFrontmatter(fm) + doc.text;
}

// ── Collection name resolution ──

async function getCollectionName(config: JoiConfig, collectionId: string): Promise<string> {
  const cached = collectionNameCache.get(collectionId);
  if (cached) return cached;

  try {
    const collections = await api.listCollections(config);
    for (const c of collections) {
      collectionNameCache.set(c.id, c.name);
    }
    return collectionNameCache.get(collectionId) || "Unknown";
  } catch {
    return "Unknown";
  }
}

// ── Parent path resolution ──

async function resolveParentPath(
  doc: OutlineDocument,
  config: JoiConfig,
  docMap?: Map<string, OutlineDocument>,
): Promise<string> {
  const parts: string[] = [];
  let parentId = doc.parentDocumentId;
  const visited = new Set<string>(); // guard against cycles
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = docMap?.get(parentId) ?? await api.getDocument(config, parentId);
    parts.unshift(sanitizeFilename(parent.title));
    parentId = parent.parentDocumentId;
  }
  return parts.join(path.sep);
}

// ── Outline -> Obsidian ──

export async function syncOutlineToObsidian(
  doc: OutlineDocument,
  config: JoiConfig,
  docMap?: Map<string, OutlineDocument>,
): Promise<void> {
  const vaultRoot = resolveVaultPath(config);
  const collectionName = await getCollectionName(config, doc.collectionId);
  const safeName = sanitizeFilename(doc.title);
  const parentPath = await resolveParentPath(doc, config, docMap);
  const relativePath = path.join("Outline", sanitizeFilename(collectionName), parentPath, `${safeName}.md`);
  const absolutePath = path.join(vaultRoot, relativePath);

  const outlineHash = contentHash(doc.text);

  // Check current sync state
  const existing = await query<SyncState>(
    "SELECT * FROM outline_sync_state WHERE outline_id = $1",
    [doc.id],
  );

  // If Obsidian file exists and was modified since last sync, detect conflict
  if (existing.rows.length > 0 && existing.rows[0].status !== "deleted") {
    const state = existing.rows[0];
    if (fs.existsSync(path.join(vaultRoot, state.obsidian_path))) {
      const obsidianContent = fs.readFileSync(path.join(vaultRoot, state.obsidian_path), "utf-8");
      const { body } = parseFrontmatter(obsidianContent);
      const currentObsidianHash = contentHash(body);

      // Both sides changed
      if (currentObsidianHash !== state.obsidian_content_hash && outlineHash !== state.outline_content_hash) {
        log("outline", `Conflict detected: ${doc.title}`, { outlineId: doc.id });

        // Write conflict file with Outline version
        const conflictPath = path.join(vaultRoot, state.obsidian_path.replace(/\.md$/, ".conflict.md"));
        const conflictContent = buildMarkdown(doc, collectionName);
        writingPaths.add(conflictPath);
        fs.mkdirSync(path.dirname(conflictPath), { recursive: true });
        fs.writeFileSync(conflictPath, conflictContent, "utf-8");
        setTimeout(() => writingPaths.delete(conflictPath), 3000);

        await query(
          `UPDATE outline_sync_state
           SET status = 'conflicted', conflict_detected_at = NOW(), outline_content_hash = $1,
               outline_updated_at = $2, updated_at = NOW()
           WHERE outline_id = $3`,
          [outlineHash, doc.updatedAt, doc.id],
        );
        return;
      }
    }
  }

  // Clean up old file if path changed (e.g. flat -> hierarchical)
  if (existing.rows.length > 0 && existing.rows[0].obsidian_path !== relativePath) {
    const oldAbsolute = path.join(vaultRoot, existing.rows[0].obsidian_path);
    if (fs.existsSync(oldAbsolute)) {
      writingPaths.add(oldAbsolute);
      fs.unlinkSync(oldAbsolute);
      setTimeout(() => writingPaths.delete(oldAbsolute), 3000);
    }
  }

  // Write to Obsidian
  const markdown = buildMarkdown(doc, collectionName);
  const dir = path.dirname(absolutePath);

  writingPaths.add(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, markdown, "utf-8");
  setTimeout(() => writingPaths.delete(absolutePath), 3000);

  const obsidianHash = contentHash(doc.text);

  // Upsert sync state
  await query(
    `INSERT INTO outline_sync_state
       (outline_id, collection_id, collection_name, obsidian_path, outline_content_hash, obsidian_content_hash, outline_updated_at, last_synced_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'synced')
     ON CONFLICT (outline_id) DO UPDATE SET
       collection_id = $2, collection_name = $3, obsidian_path = $4,
       outline_content_hash = $5, obsidian_content_hash = $6,
       outline_updated_at = $7, last_synced_at = NOW(), status = 'synced',
       conflict_detected_at = NULL, updated_at = NOW()`,
    [doc.id, doc.collectionId, collectionName, relativePath, outlineHash, obsidianHash, doc.updatedAt],
  );
}

// ── Obsidian -> Outline scan ──

export async function scanObsidianToOutline(config: JoiConfig): Promise<{ pushed: number; skipped: number; conflicts: number }> {
  if (!config.outline.syncEnabled || !config.outline.apiKey) {
    return { pushed: 0, skipped: 0, conflicts: 0 };
  }

  const vaultRoot = resolveVaultPath(config);
  const outlineDir = path.join(vaultRoot, "Outline");

  if (!fs.existsSync(outlineDir)) {
    return { pushed: 0, skipped: 0, conflicts: 0 };
  }

  log("outline", "Starting Obsidian -> Outline scan");

  let pushed = 0;
  let skipped = 0;
  let conflicts = 0;

  // Get all tracked files from DB
  const tracked = await query<SyncState>(
    "SELECT * FROM outline_sync_state WHERE status != 'deleted'",
  );
  const stateByPath = new Map<string, SyncState>();
  for (const row of tracked.rows) {
    stateByPath.set(row.obsidian_path, row);
  }

  // Walk the Outline directory
  const walkDir = async (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath);
        continue;
      }

      if (!entry.name.endsWith(".md") || entry.name.endsWith(".conflict.md")) continue;

      const relativePath = path.relative(vaultRoot, fullPath);
      const content = fs.readFileSync(fullPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);
      const currentHash = contentHash(body);

      const state = stateByPath.get(relativePath);
      if (!state) {
        // Untracked file in Outline/ — skip (could be manually created)
        skipped++;
        continue;
      }

      // No changes
      if (currentHash === state.obsidian_content_hash) {
        skipped++;
        continue;
      }

      // Obsidian was modified — check for conflicts with Outline
      try {
        const outlineDoc = await api.getDocument(config, state.outline_id);
        const currentOutlineHash = contentHash(outlineDoc.text);

        if (currentOutlineHash !== state.outline_content_hash) {
          // Both sides changed — conflict
          log("outline", `Conflict during scan: ${relativePath}`, { outlineId: state.outline_id });

          const conflictPath = fullPath.replace(/\.md$/, ".conflict.md");
          const conflictContent = buildMarkdown(outlineDoc, state.collection_name || "Unknown");
          writingPaths.add(conflictPath);
          fs.writeFileSync(conflictPath, conflictContent, "utf-8");
          setTimeout(() => writingPaths.delete(conflictPath), 3000);

          await query(
            `UPDATE outline_sync_state
             SET status = 'conflicted', conflict_detected_at = NOW(),
                 obsidian_content_hash = $1, outline_content_hash = $2,
                 updated_at = NOW()
             WHERE outline_id = $3`,
            [currentHash, currentOutlineHash, state.outline_id],
          );
          conflicts++;
          continue;
        }

        // Only Obsidian changed — push to Outline
        await api.updateDocument(config, state.outline_id, { text: body });
        const newOutlineHash = contentHash(body);

        await query(
          `UPDATE outline_sync_state
           SET obsidian_content_hash = $1, outline_content_hash = $2,
               last_synced_at = NOW(), updated_at = NOW()
           WHERE outline_id = $3`,
          [currentHash, newOutlineHash, state.outline_id],
        );

        log("outline", `Pushed to Outline: ${relativePath}`, { outlineId: state.outline_id });
        pushed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("outline", `Failed to sync ${relativePath}: ${message}`);
        skipped++;
      }
    }
  };

  await walkDir(outlineDir);

  log("outline", `Scan complete: ${pushed} pushed, ${skipped} skipped, ${conflicts} conflicts`);
  return { pushed, skipped, conflicts };
}

// ── Full Outline -> Obsidian sync (bootstrap) ──

export async function fullOutlineSync(config: JoiConfig): Promise<{ synced: number; collections: number }> {
  if (!config.outline.apiKey) {
    throw new Error("Outline API key not configured");
  }

  log("outline", "Starting full Outline -> Obsidian sync");

  const collections = await api.listCollections(config);
  let synced = 0;

  for (const collection of collections) {
    collectionNameCache.set(collection.id, collection.name);
    log("outline", `Syncing collection: ${collection.name}`, { collectionId: collection.id });

    const docs = await api.listAllDocuments(config, collection.id);
    const docMap = new Map(docs.map((d) => [d.id, d]));
    for (const doc of docs) {
      try {
        await syncOutlineToObsidian(doc, config, docMap);
        synced++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("outline", `Failed to sync doc ${doc.title}: ${message}`, { outlineId: doc.id });
      }
    }
  }

  log("outline", `Full sync complete: ${synced} docs across ${collections.length} collections`);
  return { synced, collections: collections.length };
}

// ── Conflict resolution ──

export async function resolveConflict(
  outlineId: string,
  resolution: "keep_obsidian" | "keep_outline",
  config: JoiConfig,
): Promise<void> {
  const result = await query<SyncState>(
    "SELECT * FROM outline_sync_state WHERE outline_id = $1",
    [outlineId],
  );
  if (result.rows.length === 0) throw new Error("Sync state not found");

  const state = result.rows[0];
  const vaultRoot = resolveVaultPath(config);
  const obsidianFile = path.join(vaultRoot, state.obsidian_path);
  const conflictFile = obsidianFile.replace(/\.md$/, ".conflict.md");

  if (resolution === "keep_obsidian") {
    // Push Obsidian version to Outline
    if (fs.existsSync(obsidianFile)) {
      const content = fs.readFileSync(obsidianFile, "utf-8");
      const { body } = parseFrontmatter(content);
      await api.updateDocument(config, outlineId, { text: body });
      const hash = contentHash(body);

      await query(
        `UPDATE outline_sync_state
         SET status = 'synced', conflict_detected_at = NULL,
             obsidian_content_hash = $1, outline_content_hash = $1,
             last_synced_at = NOW(), updated_at = NOW()
         WHERE outline_id = $2`,
        [hash, outlineId],
      );
    }
  } else {
    // Keep Outline version — overwrite Obsidian file with conflict version
    if (fs.existsSync(conflictFile)) {
      const conflictContent = fs.readFileSync(conflictFile, "utf-8");
      writingPaths.add(obsidianFile);
      fs.writeFileSync(obsidianFile, conflictContent, "utf-8");
      setTimeout(() => writingPaths.delete(obsidianFile), 3000);

      const { body } = parseFrontmatter(conflictContent);
      const hash = contentHash(body);

      await query(
        `UPDATE outline_sync_state
         SET status = 'synced', conflict_detected_at = NULL,
             obsidian_content_hash = $1, outline_content_hash = $1,
             last_synced_at = NOW(), updated_at = NOW()
         WHERE outline_id = $2`,
        [hash, outlineId],
      );
    }
  }

  // Clean up conflict file
  if (fs.existsSync(conflictFile)) {
    fs.unlinkSync(conflictFile);
  }

  log("outline", `Conflict resolved (${resolution}): ${state.obsidian_path}`, { outlineId });
}

// ── Combined bidirectional sync (single cron entry point) ──

export async function runOutlineSync(config: JoiConfig): Promise<void> {
  if (!config.outline.syncEnabled || !config.outline.apiKey) return;

  // 1. Pull from Outline -> Obsidian
  await fullOutlineSync(config);

  // 2. Push local Obsidian edits -> Outline
  await scanObsidianToOutline(config);
}

// ── Status / queries ──

export async function getSyncStatus(): Promise<{
  total: number;
  synced: number;
  conflicted: number;
  deleted: number;
  lastSyncAt: string | null;
}> {
  const result = await query<{ status: string; count: string }>(
    "SELECT status, count(*)::text AS count FROM outline_sync_state GROUP BY status",
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  const lastSync = await query<{ last_synced_at: string }>(
    "SELECT last_synced_at FROM outline_sync_state ORDER BY last_synced_at DESC LIMIT 1",
  );

  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    synced: counts.synced || 0,
    conflicted: counts.conflicted || 0,
    deleted: counts.deleted || 0,
    lastSyncAt: lastSync.rows[0]?.last_synced_at || null,
  };
}

export async function getConflicts(): Promise<SyncState[]> {
  const result = await query<SyncState>(
    "SELECT * FROM outline_sync_state WHERE status = 'conflicted' ORDER BY conflict_detected_at DESC",
  );
  return result.rows;
}
