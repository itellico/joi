import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path, { join } from "node:path";

export type SkillEntryKind = "tool" | "instruction";
export type SkillRuntime = "gateway" | "claude" | "codex" | "gemini";
export type SkillScope = "system" | "user" | "project";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string | null;
  enabled: boolean;
  agent_ids: string[];
  created_at: string;
  kind: SkillEntryKind;
  runtime: SkillRuntime;
  scope: SkillScope;
}

export interface RegistrySkillRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string | null;
  enabled: boolean;
  agent_ids: string[] | null;
  created_at: string | Date;
}

interface ExternalScanResult {
  name: string;
  description: string | null;
  source: string;
  path: string;
  created_at: string;
  runtime: SkillRuntime;
  scope: SkillScope;
}

const SKILL_FILENAME = "SKILL.md";

function sanitizeIdFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function safeRealpath(dir: string): string | null {
  try {
    return realpathSync(dir);
  } catch {
    return null;
  }
}

function isDirectoryPath(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function isDirectoryEntry(parent: string, entryName: string): boolean {
  const fullPath = join(parent, entryName);
  try {
    const st = lstatSync(fullPath);
    if (st.isDirectory()) return true;
    if (st.isSymbolicLink()) return isDirectoryPath(fullPath);
    return false;
  } catch {
    return false;
  }
}

function collectSkillMarkdownFiles(root: string, maxDepth: number): string[] {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const resolved = safeRealpath(current.dir);
    if (!resolved || visited.has(resolved)) continue;
    visited.add(resolved);

    let dirEntries: string[] = [];
    try {
      dirEntries = readdirSync(current.dir);
    } catch {
      continue;
    }

    for (const entryName of dirEntries) {
      const fullPath = join(current.dir, entryName);
      if (entryName === SKILL_FILENAME) {
        files.push(fullPath);
        continue;
      }

      if (current.depth >= maxDepth) continue;
      if (!isDirectoryEntry(current.dir, entryName)) continue;
      stack.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }

  return files;
}

export function parseSkillDescription(content: string): string | null {
  let description = "";

  if (content.startsWith("---\n")) {
    const endIdx = content.indexOf("\n---", 4);
    if (endIdx !== -1) {
      const fm = content.slice(4, endIdx);
      const match = fm.match(/description:\s*(?:"([^"]+)"|'([^']+)'|(.+))/);
      if (match) {
        description = (match[1] || match[2] || match[3] || "").trim();
      }
    }
  }

  if (!description) {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
      description = trimmed.slice(0, 220);
      break;
    }
  }

  return description || null;
}

function scanClaudeSkills(): ExternalScanResult[] {
  const root = join(homedir(), ".claude", "skills");
  if (!existsSync(root)) return [];

  let topEntries: string[] = [];
  try {
    topEntries = readdirSync(root);
  } catch {
    return [];
  }

  const results: ExternalScanResult[] = [];

  for (const entryName of topEntries) {
    if (!isDirectoryEntry(root, entryName)) continue;
    const mdPath = join(root, entryName, SKILL_FILENAME);
    if (!existsSync(mdPath)) continue;

    try {
      const raw = readFileSync(mdPath, "utf-8");
      const createdAt = statSync(mdPath).mtime.toISOString();
      results.push({
        name: entryName,
        description: parseSkillDescription(raw),
        source: "claude-code",
        path: mdPath,
        created_at: createdAt,
        runtime: "claude",
        scope: "user",
      });
    } catch {
      // Ignore unreadable entries.
    }
  }

  return results;
}

function scanGeminiSkills(): ExternalScanResult[] {
  const root = join(homedir(), ".gemini", "skills");
  if (!existsSync(root)) return [];

  let topEntries: string[] = [];
  try {
    topEntries = readdirSync(root);
  } catch {
    return [];
  }

  const results: ExternalScanResult[] = [];

  for (const entryName of topEntries) {
    if (!isDirectoryEntry(root, entryName)) continue;
    const mdPath = join(root, entryName, SKILL_FILENAME);
    if (!existsSync(mdPath)) continue;

    try {
      const raw = readFileSync(mdPath, "utf-8");
      const createdAt = statSync(mdPath).mtime.toISOString();
      results.push({
        name: entryName,
        description: parseSkillDescription(raw),
        source: "gemini",
        path: mdPath,
        created_at: createdAt,
        runtime: "gemini",
        scope: "user",
      });
    } catch {
      // Ignore unreadable entries.
    }
  }

  return results;
}

function detectCodexSource(codexRoot: string, mdPath: string): { source: string; scope: SkillScope } {
  const relative = path.relative(codexRoot, mdPath).split(path.sep).join("/");
  const inSystem = relative.startsWith(".system/");
  const rootCanonical = codexRoot.split(path.sep).join("/");
  const isHomeCodex = rootCanonical.includes("/.codex/skills");

  if (inSystem) return { source: "codex-system", scope: "system" };
  if (isHomeCodex) return { source: "codex", scope: "user" };
  return { source: "codex-project", scope: "project" };
}

