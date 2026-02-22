// Memory Consolidator: Nightly maintenance — merge duplicates, decay stale, GC expired
// Called by cron (daily at 3 AM).

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { supersedeMemory } from "./writer.js";
import { enqueueMissingFactVerificationReviews } from "./facts.js";
import type { JoiConfig } from "../config/schema.js";
import type { MemoryArea } from "./types.js";

// Identity/preferences are now handled by Facts workflow.
const AREAS: MemoryArea[] = ["knowledge", "solutions", "episodes"];

export interface ConsolidationReport {
  merged: number;
  decayed: number;
  deleted: number;
  dedupedFacts: number;
  conflictingFacts: number;
  noisyFacts: number;
  cleanedLegacyIdentity: number;
  queuedFactReviews: number;
  staleReviews: number;
}

export async function runConsolidation(config: JoiConfig): Promise<ConsolidationReport> {
  console.log("[Consolidation] Starting nightly consolidation...");

  let merged = 0;
  let decayed = 0;
  let deleted = 0;
  let dedupedFacts = 0;
  let conflictingFacts = 0;
  let noisyFacts = 0;
  let cleanedLegacyIdentity = 0;
  let queuedFactReviews = 0;
  let staleReviews = 0;

  try {
    merged = await mergeDuplicates(config);
  } catch (err) {
    console.warn("[Consolidation] mergeDuplicates failed:", err);
  }

  try {
    decayed = await decayUnusedMemories();
  } catch (err) {
    console.warn("[Consolidation] decayUnusedMemories failed:", err);
  }

  try {
    deleted = await gcStaleMemories();
  } catch (err) {
    console.warn("[Consolidation] gcStaleMemories failed:", err);
  }

  try {
    const factsResult = await cleanFactsCollection();
    dedupedFacts = factsResult.deduped;
    conflictingFacts = factsResult.conflicting;
    noisyFacts = factsResult.noisyBackfill;
  } catch (err) {
    console.warn("[Consolidation] cleanFactsCollection failed:", err);
  }

  try {
    cleanedLegacyIdentity = await cleanLegacyIdentityMemories();
  } catch (err) {
    console.warn("[Consolidation] cleanLegacyIdentityMemories failed:", err);
  }

  try {
    queuedFactReviews = await enqueueMissingFactVerificationReviews(100);
  } catch (err) {
    console.warn("[Consolidation] enqueueMissingFactVerificationReviews failed:", err);
  }

  try {
    staleReviews = await cleanupStalePendingTriageReviews();
  } catch (err) {
    console.warn("[Consolidation] cleanupStalePendingTriageReviews failed:", err);
  }

  console.log(
    `[Consolidation] Done: ${merged} merged, ${decayed} decayed, ${deleted} deleted, ${dedupedFacts} deduped facts, ${conflictingFacts} conflicting facts outdated, ${noisyFacts} noisy backfill facts outdated, ${cleanedLegacyIdentity} legacy identity/preferences memories cleaned, ${queuedFactReviews} fact verification reviews queued, ${staleReviews} stale low-priority triage reviews cleaned`,
  );

  return {
    merged,
    decayed,
    deleted,
    dedupedFacts,
    conflictingFacts,
    noisyFacts,
    cleanedLegacyIdentity,
    queuedFactReviews,
    staleReviews,
  };
}

// ─── Merge Duplicates ────────────────────────────────────────────────

interface MemoryPair {
  id_a: string;
  id_b: string;
  content_a: string;
  content_b: string;
  confidence_a: number;
  confidence_b: number;
  similarity: number;
}

