// Skill Scout agent tools
// Audits JOI skills, Claude/Codex/Gemini skills, and official repositories
// Suggests new skills and improvements

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";
import { execFile } from "node:child_process";
import { listExternalSkillCatalog } from "./catalog.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

// ─── Scan JOI skills registry ───

async function scanJoiSkills(): Promise<{
  total: number;
  enabled: number;
  disabled: number;
  skills: Array<{ name: string; description: string; source: string; enabled: boolean }>;
}> {
  const result = await query<{ name: string; description: string; source: string; enabled: boolean }>(
    "SELECT name, description, source, enabled FROM skills_registry ORDER BY name",
  );
  return {
    total: result.rows.length,
    enabled: result.rows.filter((r) => r.enabled).length,
    disabled: result.rows.filter((r) => !r.enabled).length,
    skills: result.rows,
  };
}

// ─── Scan JOI agents ───

async function scanJoiAgents(): Promise<
  Array<{ id: string; name: string; model: string; enabled: boolean; skills: string[] | null; skillCount: number }>
> {
  const result = await query<{
    id: string;
    name: string;
    model: string;
    enabled: boolean;
    skills: string[] | null;
  }>("SELECT id, name, model, enabled, skills FROM agents ORDER BY name");

  return result.rows.map((r) => ({
    ...r,
    skillCount: r.skills?.length ?? 0,
  }));
}

// ─── Scan Claude Code skills directory ───

function scanClaudeCodeSkills(): Array<{
  name: string;
  description: string;
  path: string;
}> {
  return listExternalSkillCatalog()
    .filter((entry) => entry.source === "claude-code")
    .map((entry) => ({
      name: entry.name,
      description: entry.description || "No description",
      path: entry.path || "",
    }))
    .filter((entry) => !!entry.path);
}

function scanCodexSkills(): Array<{
  name: string;
  description: string;
  path: string;
  source: string;
}> {
  return listExternalSkillCatalog()
    .filter((entry) => entry.source.startsWith("codex"))
    .map((entry) => ({
      name: entry.name,
      description: entry.description || "No description",
      path: entry.path || "",
      source: entry.source,
    }))
    .filter((entry) => !!entry.path);
}

function scanGeminiSkills(): Array<{
  name: string;
  description: string;
  path: string;
}> {
  return listExternalSkillCatalog()
    .filter((entry) => entry.source === "gemini")
    .map((entry) => ({
      name: entry.name,
      description: entry.description || "No description",
      path: entry.path || "",
    }))
    .filter((entry) => !!entry.path);
}

// ─── Check Anthropic Claude Code community skills repo ───
// These are Claude Code instruction-based skills (markdown files), NOT JOI gateway tools.
// Included for informational purposes — they cannot be directly installed into JOI.

async function checkOfficialSkills(): Promise<{
  available: Array<{ name: string; description: string }>;
  error?: string;
}> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      [
        "api",
        "repos/anthropics/skills/contents/skills",
        "--jq",
        ".[] | select(.type == \"dir\") | .name",
      ],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ available: [], error: stderr || err.message });
          return;
        }
        const names = stdout
          .trim()
          .split("\n")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("."));
        resolve({
          available: names.map((n) => ({ name: n, description: `Claude Code community skill (not a JOI tool)` })),
        });
      },
    );
  });
}

// ─── Full audit with gap analysis ───

async function fullSkillAudit(): Promise<{
  joiSkills: Awaited<ReturnType<typeof scanJoiSkills>>;
  joiAgents: Awaited<ReturnType<typeof scanJoiAgents>>;
  claudeCodeSkills: ReturnType<typeof scanClaudeCodeSkills>;
  codexSkills: ReturnType<typeof scanCodexSkills>;
  geminiSkills: ReturnType<typeof scanGeminiSkills>;
  officialSkills: Awaited<ReturnType<typeof checkOfficialSkills>>;
  gaps: {
    joiOnlyTools: string[];
    claudeCodeOnly: string[];
    codexOnly: string[];
    geminiOnly: string[];
    agentsWithNoSkills: string[];
    suggestedImprovements: string[];
  };
}> {
  const [joiSkills, joiAgents, officialSkills] = await Promise.all([
    scanJoiSkills(),
    scanJoiAgents(),
    checkOfficialSkills(),
  ]);
  const claudeCodeSkills = scanClaudeCodeSkills();
  const codexSkills = scanCodexSkills();
  const geminiSkills = scanGeminiSkills();

  const joiNames = new Set(joiSkills.skills.map((s) => s.name));
  const ccNames = new Set(claudeCodeSkills.map((s) => s.name));
  const codexNames = new Set(codexSkills.map((s) => s.name));
  const geminiNames = new Set(geminiSkills.map((s) => s.name));

  // JOI tools with no Claude Code skill equivalent
  const joiOnlyTools = [...joiNames].filter((n) => !ccNames.has(n));
  // Claude Code skills with no JOI equivalent
  const claudeCodeOnly = [...ccNames].filter((n) => !joiNames.has(n));
  // Codex skills with no JOI equivalent
  const codexOnly = [...codexNames].filter((n) => !joiNames.has(n));
  // Gemini skills with no JOI equivalent
  const geminiOnly = [...geminiNames].filter((n) => !joiNames.has(n));
  // Agents with empty skills (no tool filtering)
  const agentsWithNoSkills = joiAgents
    .filter((a) => !a.skills || a.skills.length === 0)
    .map((a) => a.id);

  const suggestedImprovements: string[] = [];

  // Note: officialSkills are Claude Code community skills from github.com/anthropics/skills.
  // They are NOT JOI gateway tools and cannot be "installed" into JOI, so we don't suggest them.
  // They're included in the audit for informational purposes only.

  // Check for agents getting all tools
  if (agentsWithNoSkills.length > 0) {
    suggestedImprovements.push(
      `Agents without skill assignments (get all tools): ${agentsWithNoSkills.join(", ")}`,
    );
  }

  return {
    joiSkills,
    joiAgents,
    claudeCodeSkills,
    codexSkills,
    geminiSkills,
    officialSkills,
    gaps: {
      joiOnlyTools,
      claudeCodeOnly,
      codexOnly,
      geminiOnly,
      agentsWithNoSkills,
      suggestedImprovements,
    },
  };
}

// ─── Tool handlers ───

export function getSkillScoutToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set("skill_audit", async () => {
    return await fullSkillAudit();
  });

  handlers.set("skill_scan_joi", async () => {
    return await scanJoiSkills();
  });

  handlers.set("skill_scan_claude_code", async () => {
    return scanClaudeCodeSkills();
  });

  handlers.set("skill_scan_official", async () => {
    return await checkOfficialSkills();
  });

  handlers.set("skill_scan_agents", async () => {
    return await scanJoiAgents();
  });

  return handlers;
}

// ─── Tool definitions ───

export function getSkillScoutToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "skill_audit",
      description:
        "Run a full skill audit across JOI gateway tools, Claude Code skills, Gemini skills, Codex skills, and official Anthropic repositories. " +
        "Returns gap analysis, suggestions for new skills, and agents that need skill assignments.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "skill_scan_joi",
      description: "Scan the JOI skills_registry database for all registered tools and their status.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "skill_scan_claude_code",
      description: "Scan the Claude Code skills directory (~/.claude/skills/) for all installed skills.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "skill_scan_official",
      description: "List Claude Code community skills from github.com/anthropics/skills. These are instruction-based markdown skills for Claude Code, not JOI gateway tools.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "skill_scan_agents",
      description: "List all JOI agents with their assigned skills and tool counts.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