function scanCodexSkills(): ExternalScanResult[] {
  const roots = [
    join(homedir(), ".codex", "skills"),
    path.resolve(process.cwd(), ".codex", "skills"),
    path.resolve(process.cwd(), "..", ".codex", "skills"),
  ];

  const uniqueRoots: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const resolved = safeRealpath(root) || root;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    uniqueRoots.push(root);
  }

  const results: ExternalScanResult[] = [];
  const seenEntries = new Set<string>();

  for (const root of uniqueRoots) {
    const markdownFiles = collectSkillMarkdownFiles(root, 5);

    for (const mdPath of markdownFiles) {
      const name = path.basename(path.dirname(mdPath));
      if (!name || name.startsWith(".")) continue;

      const key = `${name}::${mdPath}`;
      if (seenEntries.has(key)) continue;
      seenEntries.add(key);

      try {
        const raw = readFileSync(mdPath, "utf-8");
        const createdAt = statSync(mdPath).mtime.toISOString();
        const sourceMeta = detectCodexSource(root, mdPath);

        results.push({
          name,
          description: parseSkillDescription(raw),
          source: sourceMeta.source,
          path: mdPath,
          created_at: createdAt,
          runtime: "codex",
          scope: sourceMeta.scope,
        });
      } catch {
        // Ignore unreadable entries.
      }
    }
  }

  return results;
}

export function mapRegistryRowsToCatalog(rows: RegistrySkillRow[]): SkillCatalogEntry[] {
  return rows.map((row) => {
    const normalizedPath = row.path ? row.path.toLowerCase() : "";
    const looksLikeInstruction = normalizedPath.endsWith("/skill.md") || normalizedPath.endsWith(".md");
    const kind: SkillEntryKind = row.source === "bundled" ? "tool" : (looksLikeInstruction ? "instruction" : "tool");

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      path: row.path,
      enabled: row.enabled,
      agent_ids: Array.isArray(row.agent_ids) ? row.agent_ids : [],
      created_at: typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
      kind,
      runtime: "gateway",
      scope: "system",
    };
  });
}

export function listExternalSkillCatalog(options?: {
  excludeNames?: Set<string>;
}): SkillCatalogEntry[] {
  const excludeNames = options?.excludeNames || new Set<string>();

  const external = [
    ...scanClaudeSkills(),
    ...scanCodexSkills(),
    ...scanGeminiSkills(),
  ];

  const entries = external
    .filter((entry) => !excludeNames.has(entry.name))
    .map((entry) => ({
      id: `${entry.source}-${sanitizeIdFragment(entry.name)}-${hashString(entry.path)}`,
      name: entry.name,
      description: entry.description,
      source: entry.source,
      path: entry.path,
      enabled: true,
      agent_ids: [],
      created_at: entry.created_at,
      kind: "instruction" as const,
      runtime: entry.runtime,
      scope: entry.scope,
    }));

  return entries.sort((a, b) => {
    const sourceCmp = a.source.localeCompare(b.source);
    if (sourceCmp !== 0) return sourceCmp;
    return a.name.localeCompare(b.name);
  });
}

export function summarizeSkillCatalog(entries: SkillCatalogEntry[]): {
  total: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
  byRuntime: Record<string, number>;
  byScope: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byRuntime: Record<string, number> = {};
  const byScope: Record<string, number> = {};

  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    byRuntime[entry.runtime] = (byRuntime[entry.runtime] || 0) + 1;
    byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
  }

  return {
    total: entries.length,
    byKind,
    bySource,
    byRuntime,
    byScope,
  };
}

function resolveClaudePath(name: string): string | null {
  const root = join(homedir(), ".claude", "skills");
  const exact = join(root, name, SKILL_FILENAME);
  if (existsSync(exact)) return exact;

  const hyphenated = name.replace(/_/g, "-");
  if (hyphenated !== name) {
    const alt = join(root, hyphenated, SKILL_FILENAME);
    if (existsSync(alt)) return alt;
  }

  return null;
}

function resolveCodexPath(name: string, source?: string): string | null {
  const entries = listExternalSkillCatalog();
  const nameCandidates = new Set([name, name.replace(/_/g, "-")]);

  const match = entries.find((entry) => {
    if (!nameCandidates.has(entry.name)) return false;
    if (!entry.source.startsWith("codex")) return false;
    if (source && entry.source !== source) return false;
    return true;
  });

  return match?.path || null;
}

function resolveGeminiPath(name: string): string | null {
  const root = join(homedir(), ".gemini", "skills");
  const exact = join(root, name, SKILL_FILENAME);
  if (existsSync(exact)) return exact;

  const hyphenated = name.replace(/_/g, "-");
  if (hyphenated !== name) {
    const alt = join(root, hyphenated, SKILL_FILENAME);
    if (existsSync(alt)) return alt;
  }

  return null;
}

export function resolveSkillPathByName(name: string, source?: string): string | null {
  if (source === "claude-code") {
    return resolveClaudePath(name);
  }

  if (source === "gemini") {
    return resolveGeminiPath(name);
  }

  if (source && source.startsWith("codex")) {
    return resolveCodexPath(name, source);
  }

  const claude = resolveClaudePath(name);
  if (claude) return claude;

  const codex = resolveCodexPath(name);
  if (codex) return codex;

  const gemini = resolveGeminiPath(name);
  if (gemini) return gemini;

  return null;
}
