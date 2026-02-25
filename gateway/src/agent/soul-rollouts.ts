import { createHash } from "node:crypto";
import { query, transaction } from "../db/client.js";
import { writeAgentSoulDocument } from "./soul-documents.js";
import { SOUL_ROLLOUT_POLICY } from "./soul-policy.js";

export type SoulRolloutStatus = "canary_active" | "promoted" | "rolled_back" | "cancelled";

export interface SoulRollout {
  id: string;
  agent_id: string;
  candidate_version_id: string;
  baseline_version_id: string | null;
  status: SoulRolloutStatus;
  traffic_percent: number;
  minimum_sample_size: number;
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
  decision_reason: string | null;
  started_at: string;
  evaluated_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface SoulVersionSnapshot {
  id: string;
  agent_id: string;
  content: string;
  is_active: boolean;
  quality_status: "not_run" | "passed" | "failed";
  created_at: string;
}

interface SoulRolloutRow extends SoulRollout {
  candidate_content: string;
  baseline_content: string | null;
  candidate_is_active: boolean;
  baseline_is_active: boolean | null;
  candidate_quality_status: "not_run" | "passed" | "failed";
  baseline_quality_status: "not_run" | "passed" | "failed" | null;
}

interface CountPair {
  rejected: number;
  total: number;
}

interface QaRatePair {
  failed_cases: number;
  total_cases: number;
}

export interface SoulRolloutMetrics {
  generatedAt: string;
  rolloutAgeHours: number;
  sampleSize: number;
  candidateSamples: number;
  baselineSamples: number;
  observedCandidateShare: number;
  reviewRejectRate: {
    candidate: number;
    baseline: number;
    delta: number;
    candidateCounts: CountPair;
    baselineCounts: CountPair;
  };
  qaFailureRate: {
    candidate: number;
    baseline: number;
    delta: number;
    candidateCounts: QaRatePair;
    baselineCounts: QaRatePair;
  };
  highSeverityIncidents: number;
}

export interface SoulSelection {
  rolloutId: string | null;
  selectedVersionId: string | null;
  baselineVersionId: string | null;
  candidateVersionId: string | null;
  selectedContent: string;
  selectedTrack: "candidate" | "baseline" | "default";
  trafficPercent: number | null;
  bucket: number;
}

export interface StartSoulRolloutInput {
  agentId: string;
  candidateVersionId: string;
  baselineVersionId: string;
  trafficPercent?: number | null;
  minimumSampleSize?: number | null;
  metadata?: Record<string, unknown> | null;
  decisionReason?: string | null;
}

export interface SoulRolloutEvaluation {
  rollout: SoulRollout;
  metrics: SoulRolloutMetrics;
  decision: "promote" | "rollback" | "pending";
  applied: boolean;
  reason: string;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clampPercent(value: number | null | undefined): number {
  const fallback = SOUL_ROLLOUT_POLICY.canary.defaultTrafficPercent;
  if (!Number.isFinite(value as number)) return fallback;
  return Math.max(1, Math.min(100, Math.round(Number(value))));
}

function clampSampleSize(value: number | null | undefined): number {
  const fallback = SOUL_ROLLOUT_POLICY.canary.minimumSampleSize;
  if (!Number.isFinite(value as number)) return fallback;
  return Math.max(1, Math.round(Number(value)));
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function normalizeRolloutRow(row: SoulRollout): SoulRollout {
  return {
    ...row,
    metrics: toRecord(row.metrics),
    metadata: toRecord(row.metadata),
  };
}

function stableBucket(agentId: string, conversationId: string): number {
  const digest = createHash("sha256")
    .update(`${agentId}:${conversationId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

async function loadSoulVersion(agentId: string, versionId: string): Promise<SoulVersionSnapshot> {
  const result = await query<SoulVersionSnapshot>(
    `SELECT id, agent_id, content, is_active, quality_status, created_at
     FROM soul_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Soul version "${versionId}" not found.`);
  }
  if (row.agent_id !== agentId) {
    throw new Error(`Soul version "${versionId}" does not belong to agent "${agentId}".`);
  }
  return row;
}

async function loadRolloutRowById(rolloutId: string): Promise<SoulRolloutRow | null> {
  const result = await query<SoulRolloutRow>(
    `SELECT
       r.*,
       candidate.content AS candidate_content,
       baseline.content AS baseline_content,
       candidate.is_active AS candidate_is_active,
       baseline.is_active AS baseline_is_active,
       candidate.quality_status AS candidate_quality_status,
       baseline.quality_status AS baseline_quality_status
     FROM soul_rollouts r
     JOIN soul_versions candidate ON candidate.id = r.candidate_version_id
     LEFT JOIN soul_versions baseline ON baseline.id = r.baseline_version_id
     WHERE r.id = $1
     LIMIT 1`,
    [rolloutId],
  );
  return result.rows[0] || null;
}

async function loadActiveRolloutRowForAgent(agentId: string): Promise<SoulRolloutRow | null> {
  const result = await query<SoulRolloutRow>(
    `SELECT
       r.*,
       candidate.content AS candidate_content,
       baseline.content AS baseline_content,
       candidate.is_active AS candidate_is_active,
       baseline.is_active AS baseline_is_active,
       candidate.quality_status AS candidate_quality_status,
       baseline.quality_status AS baseline_quality_status
     FROM soul_rollouts r
     JOIN soul_versions candidate ON candidate.id = r.candidate_version_id
     LEFT JOIN soul_versions baseline ON baseline.id = r.baseline_version_id
     WHERE r.agent_id = $1
       AND r.status = 'canary_active'
     ORDER BY r.started_at DESC
     LIMIT 1`,
    [agentId],
  );
  return result.rows[0] || null;
}

async function updateRolloutMetrics(
  rolloutId: string,
  metrics: SoulRolloutMetrics,
  reason?: string | null,
): Promise<void> {
  await query(
    `UPDATE soul_rollouts
     SET metrics = $2::jsonb,
         evaluated_at = NOW(),
         decision_reason = COALESCE($3, decision_reason)
     WHERE id = $1`,
    [rolloutId, JSON.stringify(metrics), reason || null],
  );
}

async function readRejectRate(agentId: string, from: string, to?: string | null): Promise<CountPair> {
  const clauses = [
    "agent_id = $1",
    "type = 'soul_update'",
    "created_at >= $2",
  ];
  const params: unknown[] = [agentId, from];

  if (to) {
    clauses.push(`created_at < $${params.length + 1}`);
    params.push(to);
  }

  const result = await query<CountPair>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status IN ('approved', 'rejected', 'modified'))::int AS total
     FROM review_queue
     WHERE ${clauses.join(" AND ")}`,
    params,
  );

  return {
    rejected: Number(result.rows[0]?.rejected || 0),
    total: Number(result.rows[0]?.total || 0),
  };
}

async function readQaFailureRate(agentId: string, from: string, to?: string | null): Promise<QaRatePair> {
  const clauses = [
    "s.agent_id = $1",
    "r.started_at >= $2",
    "r.status IN ('completed', 'failed')",
  ];
  const params: unknown[] = [agentId, from];

  if (to) {
    clauses.push(`r.started_at < $${params.length + 1}`);
    params.push(to);
  }

  const result = await query<QaRatePair>(
    `SELECT
       COALESCE(SUM(r.failed + r.errored), 0)::int AS failed_cases,
       COALESCE(SUM(r.total_cases), 0)::int AS total_cases
     FROM qa_test_runs r
     JOIN qa_test_suites s ON s.id = r.suite_id
     WHERE ${clauses.join(" AND ")}`,
    params,
  );

  return {
    failed_cases: Number(result.rows[0]?.failed_cases || 0),
    total_cases: Number(result.rows[0]?.total_cases || 0),
  };
}

async function readHighSeverityIncidents(agentId: string, from: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM qa_issues i
     WHERE i.created_at >= $2
       AND i.severity IN ('critical', 'high')
       AND (
         i.tags @> ARRAY['soul']::text[]
         OR EXISTS (
           SELECT 1
           FROM qa_test_cases c
           JOIN qa_test_suites s ON s.id = c.suite_id
           WHERE c.id = i.test_case_id
             AND s.agent_id = $1
         )
       )`,
    [agentId, from],
  );
  return Number(result.rows[0]?.count || 0);
}

async function readConversationSampleCounts(
  agentId: string,
  rolloutId: string,
  candidateVersionId: string,
  baselineVersionId: string | null,
  from: string,
): Promise<{ sampleSize: number; candidateSamples: number; baselineSamples: number }> {
  const result = await query<{
    sample_size: number;
    candidate_samples: number;
    baseline_samples: number;
  }>(
    `SELECT
       COUNT(*)::int AS sample_size,
       COUNT(*) FILTER (
         WHERE metadata->'soul'->>'selectedVersionId' = $3
       )::int AS candidate_samples,
       COUNT(*) FILTER (
         WHERE metadata->'soul'->>'selectedVersionId' = COALESCE($4, '')
       )::int AS baseline_samples
     FROM conversations
     WHERE agent_id = $1
       AND created_at >= $5
       AND metadata->'soul'->>'rolloutId' = $2`,
    [agentId, rolloutId, candidateVersionId, baselineVersionId, from],
  );

  return {
    sampleSize: Number(result.rows[0]?.sample_size || 0),
    candidateSamples: Number(result.rows[0]?.candidate_samples || 0),
    baselineSamples: Number(result.rows[0]?.baseline_samples || 0),
  };
}

async function buildRolloutMetrics(rollout: SoulRolloutRow): Promise<SoulRolloutMetrics> {
  const now = new Date();
  const startedAt = new Date(rollout.started_at);
  const startedMs = startedAt.getTime();
  const nowMs = now.getTime();
  const ageMs = Math.max(0, nowMs - startedMs);
  const baselineStart = new Date(Math.max(0, startedMs - 30 * 24 * 60 * 60 * 1000)).toISOString();

  const [sampleCounts, candidateReject, baselineReject, candidateQa, baselineQa, highSeverityIncidents] = await Promise.all([
    readConversationSampleCounts(
      rollout.agent_id,
      rollout.id,
      rollout.candidate_version_id,
      rollout.baseline_version_id,
      rollout.started_at,
    ),
    readRejectRate(rollout.agent_id, rollout.started_at, null),
    readRejectRate(rollout.agent_id, baselineStart, rollout.started_at),
    readQaFailureRate(rollout.agent_id, rollout.started_at, null),
    readQaFailureRate(rollout.agent_id, baselineStart, rollout.started_at),
    readHighSeverityIncidents(rollout.agent_id, rollout.started_at),
  ]);

  const candidateRejectRate = toRate(candidateReject.rejected, candidateReject.total);
  const baselineRejectRate = toRate(baselineReject.rejected, baselineReject.total);
  const candidateQaFailureRate = toRate(candidateQa.failed_cases, candidateQa.total_cases);
  const baselineQaFailureRate = toRate(baselineQa.failed_cases, baselineQa.total_cases);

  return {
    generatedAt: now.toISOString(),
    rolloutAgeHours: Number((ageMs / (1000 * 60 * 60)).toFixed(3)),
    sampleSize: sampleCounts.sampleSize,
    candidateSamples: sampleCounts.candidateSamples,
    baselineSamples: sampleCounts.baselineSamples,
    observedCandidateShare: toRate(sampleCounts.candidateSamples, sampleCounts.sampleSize),
    reviewRejectRate: {
      candidate: candidateRejectRate,
      baseline: baselineRejectRate,
      delta: candidateRejectRate - baselineRejectRate,
      candidateCounts: candidateReject,
      baselineCounts: baselineReject,
    },
    qaFailureRate: {
      candidate: candidateQaFailureRate,
      baseline: baselineQaFailureRate,
      delta: candidateQaFailureRate - baselineQaFailureRate,
      candidateCounts: candidateQa,
      baselineCounts: baselineQa,
    },
    highSeverityIncidents,
  };
}

function decideRolloutAction(
  rollout: SoulRolloutRow,
  metrics: SoulRolloutMetrics,
): { decision: "promote" | "rollback" | "pending"; reason: string } {
  const rollbackPolicy = SOUL_ROLLOUT_POLICY.rollback.thresholdTriggers;
  const promotePolicy = SOUL_ROLLOUT_POLICY.canary.promotionCriteria;

  if (metrics.highSeverityIncidents >= rollbackPolicy.highSeverityIncidents) {
    return {
      decision: "rollback",
      reason: `Rollback: high severity incidents ${metrics.highSeverityIncidents} reached threshold ${rollbackPolicy.highSeverityIncidents}.`,
    };
  }

  if (metrics.reviewRejectRate.delta >= rollbackPolicy.reviewRejectRateDelta) {
    return {
      decision: "rollback",
      reason: `Rollback: review reject rate delta ${metrics.reviewRejectRate.delta.toFixed(3)} exceeded ${rollbackPolicy.reviewRejectRateDelta}.`,
    };
  }

  if (metrics.qaFailureRate.delta >= rollbackPolicy.qaFailureRateDelta) {
    return {
      decision: "rollback",
      reason: `Rollback: QA failure rate delta ${metrics.qaFailureRate.delta.toFixed(3)} exceeded ${rollbackPolicy.qaFailureRateDelta}.`,
    };
  }

  if (metrics.sampleSize < rollout.minimum_sample_size) {
    return {
      decision: "pending",
      reason: `Pending: sample size ${metrics.sampleSize}/${rollout.minimum_sample_size}.`,
    };
  }

  const qualifiesForPromotion =
    metrics.reviewRejectRate.delta <= promotePolicy.maxReviewRejectRateDelta
    && metrics.qaFailureRate.delta <= promotePolicy.maxQaFailureRateDelta
    && metrics.highSeverityIncidents <= promotePolicy.maxHighSeverityIncidents;

  if (qualifiesForPromotion) {
    return {
      decision: "promote",
      reason: "Promotion criteria satisfied.",
    };
  }

  return {
    decision: "pending",
    reason: "Pending: waiting for stronger signal.",
  };
}

export async function listSoulRollouts(params?: {
  agentId?: string | null;
  status?: SoulRolloutStatus | "all" | null;
  limit?: number;
}): Promise<SoulRollout[]> {
  const filters: string[] = [];
  const values: unknown[] = [];

  if (params?.agentId) {
    values.push(params.agentId);
    filters.push(`agent_id = $${values.length}`);
  }

  if (params?.status && params.status !== "all") {
    values.push(params.status);
    filters.push(`status = $${values.length}`);
  }

  const limit = Math.max(1, Math.min(200, Math.floor(params?.limit ?? 50)));
  values.push(limit);

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await query<SoulRollout>(
    `SELECT *
     FROM soul_rollouts
     ${where}
     ORDER BY started_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(normalizeRolloutRow);
}

export async function getSoulRollout(rolloutId: string): Promise<SoulRollout | null> {
  const row = await loadRolloutRowById(rolloutId);
  if (!row) return null;
  return normalizeRolloutRow(row);
}

export async function getActiveSoulRolloutForAgent(agentId: string): Promise<SoulRollout | null> {
  const row = await loadActiveRolloutRowForAgent(agentId);
  if (!row) return null;
  return normalizeRolloutRow(row);
}

export async function startSoulRollout(input: StartSoulRolloutInput): Promise<SoulRollout> {
  const trafficPercent = clampPercent(input.trafficPercent);
  const minimumSampleSize = clampSampleSize(input.minimumSampleSize);

  const candidate = await loadSoulVersion(input.agentId, input.candidateVersionId);
  const baseline = await loadSoulVersion(input.agentId, input.baselineVersionId);

  if (candidate.id === baseline.id) {
    throw new Error("Candidate and baseline versions must be different.");
  }

  const inserted = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.agentId]);

