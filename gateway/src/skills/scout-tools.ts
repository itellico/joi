// Skill Scout agent tools
// Audits JOI skills, Claude Code skills, and official repositories
// Suggests new skills and improvements

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const CLAUDE_SKILLS_DIR = "/Users/mm2/.claude/skills";

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
  if (!fs.existsSync(CLAUDE_SKILLS_DIR)) return [];

  const dirs = fs
    .readdirSync(CLAUDE_SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const skills: Array<{ name: string; description: string; path: string }> = [];

  for (const dir of dirs) {
    const skillMd = path.join(CLAUDE_SKILLS_DIR, dir.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const content = fs.readFileSync(skillMd, "utf-8");
    // Extract description from frontmatter
    const descMatch = content.match(/description:\s*["']?(.*?)["']?\s*\n/);
    const description = descMatch?.[1]?.substring(0, 200) || "No description";

    skills.push({
      name: dir.name,
      description,
      path: skillMd,
    });
  }

  return skills;
}

// ─── Check official Anthropic skills repo ───

async function checkOfficialSkills(): Promise<{
  available: Array<{ name: string; description: string }>;
  error?: string;
}> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["api", "repos/anthropics/skills/contents", "--jq", ".[].name"],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ available: [], error: stderr || err.message });
          return;
        }
        const names = stdout
          .trim()
          .split("\n")
          .filter((n) => n && !n.startsWith(".") && n !== "README.md" && n !== "LICENSE");
        resolve({
          available: names.map((n) => ({ name: n, description: `Official Anthropic skill: ${n}` })),
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
  officialSkills: Awaited<ReturnType<typeof checkOfficialSkills>>;
  gaps: {
    joiOnlyTools: string[];
    claudeCodeOnly: string[];
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

  const joiNames = new Set(joiSkills.skills.map((s) => s.name));
  const ccNames = new Set(claudeCodeSkills.map((s) => s.name));

  // JOI tools with no Claude Code skill equivalent
  const joiOnlyTools = [...joiNames].filter((n) => !ccNames.has(n));
  // Claude Code skills with no JOI equivalent
  const claudeCodeOnly = [...ccNames].filter((n) => !joiNames.has(n));
  // Agents with empty skills (no tool filtering)
  const agentsWithNoSkills = joiAgents
    .filter((a) => !a.skills || a.skills.length === 0)
    .map((a) => a.id);

  const suggestedImprovements: string[] = [];

  // Check for official skills we don't have
  for (const official of officialSkills.available) {
    if (!ccNames.has(official.name) && !joiNames.has(official.name)) {
      suggestedImprovements.push(
        `Official Anthropic skill "${official.name}" is available but not installed`,
      );
    }
  }

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
    officialSkills,
    gaps: {
      joiOnlyTools,
      claudeCodeOnly,
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
        "Run a full skill audit across JOI gateway, Claude Code skills, and official Anthropic repositories. " +
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
      description: "Check the official Anthropic skills repository (github.com/anthropics/skills) for available skills.",
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
