import type { ThingsTask } from "../things/client.js";

export type AutoDevExecutor = "claude-code" | "gemini-cli" | "codex-cli";
export type AutoDevExecutorMode = "auto" | AutoDevExecutor;

export interface AutoDevRouteDecision {
  executor: AutoDevExecutor;
  agentId: string;
  skill: string;
  reason: string;
  claudeScore: number;
  geminiScore: number;
  codexScore: number;
  strict: boolean;
}

interface SkillRule {
  skill: string;
  weight: number;
  patterns: RegExp[];
}

const CLAUDE_AGENT_ID = process.env.JOI_AUTODEV_CLAUDE_AGENT_ID || "coder";
const GEMINI_AGENT_ID = process.env.JOI_AUTODEV_GEMINI_AGENT_ID || "google-coder";
const CODEX_AGENT_ID = process.env.JOI_AUTODEV_CODEX_AGENT_ID || "codex-coder";

export function getAutoDevAgentId(executor: AutoDevExecutor): string {
  if (executor === "gemini-cli") return GEMINI_AGENT_ID;
  if (executor === "codex-cli") return CODEX_AGENT_ID;
  return CLAUDE_AGENT_ID;
}

const CLAUDE_RULES: SkillRule[] = [
  {
    skill: "engineering-core",
    weight: 3,
    patterns: [
      /\b(refactor|bug|fix|regression|debug|stack ?trace|compile|typecheck|lint|test)\b/i,
      /\b(node|typescript|javascript|react|postgres|sql|migration|schema|api|ws|websocket)\b/i,
      /\b(ci|deploy|docker|orbstack|script|terminal|shell|git)\b/i,
    ],
  },
  {
    skill: "system-reliability",
    weight: 2,
    patterns: [
      /\b(perf|performance|latency|optimization|memory leak|security|hardening)\b/i,
      /\b(crash|timeout|retry|health|watchdog|monitoring)\b/i,
    ],
  },
];

const GEMINI_RULES: SkillRule[] = [
  {
    skill: "multimodal-creative",
    weight: 3,
    patterns: [
      /\b(image|picture|avatar|logo|banner|thumbnail|art|design|visual|mockup)\b/i,
      /\b(video|youtube|tiktok|instagram|social media|ad creative)\b/i,
      /\b(multimodal|vision|ocr|screenshot)\b/i,
    ],
  },
  {
    skill: "google-workflow",
    weight: 2,
    patterns: [
      /\b(gemini|google ai studio|google cloud|vertex)\b/i,
      /\b(marketing copy|campaign copy|brand voice|caption)\b/i,
      /\b(research brief|trend brief|competitor snapshot)\b/i,
    ],
  },
];

const CODEX_RULES: SkillRule[] = [
  {
    skill: "repo-implementation",
    weight: 3,
    patterns: [
      /\b(implement|build|feature|integration|wire up|end-to-end|e2e)\b/i,
      /\b(multi[- ]file|across files|cross-cutting|refactor)\b/i,
      /\b(migration|schema|protocol|types|api contract)\b/i,
    ],
  },
  {
    skill: "fullstack-delivery",
    weight: 2,
    patterns: [
      /\b(frontend|backend|full[- ]stack|fullstack|ui and api)\b/i,
      /\b(react|typescript|node|postgres|sql)\b/i,
      /\b(codex|openai)\b/i,
    ],
  },
];

function normalizeMode(raw: string | undefined): AutoDevExecutorMode {
  if (!raw) return "auto";
  const mode = raw.trim().toLowerCase();
  if (mode === "claude-code" || mode === "gemini-cli" || mode === "codex-cli" || mode === "auto") {
    return mode;
  }
  return "auto";
}

export function getAutoDevExecutorMode(): AutoDevExecutorMode {
  return normalizeMode(process.env.JOI_AUTODEV_EXECUTOR_MODE);
}

function buildTaskText(task: ThingsTask): string {
  const checklist = task.checklist.map((item) => item.title).join("\n");
  const tags = task.tags.join("\n");
  return [
    task.title,
    task.notes || "",
    checklist,
    task.projectTitle || "",
    task.headingTitle || "",
    task.areaTitle || "",
    tags,
  ].join("\n").toLowerCase();
}

function normalizeLabel(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isGeminiLabel(value: string | null | undefined): boolean {
  const normalized = normalizeLabel(value);
  if (!normalized) return false;
  return /\b(gemini|google|nano banana)\b/i.test(normalized);
}

function isClaudeLabel(value: string | null | undefined): boolean {
  const normalized = normalizeLabel(value);
  if (!normalized) return false;
  return /\b(claude|cloride|chloride)\b/i.test(normalized);
}

function isCodexLabel(value: string | null | undefined): boolean {
  const normalized = normalizeLabel(value);
  if (!normalized) return false;
  return /\b(codex)\b/i.test(normalized);
}

function scoreByRules(text: string, rules: SkillRule[]): {
  score: number;
  matches: string[];
  topSkill: string | null;
} {
  let score = 0;
  const matches: string[] = [];
  let topSkill: string | null = null;
  let topSkillScore = 0;

  for (const rule of rules) {
    let ruleHits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        ruleHits += 1;
      }
    }
    if (ruleHits > 0) {
      const ruleScore = rule.weight * ruleHits;
      score += ruleScore;
      matches.push(`${rule.skill} x${ruleHits}`);
      if (ruleScore > topSkillScore) {
        topSkillScore = ruleScore;
        topSkill = rule.skill;
      }
    }
  }

  return { score, matches, topSkill };
}

