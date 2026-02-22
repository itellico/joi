// Knowledge Store tools
// Flexible schema-less object database: collections, objects, relations
// Follows scout-tools.ts pattern

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";
import { embed } from "../knowledge/embeddings.js";
import { buildScopeFilterSql, normalizeScope, resolveAllowedScopes } from "../access/scope.js";
import { runAudit } from "./auditor.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

// ─── Helpers ───

const FIELD_TYPES = new Set([
  "text", "number", "date", "select", "multi_select",
  "checkbox", "url", "email", "relation", "json",
]);

function validateSchema(schema: unknown): string | null {
  if (!Array.isArray(schema)) return "schema must be an array of field definitions";
  for (const field of schema) {
    if (!field.name || typeof field.name !== "string") return `field missing name`;
    if (!field.type || !FIELD_TYPES.has(field.type)) return `invalid field type: ${field.type}`;
    if (field.type === "select" || field.type === "multi_select") {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        return `field "${field.name}" of type ${field.type} requires options array`;
      }
    }
  }
  return null;
}

function validateData(
  data: Record<string, unknown>,
  schema: Array<{ name: string; type: string; required?: boolean }>,
): string | null {
  for (const field of schema) {
    if (field.required && (data[field.name] === undefined || data[field.name] === null || data[field.name] === "")) {
      return `required field "${field.name}" is missing`;
    }
  }
  return null;
}

function buildEmbeddingText(title: string, data: Record<string, unknown>, tags: string[]): string {
  const dataText = Object.values(data)
    .filter((v) => typeof v === "string")
    .join(" ");
  return `${title} ${dataText} ${tags.join(" ")}`.trim();
}

