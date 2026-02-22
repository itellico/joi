// Knowledge Store Auditor
// Checks for duplicates, schema drift, orphans, bloat, and data quality

import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";

interface AuditFinding {
  category: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: unknown;
}

export async function runAudit(ctx: ToolContext): Promise<{
  summary: { collections: number; objects: number; relations: number; archived: number };
  findings: AuditFinding[];
}> {
  const findings: AuditFinding[] = [];

  // ─── Summary stats ───

  const [collCount, objCount, relCount, archivedCount] = await Promise.all([
    query<{ count: number }>("SELECT count(*)::int AS count FROM store_collections"),
    query<{ count: number }>("SELECT count(*)::int AS count FROM store_objects WHERE status = 'active'"),
    query<{ count: number }>("SELECT count(*)::int AS count FROM store_relations"),
    query<{ count: number }>("SELECT count(*)::int AS count FROM store_objects WHERE status = 'archived'"),
  ]);

  const summary = {
    collections: collCount.rows[0].count,
    objects: objCount.rows[0].count,
    relations: relCount.rows[0].count,
    archived: archivedCount.rows[0].count,
  };

  if (summary.collections === 0) {
    findings.push({ category: "general", severity: "info", message: "No collections exist yet" });
    return { summary, findings };
  }

  // ─── 1. Duplicate detection (similar titles within same collection) ───

  const hasPgTrgm = await query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS exists",
  ).then((r) => Boolean(r.rows[0]?.exists)).catch(() => false);

  const duplicates = hasPgTrgm
    ? await query<{ collection_name: string; title1: string; title2: string; similarity: number }>(
      `SELECT c.name AS collection_name,
              a.title AS title1, b.title AS title2,
              similarity(a.title, b.title) AS similarity
       FROM store_objects a
       JOIN store_objects b ON a.collection_id = b.collection_id AND a.id < b.id
       JOIN store_collections c ON c.id = a.collection_id
       WHERE a.status = 'active' AND b.status = 'active'
         AND similarity(a.title, b.title) > 0.9
       ORDER BY similarity DESC
       LIMIT 20`,
    ).catch(() => ({ rows: [] as { collection_name: string; title1: string; title2: string; similarity: number }[] }))
    : await query<{ collection_name: string; title1: string; title2: string; similarity: number }>(
      `SELECT c.name AS collection_name,
              a.title AS title1,
              b.title AS title2,
              1.0 AS similarity
       FROM store_objects a
       JOIN store_objects b ON a.collection_id = b.collection_id AND a.id < b.id
       JOIN store_collections c ON c.id = a.collection_id
       WHERE a.status = 'active'
         AND b.status = 'active'
         AND LOWER(BTRIM(a.title)) = LOWER(BTRIM(b.title))
       ORDER BY a.updated_at DESC
       LIMIT 20`,
    ).catch(() => ({ rows: [] as { collection_name: string; title1: string; title2: string; similarity: number }[] }));

  for (const dup of duplicates.rows) {
    findings.push({
      category: "duplicates",
      severity: "warning",
      message: `Possible duplicate in "${dup.collection_name}": "${dup.title1}" ↔ "${dup.title2}" (${Math.round(dup.similarity * 100)}% similar)`,
    });
  }

  // ─── 2. Schema drift (objects with fields not in collection schema) ───

  const collections = await query<{ id: string; name: string; schema: Array<{ name: string; required?: boolean }> }>(
    "SELECT id, name, schema FROM store_collections",
  );

  for (const coll of collections.rows) {
    const schemaFields = new Set(coll.schema.map((f) => f.name));

    const objectFields = await query<{ keys: string[] }>(
      `SELECT array_agg(DISTINCT key) AS keys
       FROM store_objects, jsonb_object_keys(data) AS key
       WHERE collection_id = $1 AND status = 'active'`,
      [coll.id],
    );

    if (objectFields.rows[0]?.keys) {
      const extraFields = objectFields.rows[0].keys.filter((k) => !schemaFields.has(k));
      if (extraFields.length > 0) {
        findings.push({
          category: "schema_drift",
          severity: "warning",
          message: `Collection "${coll.name}" has objects with undeclared fields: ${extraFields.join(", ")}`,
          details: { collection: coll.name, extraFields },
        });
      }
    }
  }

  // ─── 3. Orphaned relations ───

  const orphans = await query<{ id: string; relation: string }>(
    `SELECT r.id, r.relation
     FROM store_relations r
     LEFT JOIN store_objects s ON s.id = r.source_id AND s.status = 'active'
     LEFT JOIN store_objects t ON t.id = r.target_id AND t.status = 'active'
     WHERE s.id IS NULL OR t.id IS NULL`,
  );

  if (orphans.rows.length > 0) {
    findings.push({
      category: "orphaned_relations",
      severity: "warning",
      message: `${orphans.rows.length} relation(s) point to archived/deleted objects`,
      details: { count: orphans.rows.length, relations: orphans.rows.slice(0, 5) },
    });
  }

  // ─── 4. Empty collections ───

  const emptyCols = await query<{ name: string }>(
    `SELECT c.name
     FROM store_collections c
     LEFT JOIN store_objects o ON o.collection_id = c.id AND o.status = 'active'
     GROUP BY c.id, c.name
     HAVING count(o.id) = 0`,
  );

  for (const col of emptyCols.rows) {
    findings.push({
      category: "empty_collections",
      severity: "info",
      message: `Collection "${col.name}" has no active objects`,
    });
  }

  // ─── 5. Bloat analysis ───

  const bloated = await query<{ name: string; count: number }>(
    `SELECT c.name, count(o.id)::int AS count
     FROM store_collections c
     JOIN store_objects o ON o.collection_id = c.id AND o.status = 'active'
     GROUP BY c.id, c.name
     HAVING count(o.id) > 100
     ORDER BY count DESC`,
  );

  for (const col of bloated.rows) {
    findings.push({
      category: "bloat",
      severity: "info",
      message: `Collection "${col.name}" has ${col.count} objects — consider archiving old ones`,
    });
  }

  // ─── 6. Embedding coverage ───

  const missingEmbeddings = await query<{ name: string; missing: number; total: number }>(
    `SELECT c.name,
            count(*) FILTER (WHERE o.embedding IS NULL)::int AS missing,
            count(*)::int AS total
     FROM store_objects o
     JOIN store_collections c ON c.id = o.collection_id
     WHERE o.status = 'active'
     GROUP BY c.id, c.name
     HAVING count(*) FILTER (WHERE o.embedding IS NULL) > 0`,
  );

  for (const col of missingEmbeddings.rows) {
    findings.push({
      category: "embeddings",
      severity: "warning",
      message: `Collection "${col.name}": ${col.missing}/${col.total} objects missing embeddings`,
    });
  }

  // ─── 7. Data quality (required fields empty) ───

  for (const coll of collections.rows) {
    const requiredFields = coll.schema.filter((f) => f.required).map((f) => f.name);
    if (requiredFields.length === 0) continue;

    for (const fieldName of requiredFields) {
      const empty = await query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM store_objects
         WHERE collection_id = $1 AND status = 'active'
           AND (data->>$2 IS NULL OR data->>$2 = '')`,
        [coll.id, fieldName],
      );

      if (empty.rows[0].count > 0) {
        findings.push({
          category: "data_quality",
          severity: "error",
          message: `Collection "${coll.name}": ${empty.rows[0].count} object(s) missing required field "${fieldName}"`,
        });
      }
    }
  }

  // Submit to review queue if actionable findings exist
  const actionable = findings.filter((f) => f.severity !== "info");
  if (actionable.length > 0) {
    await query(
      `INSERT INTO review_queue (agent_id, conversation_id, type, title, description, content, tags, priority)
       VALUES ($1, $2, 'verify', $3, $4, $5, $6, $7)`,
      [
        ctx.agentId,
        ctx.conversationId,
        `Store audit: ${actionable.length} issue(s) found`,
        `Knowledge store audit found ${actionable.length} actionable issue(s) across ${summary.collections} collections and ${summary.objects} objects.`,
        JSON.stringify([
          { type: "text", content: `**Summary**: ${summary.collections} collections, ${summary.objects} objects, ${summary.relations} relations` },
          { type: "json", content: JSON.stringify(actionable, null, 2), label: "Issues" },
        ]),
        ["optimization", "database"],
        actionable.some((f) => f.severity === "error") ? 2 : 1,
      ],
    );

    ctx.broadcast?.("review.created", {
      agentId: ctx.agentId,
      type: "verify",
      title: `Store audit: ${actionable.length} issue(s) found`,
      tags: ["optimization", "database"],
    });
  }

  return { summary, findings };
}
