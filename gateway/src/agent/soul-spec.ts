export interface SoulSectionSpec {
  id: string;
  title: string;
  aliases: string[];
  description: string;
}

export interface SoulValidationResult {
  valid: boolean;
  score: number;
  wordCount: number;
  presentSections: string[];
  missingSections: string[];
  issues: string[];
}

export const SOUL_SECTION_SPECS: SoulSectionSpec[] = [
  {
    id: "identity",
    title: "Identity",
    aliases: ["identity"],
    description: "Defines who the agent is and how it frames itself.",
  },
  {
    id: "mission",
    title: "Mission",
    aliases: ["mission", "purpose"],
    description: "Defines the mission and primary responsibility.",
  },
  {
    id: "values",
    title: "Values",
    aliases: ["values", "core values"],
    description: "Defines non-negotiable values and principles.",
  },
  {
    id: "boundaries",
    title: "Boundaries",
    aliases: ["boundaries", "constraints", "hard constraints", "guardrails"],
    description: "Defines hard constraints and forbidden behavior.",
  },
  {
    id: "decision_policy",
    title: "Decision Policy",
    aliases: ["decision policy", "decision heuristics", "decision rules"],
    description: "Defines how the agent decides, acts, and escalates.",
  },
  {
    id: "collaboration_protocol",
    title: "Collaboration Protocol",
    aliases: ["collaboration protocol", "collaboration contract", "handoff protocol"],
    description: "Defines cross-agent collaboration and handoffs.",
  },
  {
    id: "learning_loop",
    title: "Learning Loop",
    aliases: ["learning loop", "learning", "improvement loop"],
    description: "Defines how the agent learns and improves over time.",
  },
  {
    id: "success_metrics",
    title: "Success Metrics",
    aliases: ["success metrics", "success criteria", "metrics", "definition of done"],
    description: "Defines measurable success for this agent.",
  },
];

function normalizeHeading(input: string): string {
  return input
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!match) continue;
    headings.push(normalizeHeading(match[1]));
  }
  return headings;
}

function countWords(content: string): number {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[#>*_\-\[\]\(\)]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .length;
}

function hasSection(headings: string[], aliases: string[]): boolean {
  const normalizedAliases = aliases.map(normalizeHeading);
  return headings.some((heading) =>
    normalizedAliases.some((alias) =>
      heading === alias || heading.startsWith(`${alias} `) || heading.includes(alias),
    ),
  );
}

export function validateSoulDocument(content: string): SoulValidationResult {
  const normalizedContent = String(content || "");
  const trimmed = normalizedContent.trim();
  const issues: string[] = [];

  if (!trimmed) {
    return {
      valid: false,
      score: 0,
      wordCount: 0,
      presentSections: [],
      missingSections: SOUL_SECTION_SPECS.map((s) => s.id),
      issues: ["Soul document is empty."],
    };
  }

  const headings = extractHeadings(trimmed);
  const wordCount = countWords(trimmed);

  const presentSections: string[] = [];
  const missingSections: string[] = [];

  for (const section of SOUL_SECTION_SPECS) {
    if (hasSection(headings, section.aliases)) {
      presentSections.push(section.id);
    } else {
      missingSections.push(section.id);
    }
  }

  if (headings.length < 6) {
    issues.push("Soul document should include clear markdown headings for all sections.");
  }
  if (wordCount < 120) {
    issues.push("Soul document is too short. Aim for at least 120 words.");
  }
  if (missingSections.length > 0) {
    issues.push(`Missing required sections: ${missingSections.join(", ")}.`);
  }

  const sectionCompleteness = presentSections.length / SOUL_SECTION_SPECS.length;
  const lengthScore = Math.min(1, wordCount / 240);
  const score = Math.round(((sectionCompleteness * 0.8) + (lengthScore * 0.2)) * 100) / 100;
  const valid = missingSections.length === 0 && wordCount >= 120;

  return {
    valid,
    score,
    wordCount,
    presentSections,
    missingSections,
    issues,
  };
}

export function getSoulSpecSummary(): {
  requiredSections: SoulSectionSpec[];
  minimumWordCount: number;
} {
  return {
    requiredSections: SOUL_SECTION_SPECS,
    minimumWordCount: 120,
  };
}
