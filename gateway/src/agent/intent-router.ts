/**
 * Intent Router — routes specialist queries to the right agent
 * based on LLM classification results.
 *
 * Previously used regex patterns; now uses the routeToAgent field
 * from the intent classifier (intent-classifier.ts).
 */

import { query } from "../db/client.js";

export interface ExecutionProfile {
  includeSkillsPrompt: boolean;
  includeMemoryContext: boolean;
  historyLimit: number;
}

export interface RouteDecision {
  routed: true;
  agentId: string;
  agentName: string | null;
  confidence: number;
  reason: string;
  matchedPattern: string;
  executionProfile: ExecutionProfile;
}

export interface RouteSkipped {
  routed: false;
  reason: string;
}

export interface RouteFailed {
  routed: false;
  reason: "target_missing" | "target_disabled";
  attemptedAgentId: string;
}

export type IntentRouteResult = RouteDecision | RouteSkipped | RouteFailed;

// Execution profiles for known specialist agents
const AGENT_EXECUTION_PROFILES: Record<string, ExecutionProfile> = {
  "media-integrations": {
    includeSkillsPrompt: false,
    includeMemoryContext: false,
    historyLimit: 10,
  },
  email: {
    includeSkillsPrompt: false,
    includeMemoryContext: true,
    historyLimit: 10,
  },
};

const DEFAULT_EXECUTION_PROFILE: ExecutionProfile = {
  includeSkillsPrompt: true,
  includeMemoryContext: true,
  historyLimit: 20,
};

// Cache for agent existence/enabled checks (5 minute TTL)
const agentStatusCache = new Map<string, { exists: boolean; enabled: boolean; name: string | null; checkedAt: number }>();
const AGENT_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

async function checkAgentStatus(agentId: string): Promise<{ exists: boolean; enabled: boolean; name: string | null }> {
  const cached = agentStatusCache.get(agentId);
  if (cached && Date.now() - cached.checkedAt < AGENT_STATUS_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const result = await query<{ id: string; enabled: boolean; name: string | null }>(
      "SELECT id, enabled, name FROM agents WHERE id = $1",
      [agentId],
    );
    const status = result.rows.length > 0
      ? { exists: true, enabled: result.rows[0].enabled, name: result.rows[0].name }
      : { exists: false, enabled: false, name: null };
    agentStatusCache.set(agentId, { ...status, checkedAt: Date.now() });
    return status;
  } catch {
    return { exists: false, enabled: false, name: null };
  }
}

/**
 * Route a user message to a specialist agent based on LLM classification.
 *
 * @param incomingAgentId - Current agent (user-selected or default)
 * @param classifiedAgent - Agent suggested by the intent classifier (e.g. "media-integrations", "email")
 * @param confidence - Classifier confidence (0-1)
 */
export async function routeIntent(
  incomingAgentId?: string,
  classifiedAgent?: string | null,
  confidence?: number,
): Promise<IntentRouteResult> {
  // User override protection — if user explicitly selected a non-personal agent, respect it
  if (incomingAgentId && incomingAgentId !== "personal") {
    return { routed: false, reason: "user_override" };
  }

  // No routing suggestion from classifier
  if (!classifiedAgent) {
    return { routed: false, reason: "no_match" };
  }

  // Validate target agent exists and is enabled
  const status = await checkAgentStatus(classifiedAgent);
  if (!status.exists) {
    console.warn(`[intent-router] Target agent "${classifiedAgent}" not found in DB`);
    return { routed: false, reason: "target_missing", attemptedAgentId: classifiedAgent };
  }
  if (!status.enabled) {
    console.warn(`[intent-router] Target agent "${classifiedAgent}" is disabled`);
    return { routed: false, reason: "target_disabled", attemptedAgentId: classifiedAgent };
  }

  const executionProfile = AGENT_EXECUTION_PROFILES[classifiedAgent] || DEFAULT_EXECUTION_PROFILE;
  const conf = typeof confidence === "number" ? confidence : 0.8;

  const decision: RouteDecision = {
    routed: true,
    agentId: classifiedAgent,
    agentName: status.name,
    confidence: conf,
    reason: `classifier:${classifiedAgent}`,
    matchedPattern: classifiedAgent,
    executionProfile,
  };
  console.log(`[intent-router] Routed to ${classifiedAgent} (name=${status.name}, confidence=${conf})`);
  return decision;
}

/** Clear agent status cache — for testing only. */
export function _clearAgentStatusCache(): void {
  agentStatusCache.clear();
}
