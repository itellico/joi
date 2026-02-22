// Knowledge Sync agent tools
// Scans JOI codebase structure & compares with Obsidian documentation
// Used by the knowledge-sync agent to keep docs in sync with code

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";
import fs from "node:fs";
import path from "node:path";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const JOI_ROOT = path.resolve(import.meta.dirname || "", "../../../..");
const OBSIDIAN_JOI_PATH = "🏆 Projects/joi";

// ─── Codebase tree: directory structure of JOI subdirectories ───

function getTree(dir: string, depth: number, maxDepth: number): Array<{ name: string; type: "file" | "dir"; children?: unknown[] }> {
  if (depth >= maxDepth || !fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items: Array<{ name: string; type: "file" | "dir"; children?: unknown[] }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;

    if (entry.isDirectory()) {
      const children = depth + 1 < maxDepth ? getTree(path.join(dir, entry.name), depth + 1, maxDepth) : undefined;
      items.push({ name: entry.name, type: "dir", children });
    } else {
      items.push({ name: entry.name, type: "file" });
    }
  }

  return items;
}

// ─── Codebase read: safely read a JOI project file ───

function safeReadFile(relPath: string): { content: string; size: number } | { error: string } {
  const resolved = path.resolve(JOI_ROOT, relPath);
  if (!resolved.startsWith(JOI_ROOT)) {
    return { error: "Path traversal not allowed" };
  }
  if (!fs.existsSync(resolved)) {
    return { error: `File not found: ${relPath}` };
  }
  const stat = fs.statSync(resolved);
  if (stat.size > 50000) {
    return { error: `File too large (${stat.size} bytes). Read specific sections instead.` };
  }
  const content = fs.readFileSync(resolved, "utf-8");
  return { content, size: content.length };
}

// ─── Migrations status from DB ───

async function getMigrationsStatus(): Promise<{
  applied: Array<{ name: string; appliedAt: string }>;
  onDisk: string[];
  pending: string[];
}> {
  const migrationsDir = path.join(JOI_ROOT, "gateway/src/db/migrations");

  // Get applied migrations from DB
  let applied: Array<{ name: string; appliedAt: string }> = [];
  try {
    const result = await query<{ name: string; applied_at: string }>(
      "SELECT name, applied_at FROM _migrations ORDER BY applied_at",
    );
    applied = result.rows.map((r) => ({ name: r.name, appliedAt: r.applied_at }));
  } catch {
    // _migrations table might not exist
  }

  // Get migrations on disk
  const onDisk = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
    : [];

  const appliedNames = new Set(applied.map((a) => a.name));
  const pending = onDisk.filter((f) => !appliedNames.has(f));

  return { applied, onDisk, pending };
}

// ─── Knowledge sync status: compare codebase with Obsidian docs ───

