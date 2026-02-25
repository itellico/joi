import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { readGlobalSoulDocument, readSoulDocumentForAgent } from "./soul-documents.js";
import { listExternalSkillCatalog } from "../skills/catalog.js";

// Skills prompt cache — avoids reading many SKILL.md files from disk on every call
let _skillsCache: { text: string; builtAt: number } | null = null;
const SKILLS_CACHE_TTL_MS = 60_000; // 60 seconds

/** Build a compact index of installed Claude/Codex/Gemini skills for prompt-time routing. */
export function buildSkillsPrompt(): string {
  if (_skillsCache && (Date.now() - _skillsCache.builtAt) < SKILLS_CACHE_TTL_MS) {
    return _skillsCache.text;
  }

  const entries = listExternalSkillCatalog();
  if (entries.length === 0) return "";

  const sourceOrder = ["claude-code", "gemini", "codex", "codex-project", "codex-system"];
  const sourceLabel: Record<string, string> = {
    "claude-code": "Claude Code Skills",
    gemini: "Gemini Skills",
    codex: "Codex Skills (User)",
    "codex-project": "Codex Skills (Project)",
    "codex-system": "Codex Skills (System)",
  };

  const sections = sourceOrder
    .map((source) => {
      const group = entries
        .filter((entry) => entry.source === source)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (group.length === 0) return "";

      const lines = group.map((entry) => {
        const desc = (entry.description || "No description").slice(0, 180);
        return `- **${entry.name}**: ${desc}`;
      });
      return `### ${sourceLabel[source] || source}\n${lines.join("\n")}`;
    })
    .filter(Boolean);

  const result = `\n\n## Available Skills (${entries.length})
You have access to specialized skills from Claude, Gemini, and Codex skill folders. When a task matches a skill, use \`skill_read\` to load its full instructions, then execute with your native tools.

If a skill name exists in multiple sources, provide \`source\` to \`skill_read\` to disambiguate.

${sections.join("\n\n")}`;

  _skillsCache = { text: result, builtAt: Date.now() };
  return result;
}

interface BuildSystemPromptOptions {
  includeSkillsPrompt?: boolean;
  language?: string;
  agentId?: string;
  soulDocument?: string;
}

/** Language instruction blocks keyed by language code. */
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  de: "\n\n## Language\nAlways respond in German (Deutsch). Use informal Du-form. Be natural and conversational.",
  fr: "\n\n## Language\nAlways respond in French (Français). Be natural and conversational.",
  es: "\n\n## Language\nAlways respond in Spanish (Español). Be natural and conversational.",
  it: "\n\n## Language\nAlways respond in Italian (Italiano). Be natural and conversational.",
  pt: "\n\n## Language\nAlways respond in Portuguese (Português). Be natural and conversational.",
};

/** Map language code → IETF locale for date/time formatting. */
const LANGUAGE_LOCALES: Record<string, string> = {
  en: "en-US",
  de: "de-AT",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-PT",
};

/** Stable timestamp — bucketized to 15 minutes for cache friendliness. */
function stableTimestamp(locale: string): { dateStr: string; timeStr: string } {
  const now = new Date();
  now.setMinutes(Math.floor(now.getMinutes() / 15) * 15, 0, 0);
  const dateStr = now.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return { dateStr, timeStr };
}

export interface SystemPromptParts {
  /** Static block: soul doc + agent override + skills index (stable across turns) */
  staticBlock: string;
  /** Dynamic block: timestamp + per-turn suffix (changes each call) */
  dynamicBlock: string;
}

/**
 * Build system prompt as structured parts for caching support.
 * Static block is stable across turns → can be cached.
 * Dynamic block changes per call → not cached.
 */