    await client.query(
      `UPDATE soul_rollouts
       SET status = 'cancelled',
           ended_at = NOW(),
           evaluated_at = NOW(),
           decision_reason = COALESCE(decision_reason, 'Superseded by new rollout')
       WHERE agent_id = $1
         AND status = 'canary_active'`,
      [input.agentId],
    );

    const result = await client.query<SoulRollout>(
      `INSERT INTO soul_rollouts (
         agent_id,
         candidate_version_id,
         baseline_version_id,
         status,
         traffic_percent,
         minimum_sample_size,
         metrics,
         metadata,
         decision_reason
       ) VALUES (
         $1, $2, $3, 'canary_active',
         $4, $5, $6::jsonb, $7::jsonb, $8
       )
       RETURNING *`,
      [
        input.agentId,
        candidate.id,
        baseline.id,
        trafficPercent,
        minimumSampleSize,
        JSON.stringify({}),
        JSON.stringify(input.metadata || {}),
        input.decisionReason || null,
      ],
    );
    return result.rows[0];
  });

  return normalizeRolloutRow(inserted);
}

export async function cancelActiveSoulRolloutForAgent(
  agentId: string,
  reason = "Cancelled by manual override",
): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE soul_rollouts
     SET status = 'cancelled',
         ended_at = NOW(),
         evaluated_at = NOW(),
         decision_reason = $2
     WHERE agent_id = $1
       AND status = 'canary_active'
     RETURNING id`,
    [agentId, reason],
  );
  return result.rowCount || 0;
}

export async function promoteSoulRollout(rolloutId: string, reason: string): Promise<SoulRollout> {
  const updated = await transaction(async (client) => {
    const rolloutResult = await client.query<SoulRolloutRow>(
      `SELECT
         r.*,
         candidate.content AS candidate_content,
         baseline.content AS baseline_content,
         candidate.is_active AS candidate_is_active,
         baseline.is_active AS baseline_is_active,
         candidate.quality_status AS candidate_quality_status,
         baseline.quality_status AS baseline_quality_status
       FROM soul_rollouts r
       JOIN soul_versions candidate ON candidate.id = r.candidate_version_id
       LEFT JOIN soul_versions baseline ON baseline.id = r.baseline_version_id
       WHERE r.id = $1
       FOR UPDATE`,
      [rolloutId],
    );
    const row = rolloutResult.rows[0];
    if (!row) throw new Error(`Soul rollout "${rolloutId}" not found.`);
    if (row.status !== "canary_active") {
      throw new Error(`Soul rollout "${rolloutId}" is not active (status=${row.status}).`);
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.agent_id]);

    await client.query(
      `UPDATE soul_versions
       SET is_active = false
       WHERE agent_id = $1
         AND is_active = true`,
      [row.agent_id],
    );

    await client.query(
      `UPDATE soul_versions
       SET is_active = true,
           activated_at = NOW()
       WHERE id = $1`,
      [row.candidate_version_id],
    );

    const rolloutUpdate = await client.query<SoulRollout>(
      `UPDATE soul_rollouts
       SET status = 'promoted',
           ended_at = NOW(),
           evaluated_at = NOW(),
           decision_reason = $2
       WHERE id = $1
       RETURNING *`,
      [rolloutId, reason],
    );

    writeAgentSoulDocument(row.agent_id, row.candidate_content);
    return rolloutUpdate.rows[0];
  });

  return normalizeRolloutRow(updated);
}

export async function rollbackSoulRollout(rolloutId: string, reason: string): Promise<SoulRollout> {
  const updated = await transaction(async (client) => {
    const rolloutResult = await client.query<SoulRolloutRow>(
      `SELECT
         r.*,
         candidate.content AS candidate_content,
         baseline.content AS baseline_content,
         candidate.is_active AS candidate_is_active,
         baseline.is_active AS baseline_is_active,
         candidate.quality_status AS candidate_quality_status,
         baseline.quality_status AS baseline_quality_status
       FROM soul_rollouts r
       JOIN soul_versions candidate ON candidate.id = r.candidate_version_id
       LEFT JOIN soul_versions baseline ON baseline.id = r.baseline_version_id
       WHERE r.id = $1
       FOR UPDATE`,
      [rolloutId],
    );
    const row = rolloutResult.rows[0];
    if (!row) throw new Error(`Soul rollout "${rolloutId}" not found.`);
    if (row.status !== "canary_active") {
      throw new Error(`Soul rollout "${rolloutId}" is not active (status=${row.status}).`);
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.agent_id]);

    await client.query(
      `UPDATE soul_versions
       SET is_active = false
       WHERE agent_id = $1
         AND is_active = true`,
      [row.agent_id],
    );

    if (row.baseline_version_id) {
      await client.query(
        `UPDATE soul_versions
         SET is_active = true,
             activated_at = NOW()
         WHERE id = $1`,
        [row.baseline_version_id],
      );
    }

    const rolloutUpdate = await client.query<SoulRollout>(
      `UPDATE soul_rollouts
       SET status = 'rolled_back',
           ended_at = NOW(),
           evaluated_at = NOW(),
           decision_reason = $2
       WHERE id = $1
       RETURNING *`,
      [rolloutId, reason],
    );

    if (row.baseline_content) {
      writeAgentSoulDocument(row.agent_id, row.baseline_content);
    }
    return rolloutUpdate.rows[0];
  });

  return normalizeRolloutRow(updated);
}

export async function evaluateSoulRollout(
  rolloutId: string,
  options?: { applyDecision?: boolean },
): Promise<SoulRolloutEvaluation> {
  const rollout = await loadRolloutRowById(rolloutId);
  if (!rollout) {
    throw new Error(`Soul rollout "${rolloutId}" not found.`);
  }

  const metrics = await buildRolloutMetrics(rollout);
  const { decision, reason } = decideRolloutAction(rollout, metrics);
  const applyDecision = options?.applyDecision !== false;

  await updateRolloutMetrics(rolloutId, metrics, decision === "pending" ? reason : null);

  let applied = false;
  if (applyDecision) {
    if (decision === "promote") {
      await promoteSoulRollout(rolloutId, reason);
      applied = true;
    } else if (decision === "rollback") {
      await rollbackSoulRollout(rolloutId, reason);
      applied = true;
    }
  }

  const refreshed = await getSoulRollout(rolloutId);
  if (!refreshed) {
    throw new Error(`Soul rollout "${rolloutId}" could not be reloaded after evaluation.`);
  }

  return {
    rollout: refreshed,
    metrics,
    decision,
    applied,
    reason,
  };
}

export async function evaluateAllActiveSoulRollouts(
  options?: { applyDecision?: boolean; limit?: number },
): Promise<SoulRolloutEvaluation[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const activeRollouts = await listSoulRollouts({ status: "canary_active", limit });
  const evaluations: SoulRolloutEvaluation[] = [];

  for (const rollout of activeRollouts) {
    evaluations.push(await evaluateSoulRollout(rollout.id, options));
  }

  return evaluations;
}

export async function chooseSoulForConversation(params: {
  agentId: string;
  conversationId: string;
  fallbackContent: string;
}): Promise<SoulSelection> {
  const bucket = stableBucket(params.agentId, params.conversationId);
  const rollout = await loadActiveRolloutRowForAgent(params.agentId);

  if (!rollout) {
    return {
      rolloutId: null,
      selectedVersionId: null,
      baselineVersionId: null,
      candidateVersionId: null,
      selectedContent: params.fallbackContent,
      selectedTrack: "default",
      trafficPercent: null,
      bucket,
    };
  }

  const useCandidate = bucket < rollout.traffic_percent;
  const selectedTrack = useCandidate ? "candidate" : "baseline";
  const selectedContent = useCandidate
    ? rollout.candidate_content
    : (rollout.baseline_content || params.fallbackContent);

  return {
    rolloutId: rollout.id,
    selectedVersionId: useCandidate
      ? rollout.candidate_version_id
      : (rollout.baseline_version_id || null),
    baselineVersionId: rollout.baseline_version_id,
    candidateVersionId: rollout.candidate_version_id,
    selectedContent,
    selectedTrack,
    trafficPercent: rollout.traffic_percent,
    bucket,
  };
}

export async function persistConversationSoulSelection(
  conversationId: string,
  selection: SoulSelection,
): Promise<void> {
  await query(
    `UPDATE conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('soul', $2::jsonb),
         updated_at = NOW()
     WHERE id = $1`,
    [
      conversationId,
      JSON.stringify({
        rolloutId: selection.rolloutId,
        selectedVersionId: selection.selectedVersionId,
        baselineVersionId: selection.baselineVersionId,
        candidateVersionId: selection.candidateVersionId,
        selectedTrack: selection.selectedTrack,
        trafficPercent: selection.trafficPercent,
        bucket: selection.bucket,
        updatedAt: new Date().toISOString(),
      }),
    ],
  );
}

export async function getSoulGovernanceSummary(): Promise<Record<string, unknown>> {
  const [statusCountsResult, activeAgesResult, agentCoverageResult, openIssuesResult, recentResult] = await Promise.all([
    query<{ status: SoulRolloutStatus; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM soul_rollouts
       WHERE started_at >= NOW() - INTERVAL '30 days'
       GROUP BY status`,
    ),
    query<{ over_due: number; active: number }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'canary_active'
             AND started_at < NOW() - ($1 || ' hours')::interval
         )::int AS over_due,
         COUNT(*) FILTER (WHERE status = 'canary_active')::int AS active
       FROM soul_rollouts`,
      [SOUL_ROLLOUT_POLICY.canary.defaultDurationHours],
    ),
    query<{ total_agents: number; covered_agents: number; qa_covered_agents: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM agents WHERE enabled = true) AS total_agents,
         (
           SELECT COUNT(*)::int
           FROM agents a
           WHERE a.enabled = true
             AND EXISTS (
               SELECT 1
               FROM soul_versions v
               WHERE v.agent_id = a.id
             )
         ) AS covered_agents,
         (
           SELECT COUNT(*)::int
           FROM agents a
           WHERE a.enabled = true
             AND EXISTS (
               SELECT 1
               FROM qa_test_suites s
               WHERE s.agent_id = a.id
                 AND s.enabled = true
             )
         ) AS qa_covered_agents`,
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM qa_issues
       WHERE status IN ('open', 'investigating', 'autodev_assigned')
         AND tags @> ARRAY['soul']::text[]`,
    ),
    query<{
      id: string;
      agent_id: string;
      status: SoulRolloutStatus;
      traffic_percent: number;
      started_at: string;
      ended_at: string | null;
      decision_reason: string | null;
      candidate_version_id: string;
      baseline_version_id: string | null;
    }>(
      `SELECT id, agent_id, status, traffic_percent, started_at, ended_at, decision_reason,
              candidate_version_id, baseline_version_id
       FROM soul_rollouts
       ORDER BY started_at DESC
       LIMIT 12`,
    ),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of statusCountsResult.rows) {
    statusCounts[row.status] = Number(row.count || 0);
  }

  const coverage = agentCoverageResult.rows[0] || {
    total_agents: 0,
    covered_agents: 0,
    qa_covered_agents: 0,
  };
  const totalAgents = Number(coverage.total_agents || 0);
  const coveredAgents = Number(coverage.covered_agents || 0);
  const qaCoveredAgents = Number(coverage.qa_covered_agents || 0);

  return {
    generatedAt: new Date().toISOString(),
    policyVersion: SOUL_ROLLOUT_POLICY.version,
    statusCounts,
    active: Number(activeAgesResult.rows[0]?.active || 0),
    overdueActive: Number(activeAgesResult.rows[0]?.over_due || 0),
    coverage: {
      totalAgents,
      soulCoverage: coveredAgents,
      qaCoverage: qaCoveredAgents,
      soulCoverageRate: totalAgents > 0 ? coveredAgents / totalAgents : 0,
      qaCoverageRate: totalAgents > 0 ? qaCoveredAgents / totalAgents : 0,
    },
    openSoulIssues: Number(openIssuesResult.rows[0]?.count || 0),
    recentRollouts: recentResult.rows,
  };
}