async function getKnowledgeSyncStatus(vaultRoot: string): Promise<{
  joiDocsPath: string;
  existingDocs: string[];
  codebaseState: {
    agentCount: number;
    skillCount: number;
    migrationCount: number;
    toolModules: string[];
  };
  gaps: string[];
}> {
  const joiDocsDir = path.join(vaultRoot, OBSIDIAN_JOI_PATH);

  // List existing Obsidian JOI docs
  const existingDocs: string[] = [];
  if (fs.existsSync(joiDocsDir)) {
    const entries = fs.readdirSync(joiDocsDir);
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        existingDocs.push(entry.replace(/\.md$/, ""));
      }
    }
  }

  // Get codebase state from DB
  const agentResult = await query<{ count: string }>("SELECT count(*) FROM agents");
  const skillResult = await query<{ count: string }>("SELECT count(*) FROM skills_registry");
  const migResult = await query<{ count: string }>("SELECT count(*) FROM _migrations");

  // Scan tool modules
  const toolsDir = path.join(JOI_ROOT, "gateway/src");
  const toolModules: string[] = [];
  const scanDirs = ["accounting", "google", "channels", "things", "knowledge", "sync", "apple", "youtube", "skills"];
  for (const dir of scanDirs) {
    const fullDir = path.join(toolsDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    const files = fs.readdirSync(fullDir).filter((f) => f.includes("tool"));
    toolModules.push(...files.map((f) => `${dir}/${f}`));
  }

  // Identify gaps
  const gaps: string[] = [];
  const expectedDocs = [
    "JOI Architecture Plan",
    "JOI Agents Catalog",
    "JOI Skills Registry",
    "JOI README",
  ];

  for (const expected of expectedDocs) {
    if (!existingDocs.some((d) => d.includes(expected.replace("JOI ", "")))) {
      gaps.push(`Missing Obsidian doc: ${expected}`);
    }
  }

  // Check agent docs - each agent category should have a doc
  const agents = await query<{ id: string; name: string }>("SELECT id, name FROM agents ORDER BY name");
  const agentNames = agents.rows.map((a) => a.name);
  const docMentionsAgents = existingDocs.some((d) => d.toLowerCase().includes("agent"));
  if (!docMentionsAgents && agentNames.length > 5) {
    gaps.push(`No agent catalog doc found — ${agentNames.length} agents need documentation`);
  }

  return {
    joiDocsPath: OBSIDIAN_JOI_PATH,
    existingDocs,
    codebaseState: {
      agentCount: parseInt(agentResult.rows[0].count),
      skillCount: parseInt(skillResult.rows[0].count),
      migrationCount: parseInt(migResult.rows[0].count),
      toolModules,
    },
    gaps,
  };
}

// ─── Tool handlers ───

export function getKnowledgeSyncToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set("codebase_tree", async (input) => {
    const { directory, depth } = input as { directory?: string; depth?: number };
    const targetDir = directory
      ? path.resolve(JOI_ROOT, directory)
      : JOI_ROOT;

    if (!targetDir.startsWith(JOI_ROOT)) {
      return { error: "Path traversal not allowed" };
    }

    return {
      root: directory || "/",
      tree: getTree(targetDir, 0, depth || 3),
    };
  });

  handlers.set("codebase_read", async (input) => {
    const { path: filePath } = input as { path: string };
    return safeReadFile(filePath);
  });

  handlers.set("codebase_migrations", async () => {
    return await getMigrationsStatus();
  });

  handlers.set("knowledge_sync_status", async (_input, ctx) => {
    const vaultPath = ctx.config.obsidian.vaultPath;
    if (!vaultPath) return { error: "No Obsidian vault path configured" };
    const resolved = vaultPath.replace(/^~/, process.env.HOME || "/root");
    return await getKnowledgeSyncStatus(resolved);
  });

  return handlers;
}

// ─── Tool definitions ───

export function getKnowledgeSyncToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "codebase_tree",
      description:
        "Get the directory structure of the JOI project. Returns files and folders up to a configurable depth. " +
        "Use to understand project layout before reading specific files.",
      input_schema: {
        type: "object" as const,
        properties: {
          directory: {
            type: "string",
            description: "Subdirectory relative to JOI root (e.g. 'gateway/src/agent'). Defaults to project root.",
          },
          depth: {
            type: "number",
            description: "Max depth to traverse (default: 3, max: 5)",
          },
        },
        required: [],
      },
    },
    {
      name: "codebase_read",
      description:
        "Read a file from the JOI codebase. Path is relative to the JOI project root. " +
        "Use to extract architecture info, tool registrations, config, or migration SQL.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "File path relative to JOI root (e.g. 'gateway/src/agent/tools.ts')",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "codebase_migrations",
      description:
        "List all database migrations — which are applied, which are on disk, and which are pending. " +
        "Use to track schema changes and ensure documentation reflects current DB state.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "knowledge_sync_status",
      description:
        "Compare the current JOI codebase state with Obsidian documentation. " +
        "Returns existing docs, codebase stats (agents, skills, migrations), and identified gaps where docs are missing or outdated.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