async function mergeDuplicates(config: JoiConfig): Promise<number> {
  let totalMerged = 0;

  for (const area of AREAS) {
    // Find pairs of active memories with cosine similarity > 0.9
    const pairs = await query<MemoryPair>(
      `SELECT
         a.id AS id_a, b.id AS id_b,
         a.content AS content_a, b.content AS content_b,
         a.confidence AS confidence_a, b.confidence AS confidence_b,
         1 - (a.embedding <=> b.embedding) AS similarity
       FROM memories a
       JOIN memories b ON a.id < b.id
       WHERE a.area = $1 AND b.area = $1
         AND a.superseded_by IS NULL AND b.superseded_by IS NULL
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND 1 - (a.embedding <=> b.embedding) > 0.9
       ORDER BY similarity DESC
       LIMIT 20`,
      [area],
    );

    const alreadyMerged = new Set<string>();

    for (const pair of pairs.rows) {
      // Skip if either side was already merged in this run
      if (alreadyMerged.has(pair.id_a) || alreadyMerged.has(pair.id_b)) continue;

      // Keep the higher-confidence memory, supersede the other
      const keepId = pair.confidence_a >= pair.confidence_b ? pair.id_a : pair.id_b;
      const removeId = keepId === pair.id_a ? pair.id_b : pair.id_a;
      const keepContent = keepId === pair.id_a ? pair.content_a : pair.content_b;
      const removeContent = keepId === pair.id_a ? pair.content_b : pair.content_a;

      // Check if both contain unique info worth merging
      if (keepContent !== removeContent && pair.similarity < 0.98) {
        try {
          const merged = await utilityCall(
            config,
            `Merge these two similar memory entries into one concise entry. Keep all unique information from both. Output only the merged text.`,
            `Entry 1: ${keepContent}\n\nEntry 2: ${removeContent}`,
            { maxTokens: 256 },
          );

          if (merged && merged.length > 10) {
            // Update the kept memory with merged content
            await query(
              `UPDATE memories SET content = $1, updated_at = NOW() WHERE id = $2`,
              [merged, keepId],
            );
          }
        } catch {
          // If merge fails, just supersede without merging content
        }
      }

      await supersedeMemory(removeId, keepId);
      alreadyMerged.add(removeId);
      totalMerged++;
    }
  }

  return totalMerged;
}

// ─── Decay Unused Memories ───────────────────────────────────────────

async function decayUnusedMemories(): Promise<number> {
  // Reduce confidence by 0.05 for non-pinned memories not accessed in 30+ days
  // Skip identity area (those are stable) and memories already at very low confidence
  const result = await query(
    `UPDATE memories SET
       confidence = GREATEST(0.05, confidence - 0.05),
       updated_at = NOW()
     WHERE pinned = false
       AND area != 'identity'
       AND superseded_by IS NULL
       AND confidence > 0.1
       AND last_accessed_at < NOW() - INTERVAL '30 days'`,
  );

  return result.rowCount ?? 0;
}

// ─── GC Stale Memories ──────────────────────────────────────────────

async function gcStaleMemories(): Promise<number> {
  // Delete only leaf rows in the supersede chain.
  // If another memory still points at a row via superseded_by, deleting it violates FK constraints.
  const superseded = await query(
    `DELETE FROM memories m
     WHERE m.confidence <= 0.05
       AND m.pinned = false
       AND m.superseded_by IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM memories child
         WHERE child.superseded_by = m.id
       )`,
  );

  const expired = await query(
    `DELETE FROM memories m
     WHERE m.expires_at IS NOT NULL
       AND m.expires_at < NOW()
       AND m.pinned = false
       AND NOT EXISTS (
         SELECT 1
         FROM memories child
         WHERE child.superseded_by = m.id
       )`,
  );

  return (superseded.rowCount ?? 0) + (expired.rowCount ?? 0);
}

// ─── Facts Cleanup ──────────────────────────────────────────────────

