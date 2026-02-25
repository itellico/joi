import { createHash } from "node:crypto";
import { query, transaction } from "../db/client.js";

export interface SoulVersion {
  id: string;
  agent_id: string;
  content: string;
  content_hash: string;
  source: string;
  author: string;
  review_id: string | null;
  quality_run_id: string | null;
  quality_status: "not_run" | "passed" | "failed";
  change_summary: string | null;
  parent_version_id: string | null;
  is_active: boolean;
  activated_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateSoulVersionInput {
  agentId: string;
  content: string;
  source?: string;
  author?: string;
  reviewId?: string | null;
  qualityRunId?: string | null;
  qualityStatus?: "not_run" | "passed" | "failed";
  changeSummary?: string | null;
  parentVersionId?: string | null;
  metadata?: Record<string, unknown> | null;
  activate?: boolean;
}

function hashSoulContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isActiveVersionConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = typeof (err as { code?: unknown }).code === "string"
    ? String((err as { code?: string }).code)
    : "";
  const constraint = typeof (err as { constraint?: unknown }).constraint === "string"
    ? String((err as { constraint?: string }).constraint)
    : "";
  return code === "23505" && constraint === "idx_soul_versions_active_unique";
}

export async function getActiveSoulVersion(agentId: string): Promise<SoulVersion | null> {
  const result = await query<SoulVersion>(
    `SELECT * FROM soul_versions
     WHERE agent_id = $1 AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [agentId],
  );
  return result.rows[0] || null;
}

export async function getSoulVersionById(agentId: string, versionId: string): Promise<SoulVersion | null> {
  const result = await query<SoulVersion>(
    `SELECT * FROM soul_versions
     WHERE id = $1 AND agent_id = $2
     LIMIT 1`,
    [versionId, agentId],
  );
  return result.rows[0] || null;
}

export async function listSoulVersions(agentId: string, limit = 25): Promise<SoulVersion[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await query<SoulVersion>(
    `SELECT * FROM soul_versions
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, capped],
  );
  return result.rows;
}

export async function createSoulVersion(input: CreateSoulVersionInput): Promise<SoulVersion> {
  const activate = input.activate !== false;
  const contentHash = hashSoulContent(input.content);
  const source = (input.source || "manual").trim() || "manual";
  const author = (input.author || "system").trim() || "system";
  const qualityStatus = input.qualityStatus || (input.qualityRunId ? "passed" : "not_run");

  return transaction(async (client) => {
    // Serialize per-agent activation writes to prevent active-version unique collisions.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [input.agentId],
    );

    if (activate) {
      await client.query(
        `UPDATE soul_versions
         SET is_active = false
         WHERE agent_id = $1 AND is_active = true`,
        [input.agentId],
      );
    }

    const inserted = await client.query<SoulVersion>(
      `INSERT INTO soul_versions (
         agent_id, content, content_hash, source, author,
         review_id, quality_run_id, quality_status,
         change_summary, parent_version_id, is_active, activated_at, metadata
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11, $12, $13
       )
       RETURNING *`,
      [
        input.agentId,
        input.content,
        contentHash,
        source,
        author,
        input.reviewId || null,
        input.qualityRunId || null,
        qualityStatus,
        input.changeSummary || null,
        input.parentVersionId || null,
        activate,
        activate ? new Date().toISOString() : null,
        input.metadata ? JSON.stringify(input.metadata) : JSON.stringify({}),
      ],
    );

    return inserted.rows[0];
  });
}

export async function ensureSoulVersion(agentId: string, content: string): Promise<SoulVersion> {
  const active = await getActiveSoulVersion(agentId);
  const contentHash = hashSoulContent(content);
  if (active && active.content_hash === contentHash) {
    return active;
  }

  try {
    return await createSoulVersion({
      agentId,
      content,
      source: "bootstrap",
      author: "system",
      qualityStatus: "not_run",
      activate: true,
      metadata: { bootstrapped: true },
    });
  } catch (err) {
    if (!isActiveVersionConflict(err)) {
      throw err;
    }
    // Another concurrent request won the race; return the active row.
    const current = await getActiveSoulVersion(agentId);
    if (current) return current;
    throw err;
  }
}