export function buildSystemPromptParts(customPrompt?: string, options?: BuildSystemPromptOptions): SystemPromptParts {
  const lang = options?.language || "en";
  const locale = LANGUAGE_LOCALES[lang] || "en-US";

  const soulDocument = typeof options?.soulDocument === "string" && options.soulDocument.trim().length > 0
    ? options.soulDocument
    : (options?.agentId
      ? readSoulDocumentForAgent(options.agentId).content
      : readGlobalSoulDocument().content);
  const soulBase = soulDocument.trim();
  const customOverride = customPrompt?.trim();
  const base = customOverride
    ? `${soulBase}\n\n## Agent Override\n${customOverride}`
    : soulBase;
  const includeSkillsPrompt = options?.includeSkillsPrompt ?? true;
  const skillsPrompt = includeSkillsPrompt ? buildSkillsPrompt() : "";
  const languageInstruction = lang !== "en" ? (LANGUAGE_INSTRUCTIONS[lang] || `\n\n## Language\nAlways respond in the language with code "${lang}".`) : "";

  // Static: soul doc + skills + execution discipline + language
  const staticBlock = `${base}${skillsPrompt}

## Voice Style
When responding in voice contexts, be natural and concise. Do not output bracketed emotion tags like [happy] or [thinking].

## Execution Discipline
- Before running tools for an action, announce the next step in one short sentence.
- When Marcus provides multiple items or requests in one flow, keep an internal checklist and work through each item until complete.
- If something is blocked, say exactly what is blocked and what input you need next.${languageInstruction}`;

  // Dynamic: timestamp + platform
  const { dateStr, timeStr } = stableTimestamp(locale);
  const dynamicBlock = `\n\n## Current Context
- Date: ${dateStr}
- Time: ${timeStr}
- Platform: macOS (Mac Mini)`;

  return { staticBlock, dynamicBlock };
}

/**
 * Build Anthropic-format system prompt with cache_control markers.
 * Returns TextBlockParam[] with cache_control on the static block.
 */
export function buildCachedSystemBlocks(customPrompt?: string, options?: BuildSystemPromptOptions): TextBlockParam[] {
  const { staticBlock, dynamicBlock } = buildSystemPromptParts(customPrompt, options);
  return [
    {
      type: "text",
      text: staticBlock,
      cache_control: { type: "ephemeral" },
    } as TextBlockParam,
    {
      type: "text",
      text: dynamicBlock,
    },
  ];
}

/** Original string-based system prompt — backward compatible wrapper. */
export function buildSystemPrompt(customPrompt?: string, options?: BuildSystemPromptOptions): string {
  const lang = options?.language || "en";
  const locale = LANGUAGE_LOCALES[lang] || "en-US";

  const { dateStr, timeStr } = stableTimestamp(locale);

  const soulDocument = typeof options?.soulDocument === "string" && options.soulDocument.trim().length > 0
    ? options.soulDocument
    : (options?.agentId
      ? readSoulDocumentForAgent(options.agentId).content
      : readGlobalSoulDocument().content);
  const soulBase = soulDocument.trim();
  const customOverride = customPrompt?.trim();
  const base = customOverride
    ? `${soulBase}\n\n## Agent Override\n${customOverride}`
    : soulBase;
  const includeSkillsPrompt = options?.includeSkillsPrompt ?? true;
  const skillsPrompt = includeSkillsPrompt ? buildSkillsPrompt() : "";
  const languageInstruction = lang !== "en" ? (LANGUAGE_INSTRUCTIONS[lang] || `\n\n## Language\nAlways respond in the language with code "${lang}".`) : "";

  return `${base}

## Current Context
- Date: ${dateStr}
- Time: ${timeStr}
- Platform: macOS (Mac Mini)${skillsPrompt}

## Voice Style
When responding in voice contexts, be natural and concise. Do not output bracketed emotion tags like [happy] or [thinking].

## Execution Discipline
- Before running tools for an action, announce the next step in one short sentence.
- When Marcus provides multiple items or requests in one flow, keep an internal checklist and work through each item until complete.
- If something is blocked, say exactly what is blocked and what input you need next.${languageInstruction}`;
}
