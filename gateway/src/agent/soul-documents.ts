import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_ROOT = path.resolve(__dirname, "../..");
const GLOBAL_SOUL_PATH = path.resolve(GATEWAY_ROOT, "soul.md");
const AGENT_SOULS_DIR = path.resolve(GATEWAY_ROOT, "souls");

const FALLBACK_GLOBAL_SOUL_DOCUMENT =
  "You are JOI, a personal AI assistant. Be helpful, concise, and proactive.";

export interface AgentSoulMeta {
  id: string;
  name?: string | null;
  description?: string | null;
  model?: string | null;
  skills?: string[] | null;
}

function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!normalized) {
    throw new Error("agentId is required.");
  }
  return normalized;
}

function normalizeSoulContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Soul document cannot be empty.");
  }
  return `${trimmed}\n`;
}

function buildAgentSoulTemplate(meta: AgentSoulMeta): string {
  const displayName = (meta.name || meta.id).trim();
  const description = (meta.description || "").trim() || "No specific mission has been defined yet.";
  const model = (meta.model || "").trim() || "default";
  const skills = Array.isArray(meta.skills) && meta.skills.length > 0
    ? meta.skills.join(", ")
    : "Use assigned tools responsibly.";

  return `# ${displayName} Soul Document

## Identity
You are ${displayName} (${meta.id}), an autonomous agent in the JOI system.

## Mission
${description}

## Values
- Tell the truth, cite evidence, and never bluff.
- Prefer small, reversible actions with clear outcomes.
- Escalate risky or irreversible actions for human review.

## Boundaries
- Never fabricate facts, sources, or execution results.
- Never perform irreversible or high-risk actions without explicit approval.
- Never ignore security, privacy, or compliance constraints.

## Decision Policy
- Model preference: ${model}
- Core skills: ${skills}
- Default stance: direct, pragmatic, accountable.
- Escalate when confidence is low or risk is non-trivial.

## Collaboration Protocol
- Coordinate with other agents when they are better suited for a task.
- Share assumptions, blockers, and next actions explicitly.
- Keep handoffs concise, traceable, and actionable.

## Learning Loop
- Capture one lesson from each meaningful task.
- Convert repeated wins into reusable playbooks.
- Surface gaps early and ask for targeted guidance.

## Success Metrics
- High task success rate with minimal rework.
- Clear, evidence-based outputs and decision traces.
- Low preventable escalations and high-quality handoffs.
`;
}

export function getGlobalSoulPath(): string {
  return GLOBAL_SOUL_PATH;
}

export function getAgentSoulPath(agentId: string): string {
  return path.resolve(AGENT_SOULS_DIR, `${normalizeAgentId(agentId)}.md`);
}

export function readGlobalSoulDocument(): { content: string; path: string; source: "global" | "fallback" } {
  try {
    const content = fs.readFileSync(GLOBAL_SOUL_PATH, "utf-8");
    if (content.trim().length > 0) {
      return { content, path: GLOBAL_SOUL_PATH, source: "global" };
    }
  } catch {
    // fall through to fallback text
  }

  return {
    content: FALLBACK_GLOBAL_SOUL_DOCUMENT,
    path: GLOBAL_SOUL_PATH,
    source: "fallback",
  };
}

export function ensureAgentSoulDocument(meta: AgentSoulMeta): {
  content: string;
  path: string;
  created: boolean;
} {
  const agentPath = getAgentSoulPath(meta.id);
  if (fs.existsSync(agentPath)) {
    const content = fs.readFileSync(agentPath, "utf-8");
    if (content.trim().length > 0) {
      return { content, path: agentPath, created: false };
    }
  }

  fs.mkdirSync(AGENT_SOULS_DIR, { recursive: true });
  const template = normalizeSoulContent(buildAgentSoulTemplate(meta));
  fs.writeFileSync(agentPath, template, "utf-8");
  return { content: template, path: agentPath, created: true };
}

export function readSoulDocumentForAgent(agentId: string): {
  content: string;
  path: string;
  source: "agent" | "global" | "fallback";
} {
  const agentPath = getAgentSoulPath(agentId);
  if (fs.existsSync(agentPath)) {
    const content = fs.readFileSync(agentPath, "utf-8");
    if (content.trim().length > 0) {
      return { content, path: agentPath, source: "agent" };
    }
  }

  const globalSoul = readGlobalSoulDocument();
  return {
    content: globalSoul.content,
    path: globalSoul.path,
    source: globalSoul.source,
  };
}

export function writeAgentSoulDocument(agentId: string, content: string): { path: string; content: string } {
  const agentPath = getAgentSoulPath(agentId);
  fs.mkdirSync(AGENT_SOULS_DIR, { recursive: true });
  const normalized = normalizeSoulContent(content);
  fs.writeFileSync(agentPath, normalized, "utf-8");
  return { path: agentPath, content: normalized };
}
