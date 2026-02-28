/**
 * Strict agent skill policy:
 * - NULL skills (legacy "all tools") are not allowed for specialist routing.
 * - Known legacy agents get explicit defaults.
 * - Unknown legacy agents fall back to no tools until configured.
 */

const LEGACY_AGENT_DEFAULTS: Record<string, readonly string[]> = {
  personal: ["obsidian_search", "obsidian_read", "outline_search", "outline_read"],
  "app-dev": ["run_claude_code"],
  coder: ["run_claude_code"],
};

function normalizeList(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const skill of skills) {
    if (typeof skill !== "string") continue;
    const normalized = skill.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeAgentSkills(
  agentId: string,
  skills: readonly string[] | null | undefined,
): string[] {
  if (Array.isArray(skills)) {
    return normalizeList(skills);
  }
  const defaults = LEGACY_AGENT_DEFAULTS[agentId] || [];
  return normalizeList(defaults);
}

export function isLegacyUnrestrictedSkills(
  skills: readonly string[] | null | undefined,
): boolean {
  return skills === null;
}