function decisionFromExecutor(
  executor: AutoDevExecutor,
  reason: string,
  claudeScore: number,
  geminiScore: number,
  codexScore: number,
  skill = "manual-override",
  strict = false,
): AutoDevRouteDecision {
  return {
    executor,
    agentId: getAutoDevAgentId(executor),
    skill,
    reason,
    claudeScore,
    geminiScore,
    codexScore,
    strict,
  };
}

export function routeAutoDevTask(task: ThingsTask, mode: AutoDevExecutorMode = getAutoDevExecutorMode()): AutoDevRouteDecision {
  const text = buildTaskText(task);

  if (/\b(use\s+codex|#codex|\[codex\]|@codex)\b/i.test(text)) {
    return decisionFromExecutor("codex-cli", "Task explicitly requested Codex CLI.", 0, 0, 10, "manual-override", true);
  }
  if (/\b(use\s+gemini|#gemini|\[gemini\]|@gemini)\b/i.test(text)) {
    return decisionFromExecutor("gemini-cli", "Task explicitly requested Gemini.", 0, 10, 0, "manual-override", true);
  }
  if (/\b(use\s+claude|#claude|\[claude\]|@claude|#cloride|\[cloride\]|@cloride|#chloride|\[chloride\]|@chloride)\b/i.test(text)) {
    return decisionFromExecutor("claude-code", "Task explicitly requested Claude Code.", 10, 0, 0, "manual-override", true);
  }

  if (isCodexLabel(task.headingTitle)) {
    return decisionFromExecutor(
      "codex-cli",
      `Routed by Things section "${task.headingTitle}" (Codex section).`,
      0,
      0,
      10,
      "things-section-codex",
      true,
    );
  }

  if (isGeminiLabel(task.headingTitle)) {
    return decisionFromExecutor(
      "gemini-cli",
      `Routed by Things section "${task.headingTitle}" (Gemini section).`,
      0,
      10,
      0,
      "things-section-gemini",
      true,
    );
  }
  if (isClaudeLabel(task.headingTitle)) {
    return decisionFromExecutor(
      "claude-code",
      `Routed by Things section "${task.headingTitle}" (Claude section).`,
      10,
      0,
      0,
      "things-section-claude",
      true,
    );
  }

  const codexTag = task.tags.find((tag) => isCodexLabel(tag));
  if (codexTag) {
    return decisionFromExecutor(
      "codex-cli",
      `Routed by Things tag "${codexTag}" (Codex tag).`,
      0,
      0,
      10,
      "things-tag-codex",
      true,
    );
  }

  const geminiTag = task.tags.find((tag) => isGeminiLabel(tag));
  if (geminiTag) {
    return decisionFromExecutor(
      "gemini-cli",
      `Routed by Things tag "${geminiTag}" (Gemini tag).`,
      0,
      10,
      0,
      "things-tag-gemini",
      true,
    );
  }

  const claudeTag = task.tags.find((tag) => isClaudeLabel(tag));
  if (claudeTag) {
    return decisionFromExecutor(
      "claude-code",
      `Routed by Things tag "${claudeTag}" (Claude tag).`,
      10,
      0,
      0,
      "things-tag-claude",
      true,
    );
  }

  if (mode === "claude-code") {
    return decisionFromExecutor("claude-code", "Executor mode forced to claude-code.", 1, 0, 0, "manual-override", true);
  }
  if (mode === "gemini-cli") {
    return decisionFromExecutor("gemini-cli", "Executor mode forced to gemini-cli.", 0, 1, 0, "manual-override", true);
  }
  if (mode === "codex-cli") {
    return decisionFromExecutor("codex-cli", "Executor mode forced to codex-cli.", 0, 0, 1, "manual-override", true);
  }

  const claude = scoreByRules(text, CLAUDE_RULES);
  const gemini = scoreByRules(text, GEMINI_RULES);
  const codex = scoreByRules(text, CODEX_RULES);

  const ranked = [
    { executor: "claude-code" as const, score: claude.score, matches: claude.matches, topSkill: claude.topSkill || "engineering-core" },
    { executor: "gemini-cli" as const, score: gemini.score, matches: gemini.matches, topSkill: gemini.topSkill || "multimodal-creative" },
    { executor: "codex-cli" as const, score: codex.score, matches: codex.matches, topSkill: codex.topSkill || "repo-implementation" },
  ].sort((a, b) => b.score - a.score);

  const [first, second] = ranked;
  if (first.score > second.score) {
    const reason = `${first.executor} skills matched (${first.matches.join(", ") || "generic fit"}) over ${second.executor} (${second.matches.join(", ") || "none"}).`;
    return decisionFromExecutor(first.executor, reason, claude.score, gemini.score, codex.score, first.topSkill);
  }

  const fallbackReason = gemini.score === 0 && claude.score === 0 && codex.score === 0
    ? "No skill match; defaulting to claude-code for engineering reliability."
    : "Scores tied; defaulting to claude-code.";
  return decisionFromExecutor("claude-code", fallbackReason, claude.score, gemini.score, codex.score, "tie-break");
}
