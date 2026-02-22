// Obsidian Vault Watcher: watches for file changes, auto-indexes into knowledge base

import fs from "node:fs";
import path from "node:path";
import { watch } from "chokidar";
import { ingestDocument, deleteDocument } from "./ingest.js";
import { writingPaths } from "../sync/outline-sync.js";
import type { JoiConfig } from "../config/schema.js";

let watcher: ReturnType<typeof watch> | null = null;
let syncActive = false;

// Classify Obsidian doc by vault path
function classifyDoc(filePath: string): { type: string; area: string } {
  const normalized = filePath.replace(/\\/g, "/");

  // ─── Outline wiki (synced from go-outline) ───
  if (normalized.startsWith("Outline/")) {
    const parts = normalized.split("/");
    const space = parts[1] || "";

    // Role-based wikis → operational procedures
    const roleSpaces = [
      "Call Center Agent", "Call Center Analyst", "Casting Specialist",
      "Support Agent", "Feedback Agent", "Social Media Specialist",
    ];
    if (roleSpaces.includes(space)) {
      return { type: "outline_role", area: "knowledge" };
    }

    // Infrastructure & DevOps
    if (space === "DevOps" || space === "Infrastructure" || space === "VoiP") {
      return { type: "outline_infra", area: "knowledge" };
    }

    // Product spaces
    if (["go-models", "go-international", "manage.go-models", "go-models Django-Next", "itellico.ai"].includes(space)) {
      return { type: "outline_product", area: "knowledge" };
    }

    // Management & operations
    if (["Management", "Finance & Accounting", "Marketing", "Academy"].includes(space)) {
      return { type: "outline_ops", area: "knowledge" };
    }

    // Development & internal
    if (["itellico Bot Development", "itellicoAI_Brainstorming", "itellico"].includes(space)) {
      return { type: "outline_dev", area: "knowledge" };
    }

    // Personal / mm space
    if (space === "mm") {
      return { type: "outline_personal", area: "knowledge" };
    }

    return { type: "outline", area: "knowledge" };
  }

  // ─── Claude-specific vault folders ───
  if (normalized.includes("_Claude/Projects/")) {
    return { type: "project", area: "knowledge" };
  }
  if (normalized.includes("_Claude/Mac") || normalized.includes("Mac Architecture")) {
    return { type: "infrastructure", area: "knowledge" };
  }
  if (normalized.includes("_Claude/Skills/")) {
    return { type: "skills", area: "preferences" };
  }
  if (normalized.includes("Projects/joi/")) {
    return { type: "design", area: "knowledge" };
  }
  if (normalized.endsWith("README.md")) {
    return { type: "system_map", area: "knowledge" };
  }
  return { type: "document", area: "knowledge" };
}

// Extract title from markdown content or filename
function extractTitle(filePath: string, content: string): string {
  // Try H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Fall back to filename
  return path.basename(filePath, path.extname(filePath));
}

// Process a single file
async function processFile(filePath: string, vaultPath: string, config: JoiConfig): Promise<void> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return; // Skip empty files

    const relativePath = path.relative(vaultPath, filePath);
    const title = extractTitle(filePath, content);
    const { type, area } = classifyDoc(relativePath);

    await ingestDocument({
      source: "obsidian",
      path: relativePath,
      title,
      content,
      metadata: {
        obsidianType: type,
        obsidianArea: area,
        vaultPath: relativePath,
        lastModified: fs.statSync(filePath).mtime.toISOString(),
      },
      config,
    });

    console.log(`[Obsidian] Indexed: ${relativePath} (${type})`);
  } catch (err) {
    console.error(`[Obsidian] Failed to index ${filePath}:`, err);
  }
}

// Full vault sync (initial)
export async function fullSync(config: JoiConfig): Promise<{ indexed: number; skipped: number }> {
  const vaultPath = config.obsidian.vaultPath;
  if (!vaultPath) throw new Error("No Obsidian vault path configured");

  const resolvedPath = vaultPath.replace(/^~/, process.env.HOME || "/root");
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Vault path not found: ${resolvedPath}`);
  }

  let indexed = 0;
  let skipped = 0;
  const pending: Promise<void>[] = [];

  const walkDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip ignored patterns
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        // Queue async processing, then await all before returning.
        const run = processFile(fullPath, resolvedPath, config)
          .then(() => { indexed++; })
          .catch(() => { skipped++; });
        pending.push(run);
      }
    }
  };

  walkDir(resolvedPath);
  await Promise.allSettled(pending);
  return { indexed, skipped };
}

// Start watching vault for changes
export function startWatching(config: JoiConfig): void {
  if (syncActive) return;

  const vaultPath = config.obsidian.vaultPath;
  if (!vaultPath) {
    console.warn("[Obsidian] No vault path configured, skipping watch");
    return;
  }

  const resolvedPath = vaultPath.replace(/^~/, process.env.HOME || "/root");
  if (!fs.existsSync(resolvedPath)) {
    console.warn(`[Obsidian] Vault path not found: ${resolvedPath}`);
    return;
  }

  console.log(`[Obsidian] Watching vault: ${resolvedPath}`);

  // Debounce map to avoid rapid re-processing
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  watcher = watch(resolvedPath, {
    ignored: [
      /(^|[/\\])\./,       // dotfiles
      /node_modules/,
      /.obsidian/,
      /.trash/,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  const debouncedProcess = (filePath: string) => {
    if (writingPaths.has(filePath)) return;

    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        processFile(filePath, resolvedPath, config);
      }, 2000),
    );
  };

  watcher
    .on("add", (filePath) => {
      if (filePath.endsWith(".md")) debouncedProcess(filePath);
    })
    .on("change", (filePath) => {
      if (filePath.endsWith(".md")) debouncedProcess(filePath);
    })
    .on("unlink", (filePath) => {
      if (filePath.endsWith(".md")) {
        const relativePath = path.relative(resolvedPath, filePath);
        deleteDocument("obsidian", relativePath).then(() => {
          console.log(`[Obsidian] Removed: ${relativePath}`);
        });
      }
    });

  syncActive = true;
}

// Stop watching
export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  syncActive = false;
}

export function isSyncActive(): boolean {
  return syncActive;
}
