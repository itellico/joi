// Memory Writer: Insert, update, reinforce memories

import { query } from "../db/client.js";
import { embed } from "./embeddings.js";
import type { JoiConfig } from "../config/schema.js";
import type { Memory, MemoryWriteRequest } from "./types.js";

// Write a new memory with embedding
export async function writeMemory(
  req: MemoryWriteRequest,
  config: JoiConfig,
): Promise<Memory> {
  // Generate embedding
  let embedding: number[] | null = null;
  try {
    embedding = await embed(req.content, config);
  } catch (err) {
    console.warn("Failed to generate embedding, storing without vector:", err);
  }

  const result = await query<Memory>(
    `INSERT INTO memories (area, content, summary, tags, confidence, source,
       conversation_id, channel_id, project_id, scope, visibility, pinned, expires_at, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      req.area,
      req.content,
      req.summary || null,
      req.tags || [],
      req.confidence ?? 0.7,
      req.source,
      req.conversationId || null,
      req.channelId || null,
      req.projectId || null,
      req.scope || null,
      req.visibility || "shared",
      req.pinned || false,
      req.expiresAt || null,
      embedding ? `[${embedding.join(",")}]` : null,
    ],
  );

  return result.rows[0];
}

// Update an existing memory
export async function updateMemory(
  id: string,
  updates: Partial<Pick<MemoryWriteRequest, "content" | "summary" | "tags" | "confidence" | "pinned">>,
  config: JoiConfig,
): Promise<Memory | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.content !== undefined) {
    sets.push(`content = $${paramIndex++}`);
    values.push(updates.content);

    // Re-embed if content changed
    try {
      const embedding = await embed(updates.content, config);
      sets.push(`embedding = $${paramIndex++}`);
      values.push(`[${embedding.join(",")}]`);
    } catch {
      // Keep old embedding
    }
  }
  if (updates.summary !== undefined) {
    sets.push(`summary = $${paramIndex++}`);
    values.push(updates.summary);
  }
  if (updates.tags !== undefined) {
    sets.push(`tags = $${paramIndex++}`);
    values.push(updates.tags);
  }
  if (updates.confidence !== undefined) {
    sets.push(`confidence = $${paramIndex++}`);
    values.push(updates.confidence);
  }
  if (updates.pinned !== undefined) {
    sets.push(`pinned = $${paramIndex++}`);
    values.push(updates.pinned);
  }

  if (sets.length === 0) return null;

  sets.push("updated_at = NOW()");
  values.push(id);

  const result = await query<Memory>(
    `UPDATE memories SET ${sets.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );

  return result.rows[0] || null;
}

// Reinforce a memory (boost confidence on successful reuse)
export async function reinforceMemory(id: string): Promise<void> {
  await query(
    `UPDATE memories SET
       reinforcement_count = reinforcement_count + 1,
       access_count = access_count + 1,
       confidence = LEAST(1.0, confidence + 0.05),
       last_accessed_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
}

// Mark a memory as superseded by a newer one
export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  await query(
    `UPDATE memories SET superseded_by = $1, confidence = 0.0, updated_at = NOW() WHERE id = $2`,
    [newId, oldId],
  );
}

// Delete a memory
export async function deleteMemory(id: string): Promise<void> {
  await query("DELETE FROM memories WHERE id = $1", [id]);
}

// Get a single memory by ID
export async function getMemory(id: string): Promise<Memory | null> {
  const result = await query<Memory>(
    "SELECT * FROM memories WHERE id = $1",
    [id],
  );
  return result.rows[0] || null;
}

// List memories by area, with optional scope and tag filters
export async function listMemories(
  area?: string,
  limit = 50,
  options?: { scope?: string; tags?: string[]; visibility?: string },
): Promise<Memory[]> {
  // "Active" memories only: exclude superseded/expired and ultra-low-confidence leftovers.
  const conditions: string[] = [
    "superseded_by IS NULL",
    "(expires_at IS NULL OR expires_at > NOW())",
    "confidence > 0.05",
  ];
  const params: unknown[] = [];
  let idx = 1;

  if (area) {
    conditions.push(`area = $${idx++}`);
    params.push(area);
  } else {
    conditions.push(`area = ANY($${idx++}::text[])`);
    params.push(["knowledge", "solutions", "episodes"]);
  }

  // Scope filter: match specific scope OR include unscoped (global) rows
  if (options?.scope) {
    conditions.push(`(scope = $${idx} OR scope IS NULL)`);
    params.push(options.scope);
    idx++;
  }

  // Tag filter: memories must contain ALL specified tags
  if (options?.tags && options.tags.length > 0) {
    conditions.push(`tags @> $${idx++}::text[]`);
    params.push(options.tags);
  }

  // Visibility filter
  if (options?.visibility) {
    conditions.push(`visibility = $${idx++}`);
    params.push(options.visibility);
  }

  params.push(limit);

  const result = await query<Memory>(
    `SELECT * FROM memories
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${area ? "confidence DESC, " : ""}updated_at DESC
     LIMIT $${idx}`,
    params,
  );
  return result.rows;
}