async function cleanFactsCollection(): Promise<{
  deduped: number;
  conflicting: number;
  noisyBackfill: number;
}> {
  const coll = await query<{ id: string }>(
    "SELECT id FROM store_collections WHERE name = 'Facts' LIMIT 1",
  );
  const collectionId = coll.rows[0]?.id;
  if (!collectionId) return { deduped: 0, conflicting: 0, noisyBackfill: 0 };

  // 1) Exact triple dedupe — keep best row, mark older duplicates outdated.
  const dedupe = await query(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY
             LOWER(BTRIM(COALESCE(data->>'subject',''))),
             LOWER(BTRIM(COALESCE(data->>'predicate',''))),
             LOWER(BTRIM(COALESCE(data->>'object','')))
           ORDER BY
             CASE WHEN COALESCE(data->>'status','unverified') = 'verified' THEN 1 ELSE 0 END DESC,
             COALESCE((data->>'confidence')::numeric, 0) DESC,
             updated_at DESC,
             created_at DESC
         ) AS rn
       FROM store_objects
       WHERE collection_id = $1
         AND status = 'active'
     )
     UPDATE store_objects o
     SET data = jsonb_set(COALESCE(o.data, '{}'::jsonb), '{status}', '"outdated"'::jsonb, true),
         status = 'archived',
         updated_at = NOW()
     FROM ranked r
     WHERE o.id = r.id
       AND r.rn > 1
       AND COALESCE(o.data->>'status', 'unverified') <> 'verified'`,
    [collectionId],
  );

  // 2) Conflict reduction for user identity facts.
  // Keep strongest "user is ..." as active, mark the rest outdated when still unverified.
  const conflicts = await query(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY
             LOWER(BTRIM(COALESCE(data->>'subject',''))),
             LOWER(BTRIM(COALESCE(data->>'predicate','')))
           ORDER BY
             COALESCE((data->>'confidence')::numeric, 0) DESC,
             updated_at DESC,
             created_at DESC
         ) AS rn
       FROM store_objects
       WHERE collection_id = $1
         AND status = 'active'
         AND LOWER(BTRIM(COALESCE(data->>'subject',''))) = 'user'
         AND LOWER(BTRIM(COALESCE(data->>'predicate',''))) = 'is'
         AND COALESCE(data->>'status', 'unverified') = 'unverified'
     )
     UPDATE store_objects o
     SET data = jsonb_set(COALESCE(o.data, '{}'::jsonb), '{status}', '"outdated"'::jsonb, true),
         status = 'archived',
         updated_at = NOW()
     FROM ranked r
     WHERE o.id = r.id
       AND r.rn > 1`,
    [collectionId],
  );

  // 3) Outdate noisy sentence-like backfilled facts.
  const noisy = await query(
    `UPDATE store_objects
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{status}', '"outdated"'::jsonb, true),
         status = 'archived',
         updated_at = NOW()
     WHERE collection_id = $1
       AND status = 'active'
       AND COALESCE(data->>'status', 'unverified') = 'unverified'
       AND COALESCE(data->>'source', '') = 'memory_backfill'
       AND (
         char_length(COALESCE(data->>'object', '')) > 140
         OR (
           LOWER(BTRIM(COALESCE(data->>'subject', ''))) = 'user'
           AND LOWER(BTRIM(COALESCE(data->>'predicate', ''))) IN ('is', 'prefers')
           AND char_length(BTRIM(COALESCE(data->>'object', ''))) > 32
         )
         OR LOWER(BTRIM(COALESCE(data->>'object', ''))) ~ '^(check|send|create|reply|review|update|fix|tasks?\\b)'
         OR LOWER(BTRIM(COALESCE(data->>'object', ''))) LIKE '%the user%'
         OR LOWER(BTRIM(COALESCE(data->>'object', ''))) LIKE 'user is %'
         OR LOWER(BTRIM(COALESCE(data->>'object', ''))) LIKE 'user values %'
         OR LOWER(BTRIM(COALESCE(data->>'object', ''))) IN (
           'girlfriends',
           'personal assistant',
           'tasks to do',
           'check my private account balance'
         )
       )`,
    [collectionId],
  );

  return {
    deduped: dedupe.rowCount ?? 0,
    conflicting: conflicts.rowCount ?? 0,
    noisyBackfill: noisy.rowCount ?? 0,
  };
}

async function cleanLegacyIdentityMemories(): Promise<number> {
  // Identity/preferences now live in Facts + Mem0 context.
  // Deactivate all inferred/non-user rows so these areas don't drift separately from Facts.
  const result = await query(
    `UPDATE memories
     SET expires_at = NOW() - INTERVAL '1 second',
         confidence = LEAST(confidence, 0.05),
         updated_at = NOW()
     WHERE superseded_by IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       AND pinned = false
       AND area IN ('identity', 'preferences')
       AND source <> 'user'`,
  );
  return result.rowCount ?? 0;
}

// ─── Review Queue Cleanup ───────────────────────────────────────────

async function cleanupStalePendingTriageReviews(): Promise<number> {
  // Keep actionable triage items for humans.
  // Auto-reject only low-signal notification noise (mostly social FYIs) once stale.
  const result = await query(
    `UPDATE review_queue
     SET status = 'rejected',
         resolution = jsonb_build_object('reason', 'auto_cleanup_low_signal_p0'),
         resolved_by = 'system:cleanup',
         resolved_at = NOW()
     WHERE type = 'triage'
       AND status = 'pending'
       AND priority = 0
       AND created_at < NOW() - INTERVAL '12 hours'
       AND (
         COALESCE(tags, ARRAY[]::text[]) && ARRAY['social', 'fyi', 'spam']::text[]
         OR LOWER(COALESCE(title, '')) ~ '(hinge|instagram|notification|new match|matched with|sent (a )?(photo|video)|received (a )?(photo|video)|liked your|reacted to)'
         OR LOWER(COALESCE(description, '')) ~ '(notification|new match|sent (a )?(photo|video)|received (a )?(photo|video)|liked your|reacted to|viewed your profile)'
         OR LOWER(COALESCE(content::text, '')) ~ '(hinge|instagram|notification|new match|sent (a )?(photo|video)|received (a )?(photo|video)|liked your|reacted to)'
       )`,
  );

  return result.rowCount ?? 0;
}
