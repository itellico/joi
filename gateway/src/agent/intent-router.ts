/**
 * Intent Router — routes obvious specialist queries directly to the right agent,
 * bypassing the expensive personal-agent first pass.
 *
 * Feature-gated by JOI_INTENT_ROUTER=1 env flag.
 */

import { query } from "../db/client.js";

// ── Route patterns ──
// Each route maps keyword patterns to a target agent ID with an execution profile.

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

interface RouteRule {
  agentId: string;
  patterns: RegExp[];
  confidence: number;
  executionProfile: ExecutionProfile;
}

// Shared media keywords — also used by shouldEnableVoiceTools() in server.ts
// Note: "show"/"shows" excluded — too ambiguous (e.g. "show my inbox").
// "library" excluded — could be code library. Use "media library" context naturally from other keywords.
export const MEDIA_INTENT_KEYWORDS = /\b(emby|jellyseerr|movie|movies|series|tv\s*show|episode|episodes|tv|film|films|watchlist|watching|watched|media|streaming|subtitle|subtitles|plex|jellyfin)\b/i;

const EMAIL_INTENT_KEYWORDS = /\b(email|emails|inbox|mail|gmail|send\s+(?:an?\s+)?email|compose|draft|unread|reply|forward)\b/i;

const ROUTE_RULES: RouteRule[] = [
  {
    agentId: "media-integrations",
    patterns: [MEDIA_INTENT_KEYWORDS],
    confidence: 0.85,
    executionProfile: {
      includeSkillsPrompt: false,
      includeMemoryContext: false,
      historyLimit: 10,
    },
  },
  {
    agentId: "email",
    patterns: [EMAIL_INTENT_KEYWORDS],
    confidence: 0.80,
    executionProfile: {
      includeSkillsPrompt: false,
      includeMemoryContext: true,
      historyLimit: 10,
    },
  },
];

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
 * Attempt to route a user message to a specialist agent.
 *
 * Only routes when:
 * - Feature flag is enabled
 * - Incoming agentId is absent or "personal"
 * - A pattern matches with sufficient confidence
 * - Target agent exists and is enabled
 */
export async function routeIntent(
  message: string,
  incomingAgentId?: string,
): Promise<IntentRouteResult> {
  // Feature gate
  if (process.env.JOI_INTENT_ROUTER !== "1") {
    return { routed: false, reason: "feature_disabled" };
  }

  // User override protection — if user explicitly selected a non-personal agent, respect it
  if (incomingAgentId && incomingAgentId !== "personal") {
    return { routed: false, reason: "user_override" };
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return { routed: false, reason: "empty_message" };
  }

  // Find matching route
  for (const rule of ROUTE_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(trimmed);
      if (match) {
        // Validate target agent exists and is enabled
        const status = await checkAgentStatus(rule.agentId);
        if (!status.exists) {
          console.warn(`[intent-router] Target agent "${rule.agentId}" not found in DB`);
          return { routed: false, reason: "target_missing", attemptedAgentId: rule.agentId };
        }
        if (!status.enabled) {
          console.warn(`[intent-router] Target agent "${rule.agentId}" is disabled`);
          return { routed: false, reason: "target_disabled", attemptedAgentId: rule.agentId };
        }

        const decision: RouteDecision = {
          routed: true,
          agentId: rule.agentId,
          agentName: status.name,
          confidence: rule.confidence,
          reason: `keyword_match:${rule.agentId}`,
          matchedPattern: match[0],
          executionProfile: rule.executionProfile,
        };
        console.log(`[intent-router] Routed to ${rule.agentId} (name=${status.name}, confidence=${rule.confidence}, pattern="${match[0]}")`);
        return decision;
      }
    }
  }

  return { routed: false, reason: "no_match" };
}

/** Clear agent status cache — for testing only. */
export function _clearAgentStatusCache(): void {
  agentStatusCache.clear();
}
