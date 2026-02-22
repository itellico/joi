// Obsidian vault agent tools — read, write, search, list notes from within agent conversations

import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

function resolveVault(ctx: ToolContext): string {
  const vaultPath = ctx.config.obsidian.vaultPath;
  if (!vaultPath) throw new Error("No Obsidian vault path configured in settings.");
  return vaultPath.replace(/^~/, process.env.HOME || "/root");
}

function safePath(vaultRoot: string, notePath: string): string {
  const resolved = path.resolve(vaultRoot, notePath);
  if (!resolved.startsWith(vaultRoot)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

// ─── obsidian_read: Read a note from the vault ───

handlers.set("obsidian_read", async (input, ctx) => {
  const { path: notePath } = input as { path: string };
  const vault = resolveVault(ctx);
  const fullPath = safePath(vault, notePath.endsWith(".md") ? notePath : `${notePath}.md`);

  if (!fs.existsSync(fullPath)) {
    return { error: `Note not found: ${notePath}` };
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const stats = fs.statSync(fullPath);

  return {
    path: notePath,
    content: content.length > 10000 ? content.slice(0, 10000) + "\n\n... (truncated)" : content,
    size: content.length,
    modifiedAt: stats.mtime.toISOString(),
  };
});

// ─── obsidian_write: Write/update a note in the vault ───

handlers.set("obsidian_write", async (input, ctx) => {
  const { path: notePath, content, append } = input as {
    path: string;
    content: string;
    append?: boolean;
  };
  const vault = resolveVault(ctx);
  const fullPath = safePath(vault, notePath.endsWith(".md") ? notePath : `${notePath}.md`);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (append && fs.existsSync(fullPath)) {
    const existing = fs.readFileSync(fullPath, "utf-8");
    fs.writeFileSync(fullPath, existing + "\n" + content, "utf-8");
  } else {
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  return { written: true, path: notePath, append: !!append };
});

// ─── obsidian_search: Search note contents in the vault ───

handlers.set("obsidian_search", async (input, ctx) => {
  const { query, folder, limit } = input as {
    query: string;
    folder?: string;
    limit?: number;
  };
  const vault = resolveVault(ctx);
  const searchRoot = folder ? safePath(vault, folder) : vault;
  const maxResults = limit || 10;
  const queryLower = query.toLowerCase();

  const results: Array<{ path: string; title: string; snippet: string; score: number }> = [];

  function searchDir(dir: string) {
    if (results.length >= maxResults * 2) return; // Collect extra for scoring

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDir(full);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = fs.readFileSync(full, "utf-8");
          const lower = content.toLowerCase();
          const titleLower = entry.name.replace(/\.md$/, "").toLowerCase();

          let score = 0;
          if (titleLower.includes(queryLower)) score += 3;
          if (lower.includes(queryLower)) score += 1;

          // Count occurrences for relevance
          let idx = 0;
          let count = 0;
          while ((idx = lower.indexOf(queryLower, idx)) !== -1) {
            count++;
            idx += queryLower.length;
            if (count > 10) break;
          }
          score += Math.min(count, 5) * 0.2;

          if (score > 0) {
            // Extract snippet around first match
            const matchIdx = lower.indexOf(queryLower);
            const start = Math.max(0, matchIdx - 80);
            const end = Math.min(content.length, matchIdx + queryLower.length + 80);
            const snippet = (start > 0 ? "..." : "") +
              content.slice(start, end).replace(/\n/g, " ").trim() +
              (end < content.length ? "..." : "");

            results.push({
              path: path.relative(vault, full),
              title: entry.name.replace(/\.md$/, ""),
              snippet,
              score,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  searchDir(searchRoot);

  // Sort by score, take top results
  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, maxResults);

  return { results: top, count: top.length, total: results.length };
});

// ─── obsidian_list: List notes/folders in a directory ───

handlers.set("obsidian_list", async (input, ctx) => {
  const { folder, recursive } = input as {
    folder?: string;
    recursive?: boolean;
  };
  const vault = resolveVault(ctx);
  const target = folder ? safePath(vault, folder) : vault;

  if (!fs.existsSync(target)) {
    return { error: `Folder not found: ${folder || "/"}` };
  }

  const items: Array<{ name: string; type: "file" | "folder"; path: string }> = [];

  function listDir(dir: string, depth: number) {
    if (depth > 3 && !recursive) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(vault, full);

      if (entry.isDirectory()) {
        items.push({ name: entry.name, type: "folder", path: rel });
        if (recursive && depth < 3) {
          listDir(full, depth + 1);
        }
      } else if (entry.name.endsWith(".md")) {
        items.push({ name: entry.name.replace(/\.md$/, ""), type: "file", path: rel });
      }
    }
  }

  listDir(target, 0);

  return {
    folder: folder || "/",
    items,
    count: items.length,
  };
});

// ─── Exports ───

export function getObsidianToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getObsidianToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "obsidian_read",
      description:
        "Read a note from the Obsidian vault. Returns the full markdown content. Paths are relative to vault root (e.g. '🏆 Projects/joi/JOI README').",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Path to the note relative to vault root (with or without .md extension)" },
        },
        required: ["path"],
      },
    },
    {
      name: "obsidian_write",
      description:
        "Write or update a note in the Obsidian vault. Set append=true to add content to the end of an existing note instead of replacing it.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Path for the note relative to vault root" },
          content: { type: "string", description: "Markdown content to write" },
          append: { type: "boolean", description: "If true, append to existing note instead of overwriting (default: false)" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "obsidian_search",
      description:
        "Search for notes in the Obsidian vault by content or title. Returns matching notes with snippets. Use for finding specific information across vault notes.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search text (searches titles and content)" },
          folder: { type: "string", description: "Limit search to a specific folder (optional)" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "obsidian_list",
      description:
        "List notes and folders in the Obsidian vault. Returns names and paths. Use to explore vault structure before reading specific notes.",
      input_schema: {
        type: "object" as const,
        properties: {
          folder: { type: "string", description: "Folder path relative to vault root (default: root)" },
          recursive: { type: "boolean", description: "If true, list contents recursively up to 3 levels deep (default: false)" },
        },
        required: [],
      },
    },
  ];
}