async function auditLog(
  entityType: string,
  entityId: string,
  action: string,
  changes: unknown,
  performedBy: string,
  reviewId?: string,
): Promise<void> {
  await query(
    `INSERT INTO store_audit_log (entity_type, entity_id, action, changes, performed_by, review_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, changes ? JSON.stringify(changes) : null, performedBy, reviewId || null],
  );
}

// ─── Tool handlers ───

export function getStoreToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // ─── store_create_collection ───

  handlers.set("store_create_collection", async (input, ctx) => {
    const { name, description, icon, schema, config: collConfig } = input as {
      name: string;
      description?: string;
      icon?: string;
      schema: unknown;
      config?: Record<string, unknown>;
    };

    const schemaError = validateSchema(schema);
    if (schemaError) return { error: schemaError };

    // Create review request for human approval
    const reviewResult = await query<{ id: string }>(
      `INSERT INTO review_queue (agent_id, conversation_id, type, title, description, content, proposed_action, tags)
       VALUES ($1, $2, 'approve', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        ctx.agentId,
        ctx.conversationId,
        `New collection: ${name}`,
        `Create knowledge store collection "${name}" with ${(schema as unknown[]).length} fields`,
        JSON.stringify([
          { type: "text", content: description || `Collection: ${name}` },
          { type: "json", content: JSON.stringify({ schema, config: collConfig }, null, 2), label: "Schema" },
        ]),
        JSON.stringify({ name, description, icon, schema, config: collConfig }),
        ["database", "schema"],
      ],
    );

    ctx.broadcast?.("review.created", {
      id: reviewResult.rows[0].id,
      agentId: ctx.agentId,
      type: "approve",
      title: `New collection: ${name}`,
      tags: ["database", "schema"],
    });

    // Actually create the collection (can be used immediately, review is for oversight)
    const result = await query<{ id: string }>(
      `INSERT INTO store_collections (name, description, icon, schema, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, description || null, icon || null, JSON.stringify(schema), JSON.stringify(collConfig || {})],
    );

    await auditLog("collection", result.rows[0].id, "create", { name, schema }, `agent:${ctx.agentId}`, reviewResult.rows[0].id);

    return {
      id: result.rows[0].id,
      name,
      review_id: reviewResult.rows[0].id,
      message: `Collection "${name}" created. Review submitted for oversight.`,
    };
  });

  // ─── store_list_collections ───

  handlers.set("store_list_collections", async () => {
    const result = await query(
      `SELECT c.*, count(o.id)::int AS object_count
       FROM store_collections c
       LEFT JOIN store_objects o ON o.collection_id = c.id AND o.status = 'active'
       GROUP BY c.id
       ORDER BY c.name`,
    );
    return { collections: result.rows };
  });

  // ─── store_create_object ───

  handlers.set("store_create_object", async (input, ctx) => {
    const { collection, title, data, tags } = input as {
      collection: string;
      title: string;
      data: Record<string, unknown>;
      tags?: string[];
    };
    const scopedData = { ...data };
    if (scopedData.scope === undefined && ctx.scope && !ctx.allowGlobalDataAccess) {
      scopedData.scope = normalizeScope(ctx.scope);
    }

    // Find collection by name or ID
    const collResult = await query<{ id: string; schema: Array<{ name: string; type: string; required?: boolean }> }>(
      `SELECT id, schema FROM store_collections WHERE name = $1 OR id::text = $1`,
      [collection],
    );
    if (collResult.rows.length === 0) return { error: `Collection not found: ${collection}` };
    const coll = collResult.rows[0];

    // Validate data against schema
    const dataError = validateData(scopedData, coll.schema);
    if (dataError) return { error: dataError };

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await embed(buildEmbeddingText(title, scopedData, tags || []), ctx.config);
    } catch (err) {
      console.warn("[Store] Embedding failed, storing without:", err);
    }

    const result = await query<{ id: string; created_at: string }>(
      `INSERT INTO store_objects (collection_id, title, data, tags, embedding, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        coll.id,
        title,
        JSON.stringify(scopedData),
        tags || [],
        embedding ? `[${embedding.join(",")}]` : null,
        `agent:${ctx.agentId}`,
      ],
    );

    await auditLog("object", result.rows[0].id, "create", { title, data: scopedData }, `agent:${ctx.agentId}`);

    return {
      id: result.rows[0].id,
      title,
      collection,
      created_at: result.rows[0].created_at,
    };
  });

  // ─── store_query ───

  handlers.set("store_query", async (input, ctx) => {
    const {
      collection, filters, sort_by, sort_order, limit, offset, status, tags,
    } = input as {
      collection?: string;
      filters?: Record<string, unknown>;
      sort_by?: string;
      sort_order?: "asc" | "desc";
      limit?: number;
      offset?: number;
      status?: string;
      tags?: string[];
    };

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (collection) {
      conditions.push(`(c.name = $${idx} OR c.id::text = $${idx})`);
      params.push(collection);
      idx++;
    }

    conditions.push(`o.status = $${idx}`);
    params.push(status || "active");
    idx++;

    if (tags && tags.length > 0) {
      conditions.push(`o.tags @> $${idx}`);
      params.push(tags);
      idx++;
    }

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        conditions.push(`o.data->>$${idx} = $${idx + 1}`);
        params.push(key);
        params.push(String(value));
        idx += 2;
      }
    }

    const allowedScopes = resolveAllowedScopes({
      scope: ctx.scope,
      allowedScopes: ctx.allowedScopes,
      allowGlobalDataAccess: ctx.allowGlobalDataAccess,
    });
    if (allowedScopes) {
      conditions.push(buildScopeFilterSql("o.data->>'scope'", idx));
      params.push(allowedScopes);
      idx += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderCol = sort_by === "title" ? "o.title" : sort_by === "updated_at" ? "o.updated_at" : "o.created_at";
    const orderDir = sort_order === "asc" ? "ASC" : "DESC";
    const lim = Math.min(limit || 50, 200);
    const off = offset || 0;

    params.push(lim, off);

    const result = await query(
      `SELECT o.*, c.name AS collection_name, c.icon AS collection_icon
       FROM store_objects o
       JOIN store_collections c ON c.id = o.collection_id
       ${where}
       ORDER BY ${orderCol} ${orderDir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    // Get total count
    const countResult = await query(
      `SELECT count(*)::int AS total
       FROM store_objects o
       JOIN store_collections c ON c.id = o.collection_id
       ${where}`,
      params.slice(0, -2),
    );

    return {
      objects: result.rows,
      total: countResult.rows[0]?.total || 0,
      limit: lim,
      offset: off,
    };
  });

  // ─── store_update_object ───

  handlers.set("store_update_object", async (input, ctx) => {
    const { id, title, data, tags, status } = input as {
      id: string;
      title?: string;
      data?: Record<string, unknown>;
      tags?: string[];
      status?: string;
    };

    // Fetch current object
    const existing = await query<{
      id: string; title: string; data: Record<string, unknown>;
      tags: string[]; status: string; collection_id: string;
    }>(
      "SELECT id, title, data, tags, status, collection_id FROM store_objects WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) return { error: "Object not found" };
    const obj = existing.rows[0];

    // Validate data against schema if data is being updated
    if (data) {
      const collResult = await query<{ schema: Array<{ name: string; type: string; required?: boolean }> }>(
        "SELECT schema FROM store_collections WHERE id = $1",
        [obj.collection_id],
      );
      if (collResult.rows.length > 0) {
        const merged = { ...obj.data, ...data };
        const dataError = validateData(merged, collResult.rows[0].schema);
        if (dataError) return { error: dataError };
      }
    }

    const newTitle = title || obj.title;
    const newData = data ? { ...obj.data, ...data } : { ...obj.data };
    if (newData.scope === undefined && ctx.scope && !ctx.allowGlobalDataAccess) {
      newData.scope = normalizeScope(ctx.scope);
    }
    const newTags = tags || obj.tags;
    const newStatus = status || obj.status;

    // Re-embed
    let embedding: number[] | null = null;
    try {
      embedding = await embed(buildEmbeddingText(newTitle, newData, newTags), ctx.config);
    } catch {
      // keep old embedding
    }

    const updateFields: string[] = [
      "title = $2",
      "data = $3",
      "tags = $4",
      "status = $5",
    ];
    const updateParams: unknown[] = [id, newTitle, JSON.stringify(newData), newTags, newStatus];
    let pIdx = 6;

    if (embedding) {
      updateFields.push(`embedding = $${pIdx}`);
      updateParams.push(`[${embedding.join(",")}]`);
      pIdx++;
    }

    await query(
      `UPDATE store_objects SET ${updateFields.join(", ")} WHERE id = $1`,
      updateParams,
    );

    // Track changes
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (title && title !== obj.title) changes.title = { old: obj.title, new: title };
    if (data) changes.data = { old: obj.data, new: newData };
    if (tags) changes.tags = { old: obj.tags, new: tags };
    if (status && status !== obj.status) changes.status = { old: obj.status, new: status };

    await auditLog("object", id, "update", changes, `agent:${ctx.agentId}`);

    return { id, updated: true, changes: Object.keys(changes) };
  });

  // ─── store_delete_object ───

  handlers.set("store_delete_object", async (input, ctx) => {
    const { id, hard } = input as { id: string; hard?: boolean };

    if (hard) {
      await query("DELETE FROM store_objects WHERE id = $1", [id]);
      await auditLog("object", id, "delete", null, `agent:${ctx.agentId}`);
      return { id, deleted: true };
    }

    await query(
      "UPDATE store_objects SET status = 'archived' WHERE id = $1",
      [id],
    );
    await auditLog("object", id, "archive", null, `agent:${ctx.agentId}`);
    return { id, archived: true };
  });

  // ─── store_relate ───

  handlers.set("store_relate", async (input, ctx) => {
    const { source_id, target_id, relation, metadata } = input as {
      source_id: string;
      target_id: string;
      relation: string;
      metadata?: Record<string, unknown>;
    };

    // Verify both objects exist
    const check = await query(
      "SELECT id FROM store_objects WHERE id = ANY($1)",
      [[source_id, target_id]],
    );
    if (check.rows.length < 2) return { error: "One or both objects not found" };

    const result = await query<{ id: string }>(
      `INSERT INTO store_relations (source_id, target_id, relation, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_id, target_id, relation) DO UPDATE SET metadata = $4
       RETURNING id`,
      [source_id, target_id, relation, JSON.stringify(metadata || {})],
    );

    await auditLog("relation", result.rows[0].id, "create", { source_id, target_id, relation }, `agent:${ctx.agentId}`);

    return { id: result.rows[0].id, source_id, target_id, relation };
  });

  // ─── store_search ───

  handlers.set("store_search", async (input, ctx) => {
    const { query: searchQuery, collection, limit } = input as {
      query: string;
      collection?: string;
      limit?: number;
    };

    const maxResults = Math.min(limit || 20, 100);

    // Generate query embedding
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await embed(searchQuery, ctx.config);
    } catch {
      // fall back to FTS only
    }

    const conditions: string[] = ["o.status = 'active'"];
    const params: unknown[] = [];
    let idx = 1;

    if (collection) {
      conditions.push(`(c.name = $${idx} OR c.id::text = $${idx})`);
      params.push(collection);
      idx++;
    }

    const allowedScopes = resolveAllowedScopes({
      scope: ctx.scope,
      allowedScopes: ctx.allowedScopes,
      allowGlobalDataAccess: ctx.allowGlobalDataAccess,
    });
    if (allowedScopes) {
      conditions.push(buildScopeFilterSql("o.data->>'scope'", idx));
      params.push(allowedScopes);
      idx += 1;
    }

    let sql: string;
    if (queryEmbedding) {
      params.push(`[${queryEmbedding.join(",")}]`);
      const embIdx = idx++;
      params.push(searchQuery);
      const queryIdx = idx++;
      params.push(maxResults);
      const limIdx = idx++;

      sql = `
        SELECT o.id, o.title, o.data, o.tags, o.status, o.created_at, o.updated_at,
               c.name AS collection_name, c.icon AS collection_icon,
               CASE WHEN o.embedding IS NOT NULL
                 THEN 1 - (o.embedding <=> $${embIdx}::vector)
                 ELSE 0
               END AS vector_score,
               ts_rank(o.fts, websearch_to_tsquery('english', $${queryIdx})) AS text_score
        FROM store_objects o
        JOIN store_collections c ON c.id = o.collection_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          (CASE WHEN o.embedding IS NOT NULL
            THEN 1 - (o.embedding <=> $${embIdx}::vector)
            ELSE 0
          END) * 0.7 +
          ts_rank(o.fts, websearch_to_tsquery('english', $${queryIdx})) * 0.3
          DESC
        LIMIT $${limIdx}`;
    } else {
      params.push(searchQuery);
      const queryIdx = idx++;
      params.push(maxResults);
      const limIdx = idx++;

      sql = `
        SELECT o.id, o.title, o.data, o.tags, o.status, o.created_at, o.updated_at,
               c.name AS collection_name, c.icon AS collection_icon,
               0 AS vector_score,
               ts_rank(o.fts, websearch_to_tsquery('english', $${queryIdx})) AS text_score
        FROM store_objects o
        JOIN store_collections c ON c.id = o.collection_id
        WHERE ${conditions.join(" AND ")}
          AND o.fts @@ websearch_to_tsquery('english', $${queryIdx})
        ORDER BY text_score DESC
        LIMIT $${limIdx}`;
    }

    const result = await query(sql, params);

    return {
      results: result.rows.map((r) => ({
        ...r,
        score: Number(r.vector_score) * 0.7 + Number(r.text_score) * 0.3,
      })),
      total: result.rows.length,
      mode: queryEmbedding ? "hybrid" : "text_only",
    };
  });

  // ─── store_audit ───

  handlers.set("store_audit", async (_input, ctx) => {
    return await runAudit(ctx);
  });

  return handlers;
}

// ─── Tool definitions ───

export function getStoreToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "store_create_collection",
      description:
        "Create a new knowledge store collection with a typed schema. " +
        "Submits to review queue for oversight. " +
        "Supported field types: text, number, date, select, multi_select, checkbox, url, email, relation, json.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Unique collection name (e.g. 'OKRs', 'Facts', 'Contacts')",
          },
          description: {
            type: "string",
            description: "What this collection stores",
          },
          icon: {
            type: "string",
            description: "Emoji or icon name for the collection",
          },
          schema: {
            type: "array",
            description: "Field definitions: [{name, type, required?, options?, min?, max?, collection?}]",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: [...FIELD_TYPES] },
                required: { type: "boolean" },
                options: { type: "array", items: { type: "string" } },
                min: { type: "number" },
                max: { type: "number" },
                collection: { type: "string", description: "For relation type: target collection name" },
              },
              required: ["name", "type"],
            },
          },
          config: {
            type: "object",
            description: "Display settings (default_sort, view_mode, etc.)",
          },
        },
        required: ["name", "schema"],
      },
    },
    {
      name: "store_list_collections",
      description: "List all knowledge store collections with their schemas and object counts.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "store_create_object",
      description: "Create a new object in a knowledge store collection. Auto-embeds for semantic search.",
      input_schema: {
        type: "object" as const,
        properties: {
          collection: {
            type: "string",
            description: "Collection name or ID",
          },
          title: {
            type: "string",
            description: "Object title",
          },
          data: {
            type: "object",
            description: "Field values matching the collection schema",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for filtering",
          },
        },
        required: ["collection", "title", "data"],
      },
    },
    {
      name: "store_query",
      description:
        "Query objects with filters, sorting, and pagination. " +
        "Filter by collection, field values, tags, and status.",
      input_schema: {
        type: "object" as const,
        properties: {
          collection: {
            type: "string",
            description: "Filter by collection name or ID",
          },
          filters: {
            type: "object",
            description: "Field-value pairs to filter on (e.g. {status: 'on-track'})",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filter by tags (objects must have all specified tags)",
          },
          status: {
            type: "string",
            enum: ["active", "archived", "deleted"],
            description: "Object status filter (default: active)",
          },
          sort_by: {
            type: "string",
            enum: ["created_at", "updated_at", "title"],
            description: "Sort field (default: created_at)",
          },
          sort_order: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction (default: desc)",
          },
          limit: {
            type: "number",
            description: "Max results (default: 50, max: 200)",
          },
          offset: {
            type: "number",
            description: "Pagination offset",
          },
        },
        required: [],
      },
    },
    {
      name: "store_update_object",
      description: "Update an existing object's title, data fields, tags, or status. Merges data fields.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "Object UUID",
          },
          title: {
            type: "string",
            description: "New title",
          },
          data: {
            type: "object",
            description: "Fields to update (merged with existing data)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replace tags",
          },
          status: {
            type: "string",
            enum: ["active", "archived"],
            description: "Change status",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "store_delete_object",
      description: "Archive (soft-delete) or permanently delete an object.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "Object UUID",
          },
          hard: {
            type: "boolean",
            description: "If true, permanently delete instead of archiving (default: false)",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "store_relate",
      description:
        "Create a named relation between two objects (e.g. has_key_result, related_to, depends_on).",
      input_schema: {
        type: "object" as const,
        properties: {
          source_id: {
            type: "string",
            description: "Source object UUID",
          },
          target_id: {
            type: "string",
            description: "Target object UUID",
          },
          relation: {
            type: "string",
            description: "Relation type (e.g. 'has_key_result', 'related_to', 'depends_on', 'parent_of')",
          },
          metadata: {
            type: "object",
            description: "Optional metadata for the relation",
          },
        },
        required: ["source_id", "target_id", "relation"],
      },
    },
    {
      name: "store_search",
      description:
        "Semantic + full-text search across knowledge store objects. " +
        "Uses pgvector embeddings (nomic-embed-text) combined with PostgreSQL FTS.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (natural language)",
          },
          collection: {
            type: "string",
            description: "Optionally limit search to a specific collection",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20, max: 100)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "store_audit",
      description:
        "Run audit checks on the knowledge store: duplicate detection, schema drift, " +
        "orphaned relations, empty collections, embedding coverage, and data quality.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
