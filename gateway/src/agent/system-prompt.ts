import { readFileSync, readdirSync, existsSync, statSync, lstatSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load soul.md from gateway root (two levels up from src/agent/)
let soulDocument: string;
try {
  soulDocument = readFileSync(resolve(__dirname, "../../soul.md"), "utf-8");
} catch {
  // Fallback if soul.md is missing
  soulDocument = "You are JOI, a personal AI assistant. Be helpful, concise, and proactive.";
}

// Skills prompt cache — avoids reading 51+ SKILL.md files from disk on every call
let _skillsCache: { text: string; builtAt: number } | null = null;
const SKILLS_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Scan ~/.claude/skills/ for SKILL.md files and build a compact index.
 * Returns a prompt section listing available skills with name + description.
 * Handles symlinked skill directories (common pattern).
 * Results are cached for 60s to avoid repeated filesystem reads.
 */
export function buildSkillsPrompt(): string {
  if (_skillsCache && (Date.now() - _skillsCache.builtAt) < SKILLS_CACHE_TTL_MS) {
    return _skillsCache.text;
  }
  const skillsDir = join(homedir(), ".claude", "skills");
  if (!existsSync(skillsDir)) return "";

  const entries: { name: string; description: string }[] = [];

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => {
      if (d.isDirectory()) return true;
      if (d.isSymbolicLink()) {
        try {
          return statSync(join(skillsDir, d.name)).isDirectory();
        } catch {
          return false;
        }
      }
      return false;
    });

    for (const d of dirs) {
      const mdPath = join(skillsDir, d.name, "SKILL.md");
      if (!existsSync(mdPath)) continue;

      try {
        const raw = readFileSync(mdPath, "utf-8");
        let description = "";

        // Extract description from YAML frontmatter
        if (raw.startsWith("---\n")) {
          const endIdx = raw.indexOf("\n---", 4);
          if (endIdx !== -1) {
            const fm = raw.slice(4, endIdx);
            const descMatch = fm.match(/description:\s*(?:"([^"]+)"|'([^']+)'|(.+))/);
            if (descMatch) {
              description = (descMatch[1] || descMatch[2] || descMatch[3] || "").trim();
            }
          }
        }

        // If no frontmatter description, grab first non-heading line
        if (!description) {
          const lines = raw.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
              description = trimmed.slice(0, 120);
              break;
            }
          }
        }

        entries.push({ name: d.name, description });
      } catch {
        // Skip unreadable skills
      }
    }
  } catch {
    return "";
  }

  if (entries.length === 0) return "";

  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `- **${e.name}**: ${e.description}`);

  const result = `\n\n## Available Skills (${entries.length})
You have access to specialized skills from ~/.claude/skills/. When a task matches a skill, use the \`skill_read\` tool to load its full instructions, then follow them using your native tools.

${lines.join("\n")}`;

  _skillsCache = { text: result, builtAt: Date.now() };
  return result;
}

interface BuildSystemPromptOptions {
  includeSkillsPrompt?: boolean;
  language?: string;
}

/** Language instruction blocks keyed by language code. */
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  de: "\n\n## Language\nAlways respond in German (Deutsch). Use informal Du-form. Be natural and conversational.",
  fr: "\n\n## Language\nAlways respond in French (Fran\u00E7ais). Be natural and conversational.",
  es: "\n\n## Language\nAlways respond in Spanish (Espa\u00F1ol). Be natural and conversational.",
  it: "\n\n## Language\nAlways respond in Italian (Italiano). Be natural and conversational.",
  pt: "\n\n## Language\nAlways respond in Portuguese (Portugu\u00EAs). Be natural and conversational.",
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

export function buildSystemPrompt(customPrompt?: string, options?: BuildSystemPromptOptions): string {
  const lang = options?.language || "en";
  const locale = LANGUAGE_LOCALES[lang] || "en-US";

  const now = new Date();
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

  const base = customPrompt || soulDocument;
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
