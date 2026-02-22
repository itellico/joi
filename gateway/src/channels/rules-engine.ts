// Rules engine: loads inbox rules from the store, matches them against
// incoming messages, formats them for the triage LLM, and tracks hits.

import { query } from "../db/client.js";
import { embed } from "../knowledge/embeddings.js";
import type { JoiConfig } from "../config/schema.js";
import type { ChannelMessage } from "./types.js";

// ─── Types ───

export interface InboxRule {
  id: string;
  title: string;
  data: {
    match_sender?: string;
    match_channel?: string;
    match_keywords?: string;
    match_intent?: string;
    override_intent?: string;
    override_urgency?: string;
    action_type: string;
    action_config?: Record<string, unknown>;
    auto_approve?: boolean;
    priority?: number;
    hit_count?: number;
    last_hit_at?: string;
  };
  tags: string[];
}

// ─── Collection ID cache ───

let rulesCollectionId: string | null = null;

async function getRulesCollectionId(): Promise<string | null> {
  if (rulesCollectionId) return rulesCollectionId;
  const result = await query<{ id: string }>(
    "SELECT id FROM store_collections WHERE name = 'Inbox Rules'",
  );
  rulesCollectionId = result.rows[0]?.id ?? null;
  return rulesCollectionId;
}

// ─── Rule matching ───

/** Check if a sender matches a pattern. Without wildcards, uses substring match
 *  (e.g. "acme" matches "john@acme.com"). With *, uses glob matching. */
function senderMatches(sender: string, pattern: string): boolean {
  const lower = sender.toLowerCase();
  const parts = pattern.toLowerCase().split("*");
  if (parts.length === 1) return lower.includes(parts[0]);
  // Convert simple glob to regex: *@acme.com → .*@acme\.com
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp("^" + escaped.join(".*") + "$");
  return regex.test(lower);
}

/** Check if message content contains any of the comma-separated keywords. */
function keywordsMatch(content: string, keywords: string): boolean {
  const lower = content.toLowerCase();
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => lower.includes(k));
}

/**
 * Load rules matching an incoming message. Two-phase lookup:
 * 1. Structural: sender pattern, channel, keywords
 * 2. Semantic: embedding similarity (if few structural matches)
 */
export async function loadMatchingRules(
  msg: ChannelMessage,
  config: JoiConfig,
): Promise<InboxRule[]> {
  const collectionId = await getRulesCollectionId();
  if (!collectionId) return [];

  // Load all active rules (typically a small set — dozens, not thousands)
  const result = await query<{
    id: string;
    title: string;
    data: InboxRule["data"];
    tags: string[];
  }>(
    `SELECT id, title, data, tags FROM store_objects
     WHERE collection_id = $1 AND status = 'active'
     ORDER BY (data->>'priority')::int DESC NULLS LAST`,
    [collectionId],
  );

  const allRules = result.rows as InboxRule[];
  const sender = (msg.senderName || msg.senderId).toLowerCase();
  const channel = msg.channelType;
  const content = msg.content;

  // Phase 1: Structural matching
  const structuralMatches = allRules.filter((rule) => {
    const d = rule.data;

    // Channel filter
    if (d.match_channel && d.match_channel !== "any" && d.match_channel !== channel) {
      return false;
    }

    // Sender pattern
    if (d.match_sender && !senderMatches(sender, d.match_sender)) {
      return false;
    }

    // Keyword filter
    if (d.match_keywords && !keywordsMatch(content, d.match_keywords)) {
      return false;
    }

    // If rule has no structural match criteria, skip it in structural phase
    // (it may match via semantic search below)
    if (!d.match_sender && !d.match_keywords && (!d.match_channel || d.match_channel === "any")) {
      return false;
    }

    return true;
  });

  // Phase 2: Semantic matching (if few structural matches and embeddings available)
  let semanticMatches: InboxRule[] = [];
  if (structuralMatches.length < 3) {
    try {
      const msgEmbedding = await embed(
        `${msg.senderName || msg.senderId}: ${content.slice(0, 500)}`,
        config,
      );
      const vecStr = `[${msgEmbedding.join(",")}]`;

      const semanticResult = await query<{
        id: string;
        title: string;
        data: InboxRule["data"];
        tags: string[];
        similarity: number;
      }>(
        `SELECT id, title, data, tags,
                1 - (embedding <=> $1::vector) AS similarity
         FROM store_objects
         WHERE collection_id = $2 AND status = 'active' AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        [vecStr, collectionId],
      );

      // Only keep semantically similar rules above threshold
      const structuralIds = new Set(structuralMatches.map((r) => r.id));
      semanticMatches = semanticResult.rows
        .filter((r) => r.similarity > 0.5 && !structuralIds.has(r.id))
        .map(({ similarity: _, ...rest }) => rest);
    } catch {
      // Embedding not available — skip semantic matching
    }
  }

  // Combine and sort by priority, cap at 10
  const combined = [...structuralMatches, ...semanticMatches];
  combined.sort((a, b) => (b.data.priority ?? 0) - (a.data.priority ?? 0));
  return combined.slice(0, 10);
}

// ─── Prompt formatting ───

/** Format matched rules as a human-readable block for injection into the triage LLM prompt. */
export function formatRulesForPrompt(rules: InboxRule[]): string {
  if (rules.length === 0) return "";

  const lines = rules.map((r, i) => {
    const conditions: string[] = [];
    if (r.data.match_sender) conditions.push(`sender ${r.data.match_sender}`);
    if (r.data.match_channel && r.data.match_channel !== "any") conditions.push(`channel ${r.data.match_channel}`);
    if (r.data.match_keywords) conditions.push(`keywords "${r.data.match_keywords}"`);

    const effects: string[] = [];
    if (r.data.override_intent) effects.push(`intent:${r.data.override_intent}`);
    if (r.data.override_urgency) effects.push(`urgency:${r.data.override_urgency}`);
    effects.push(r.data.action_type);
    if (r.data.auto_approve) effects.push("auto_approve");

    const condStr = conditions.length > 0 ? conditions.join(" + ") : "semantic match";
    return `${i + 1}. "${r.title}" [priority:${r.data.priority ?? 0}]: ${condStr} → ${effects.join(", ")}`;
  });

  return `ACTIVE RULES (apply if matching):\n${lines.join("\n")}`;
}

// ─── Hit tracking ───

/** Increment hit_count and set last_hit_at on a matched rule. */
export async function recordRuleHit(ruleId: string): Promise<void> {
  await query(
    `UPDATE store_objects
     SET data = jsonb_set(
       jsonb_set(data, '{hit_count}', to_jsonb(COALESCE((data->>'hit_count')::int, 0) + 1)),
       '{last_hit_at}', to_jsonb(NOW()::text)
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [ruleId],
  );
}

// ─── Auto-approve check ───

/** Returns true if any of the matched rules has auto_approve set. */
export function shouldAutoApprove(matchedRules: InboxRule[]): boolean {
  return matchedRules.some((r) => r.data.auto_approve === true);
}
