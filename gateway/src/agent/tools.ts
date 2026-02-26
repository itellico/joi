import type Anthropic from "@anthropic-ai/sdk";
import type { JoiConfig } from "../config/schema.js";
import type { AgentExecutionMode } from "./execution-mode.js";
import { query } from "../db/client.js";
import { searchMemories } from "../knowledge/searcher.js";
import {
  writeMemory,
  updateMemory,
  deleteMemory,
  reinforceMemory,
} from "../knowledge/writer.js";
import {
  isMem0Enabled,
  searchMem0,
  storeMemoryInMem0,
  updateMem0Memory,
  deleteMem0Memory,
  setMem0MemoryPinned,
} from "../knowledge/mem0-engine.js";
import type { MemoryArea, MemorySource } from "../knowledge/types.js";
import { embed } from "../knowledge/embeddings.js";
import { createJob, listJobs, deleteJob, toggleJob } from "../cron/scheduler.js";
import { queryLogs } from "../logging.js";
import { buildScopeFilterSql, resolveAllowedScopes } from "../access/scope.js";
import { getAccountingToolHandlers, getAccountingToolDefinitions } from "../accounting/tools.js";
import { getCalendarToolHandlers, getCalendarToolDefinitions } from "../google/calendar-tools.js";
import { getGmailToolHandlers, getGmailToolDefinitions } from "../google/gmail-tools.js";
import { getChannelToolHandlers, getChannelToolDefinitions } from "../channels/tools.js";
import { getThingsToolHandlers, getThingsToolDefinitions } from "../things/tools.js";
import { getObsidianToolHandlers, getObsidianToolDefinitions } from "../knowledge/obsidian-tools.js";
import { getOutlineToolHandlers, getOutlineToolDefinitions } from "../sync/outline-tools.js";
import { getNotionToolHandlers, getNotionToolDefinitions } from "../sync/notion-tools.js";
import { getContactsToolHandlers, getContactsToolDefinitions } from "../apple/contacts-tools.js";
import { searchContacts } from "../apple/contacts.js";
import { getYouTubeToolHandlers, getYouTubeToolDefinitions } from "../youtube/tools.js";
import { getSkillScoutToolHandlers, getSkillScoutToolDefinitions } from "../skills/scout-tools.js";
import { getKnowledgeSyncToolHandlers, getKnowledgeSyncToolDefinitions } from "../knowledge/sync-tools.js";
import { getStoreToolHandlers, getStoreToolDefinitions } from "../store/tools.js";
import { getOKRToolHandlers, getOKRToolDefinitions } from "../okr/tools.js";
import { getSSHToolHandlers, getSSHToolDefinitions } from "../ssh/tools.js";
import { getAvatarToolHandlers, getAvatarToolDefinitions } from "../social/avatar-tools.js";
import {
  getMediaIntegrationToolHandlers,
  getMediaIntegrationToolDefinitions,
} from "../media/integration-tools.js";
import { getQuotesToolHandlers, getQuotesToolDefinitions } from "../quotes/tools.js";
import { readFileSync } from "node:fs";
import { resolveSkillPathByName } from "../skills/catalog.js";
import { runClaudeCode } from "./claude-code.js";
import { updateHeartbeat, createTask, updateTask, listTasks } from "./heartbeat.js";

export interface ToolContext {
  config: JoiConfig;
  conversationId: string;
  agentId: string;
  executionMode?: AgentExecutionMode;
  agentConfig?: Record<string, unknown>;
  scope?: string;
  scopeMetadata?: Record<string, unknown>;
  allowedScopes?: string[] | null;
  allowGlobalDataAccess?: boolean;
  companyId?: string;
  contactId?: string;
  depth?: number;
  maxDepth?: number;
  spawnAgent?: (opts: {
    agentId: string;
    message: string;
    parentConversationId?: string;
  }) => Promise<{ content: string; model: string; usage: { inputTokens: number; outputTokens: number } }>;
  broadcast?: (type: string, data: unknown) => void;
}

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const toolRegistry = new Map<string, ToolHandler>();
const TOOL_CLAUDE_TIMEOUT_MS = readTimeoutFromEnv("JOI_TOOL_CLAUDE_TIMEOUT_MS", 20 * 60 * 1000);

function readTimeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

// ─── Contact enrichment: auto-update contact records when identity memories mention people ───

const RELATIONSHIP_PATTERNS = [
  /^(\w+)\s+is\s+(?:my|your|Marcus's)\s+(.+)$/i,
  /^(?:my|your|Marcus's)\s+(.+?)\s+is\s+(\w+)$/i,
  /^(\w+)\s+(?:works?\s+(?:at|for)|is\s+(?:a|an|the)\s+\w+\s+at)\s+(.+)$/i,
];

async function enrichContactFromMemory(content: string, memoryId: string): Promise<void> {
  try {
    // Try to extract a name and relationship from the memory content
    let name: string | null = null;
    let fact: Record<string, string> = {};

    for (const pattern of RELATIONSHIP_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        // First pattern: "Moritz is my son" → name=Moritz, relationship=son
        // Third pattern: "Moritz works at Google" → name=Moritz, works_at=Google
        if (pattern === RELATIONSHIP_PATTERNS[0]) {
          name = match[1];
          fact = { relationship: match[2].trim().replace(/\.+$/, "") };
        } else if (pattern === RELATIONSHIP_PATTERNS[1]) {
          // "my son is Moritz"
          name = match[2];
          fact = { relationship: match[1].trim().replace(/\.+$/, "") };
        } else {
          name = match[1];
          fact = { works_at: match[2].trim().replace(/\.+$/, "") };
        }
        break;
      }
    }

    if (!name || Object.keys(fact).length === 0) return;

    // Search for a matching contact
    const contacts = await searchContacts(name);
    if (contacts.length === 0) return;

    // Use the first match (most relevant)
    const contact = contacts[0];
    const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

    // Only proceed if the contact name actually contains the mentioned name
    if (!contactName.toLowerCase().includes(name.toLowerCase())) return;

    // Look up the DB contact by apple_id or name
    const dbResult = await query<{ id: string }>(
      `SELECT id FROM contacts
       WHERE apple_id = $1
          OR (LOWER(first_name) = LOWER($2) AND ($3 IS NULL OR LOWER(last_name) = LOWER($3)))
       LIMIT 1`,
      [contact.id, contact.firstName, contact.lastName || null],
    );

    if (dbResult.rows.length === 0) return;

    const contactId = dbResult.rows[0].id;
    const enrichData = { ...fact, source: "memory", memory_id: memoryId, updated_at: new Date().toISOString() };

    await query(
      `UPDATE contacts SET extra = COALESCE(extra, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(enrichData), contactId],
    );
  } catch {
    // Enrichment is best-effort, never fail the memory operation
  }
}

// ─── memory_search: Unified hybrid search across memories + documents ───

toolRegistry.set("memory_search", async (input, ctx) => {
  const { query: searchQuery, areas, limit, scope, tags, visibility } = input as {
    query: string;
    areas?: string[];
    limit?: number;
    scope?: string;
    tags?: string[];
    visibility?: string;
  };

  // Resolve effective scope: explicit param > context scope > null (all)
  const effectiveScope = scope || (ctx.allowGlobalDataAccess ? undefined : ctx.scope) || undefined;

  if (isMem0Enabled(ctx.config)) {
    const allowedScopes = resolveAllowedScopes({
      scope: ctx.scope,
      allowedScopes: ctx.allowedScopes,
      allowGlobalDataAccess: ctx.allowGlobalDataAccess,
    });
    const tenantScope = ctx.allowGlobalDataAccess ? undefined : (effectiveScope || allowedScopes?.[0]);
    const hits = await searchMem0(
      ctx.config,
      searchQuery,
      {
        areas: areas as MemoryArea[] | undefined,
        limit: limit || 10,
        agentId: ctx.agentId,
        runId: ctx.conversationId,
        tenantScope,
        companyId: ctx.allowGlobalDataAccess ? undefined : ctx.companyId,
        contactId: ctx.allowGlobalDataAccess ? undefined : ctx.contactId,
      },
    );

    if (hits.length === 0) {
      return { results: [], message: "No matching memories found." };
    }

    return {
      results: hits.map((hit) => ({
        id: hit.id,
        area: typeof hit.metadata.area === "string" ? hit.metadata.area : "knowledge",
        content: hit.content,
        summary: typeof hit.metadata.summary === "string" ? hit.metadata.summary : null,
        tags: Array.isArray(hit.metadata.tags) ? hit.metadata.tags : [],
        confidence: typeof hit.metadata.confidence === "number" ? hit.metadata.confidence : null,
        score: Math.round(hit.score * 1000) / 1000,
        source: "mem0",
        pinned: Boolean(hit.metadata.pinned),
      })),
      engine: "mem0",
    };
  }

  const results = await searchMemories(
    {
      query: searchQuery,
      areas: areas as MemoryArea[] | undefined,
      scope: effectiveScope,
      visibility: (visibility as any) || undefined,
      tags,
      limit: limit || 10,
    },
    ctx.config,
  );

  if (results.length === 0) {
    return { results: [], message: "No matching memories found." };
  }

  // Reinforce top results — the agent actively retrieved these
  for (const r of results.slice(0, 3)) {
    reinforceMemory(r.memory.id).catch(() => {});
  }

  return {
    results: results.map((r) => ({
      id: r.memory.id,
      area: r.matchedArea,
      content: r.memory.content,
      summary: r.memory.summary,
      tags: r.memory.tags,
      confidence: r.memory.confidence,
      scope: r.memory.scope,
      visibility: r.memory.visibility,
      score: Math.round(r.score * 1000) / 1000,
      source: r.memory.source,
      pinned: r.memory.pinned,
    })),
    engine: "local",
  };
});

// ─── memory_store: Write a structured memory ───

toolRegistry.set("memory_store", async (input, ctx) => {
  const {
    content,
    area = "knowledge",
    summary,
    tags,
    confidence,
    source = "user",
    scope: inputScope,
    visibility: inputVisibility,
  } = input as {
    content: string;
    area?: string;
    summary?: string;
    tags?: string[];
    confidence?: number;
    source?: string;
    scope?: string;
    visibility?: string;
  };
  const targetArea = area as MemoryArea;
  const targetConfidence = confidence ?? (source === "user" ? 1.0 : 0.7);

  // Resolve scope: explicit input > context scope > null
  const effectiveScope = inputScope || ctx.scope || undefined;
  const effectiveVisibility = (inputVisibility as any) || "shared";

  let localMemoryId: string | null = null;
  if (!isMem0Enabled(ctx.config) || ctx.config.memory.mem0.shadowWriteLocal) {
    const memory = await writeMemory(
      {
        area: targetArea,
        content,
        summary,
        tags,
        confidence: targetConfidence,
        source: source as MemorySource,
        conversationId: ctx.conversationId,
        scope: effectiveScope,
        visibility: effectiveVisibility,
      },
      ctx.config,
    );
    localMemoryId = memory.id;

    // Auto-enrich matching contacts when storing identity memories.
    if (targetArea === "identity") {
      enrichContactFromMemory(content, memory.id);
    }
  }

  if (isMem0Enabled(ctx.config)) {
    const allowedScopes = resolveAllowedScopes({
      scope: ctx.scope,
      allowedScopes: ctx.allowedScopes,
      allowGlobalDataAccess: ctx.allowGlobalDataAccess,
    });
    const tenantScope = ctx.allowGlobalDataAccess ? undefined : (ctx.scope || allowedScopes?.[0]);
    const mem0 = await storeMemoryInMem0(ctx.config, {
      content,
      area: targetArea,
      summary,
      tags,
      confidence: targetConfidence,
      source: source as MemorySource,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      tenantScope,
      companyId: ctx.allowGlobalDataAccess ? undefined : ctx.companyId,
      contactId: ctx.allowGlobalDataAccess ? undefined : ctx.contactId,
    });

    if (mem0) {
      return {
        stored: true,
        id: mem0.id,
        area: targetArea,
        engine: "mem0",
        localId: localMemoryId,
      };
    }
  }

  if (localMemoryId) {
    return {
      stored: true,
      id: localMemoryId,
      area: targetArea,
      engine: "local",
      localId: localMemoryId,
    };
  }

  throw new Error("Failed to store memory");
});

// ─── memory_manage: Update, delete, pin/unpin memories ───

toolRegistry.set("memory_manage", async (input, ctx) => {
  const { id, action, content, confidence } = input as {
    id: string;
    action: "delete" | "update" | "pin" | "unpin";
    content?: string;
    confidence?: number;
  };

  if (isMem0Enabled(ctx.config)) {
    switch (action) {
      case "delete": {
        const deleted = await deleteMem0Memory(ctx.config, id);
        if (deleted) return { deleted: true, id, engine: "mem0" };
        break;
      }

      case "pin": {
        const pinned = await setMem0MemoryPinned(ctx.config, id, true);
        if (pinned) return { pinned: true, id, engine: "mem0", memory: pinned };
        break;
      }

      case "unpin": {
        const unpinned = await setMem0MemoryPinned(ctx.config, id, false);
        if (unpinned) return { unpinned: true, id, engine: "mem0", memory: unpinned };
        break;
      }

      case "update": {
        const metadataPatch: Record<string, unknown> = {};
        if (confidence !== undefined) metadataPatch.confidence = confidence;
        const updated = await updateMem0Memory(ctx.config, id, {
          text: content,
          metadataPatch,
        });
        if (updated) return { updated: true, id, engine: "mem0", memory: updated };
        break;
      }
    }
  }

  switch (action) {
    case "delete":
      await deleteMemory(id);
      return { deleted: true, id, engine: "local" };

    case "pin":
      await updateMemory(id, { pinned: true }, ctx.config);
      return { pinned: true, id, engine: "local" };

    case "unpin":
      await updateMemory(id, { pinned: false }, ctx.config);
      return { unpinned: true, id, engine: "local" };

    case "update": {
      const updates: Parameters<typeof updateMemory>[1] = {};
      if (content !== undefined) updates.content = content;
      if (confidence !== undefined) updates.confidence = confidence;
      const updated = await updateMemory(id, updates, ctx.config);

      // Auto-enrich matching contacts when updating identity memories
      if (content && updated?.area === "identity") {
        enrichContactFromMemory(content, id);
      }

      return { updated: true, id, memory: updated, engine: "local" };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
});

// ─── document_search: Search indexed documents (Outline wiki, Obsidian vault) ───

toolRegistry.set("document_search", async (input, ctx) => {
  const { query: searchQuery, source, scope: inputScope, limit } = input as {
    query: string;
    source?: string;
    scope?: string;
    limit?: number;
  };

  const maxResults = limit || 8;

  // Use explicit scope param if provided, otherwise fall back to context-based scoping
  let allowedScopes: string[] | null;
  if (inputScope) {
    // Explicit scope: filter to that scope (unscoped docs included via buildScopeFilterSql)
    allowedScopes = [inputScope];
  } else {
    allowedScopes = resolveAllowedScopes({
      scope: ctx.scope,
      allowedScopes: ctx.allowedScopes,
      allowGlobalDataAccess: ctx.allowGlobalDataAccess,
    });
  }

  // Try hybrid: vector + FTS
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embed(searchQuery, ctx.config);
  } catch {
    // Fall back to FTS only
  }

  let sql: string;
  const params: unknown[] = [];
  let paramIdx = 1;

  if (queryEmbedding) {
    params.push(`[${queryEmbedding.join(",")}]`);
    const embeddingParam = paramIdx++;
    params.push(searchQuery);
    const queryParam = paramIdx++;

    const sourceFilter = source
      ? `AND d.source = $${paramIdx++}`
      : "";
    if (source) params.push(source);

    const scopeFilter = allowedScopes
      ? `AND ${buildScopeFilterSql("d.metadata->>'scope'", paramIdx++)}`
      : "";
    if (allowedScopes) params.push(allowedScopes);

    params.push(maxResults);
    const limitParam = paramIdx++;

    sql = `
      SELECT d.id AS doc_id, d.title, d.path, d.source, d.metadata,
             c.content, c.chunk_index,
             CASE WHEN c.embedding IS NOT NULL
               THEN 1 - (c.embedding <=> $${embeddingParam}::vector)
               ELSE 0
             END AS vector_score,
             ts_rank(c.fts, websearch_to_tsquery('english', $${queryParam})) AS text_score
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE (c.fts @@ websearch_to_tsquery('english', $${queryParam})
             OR (c.embedding IS NOT NULL AND 1 - (c.embedding <=> $${embeddingParam}::vector) > 0.3))
        ${sourceFilter}
        ${scopeFilter}
      ORDER BY
        (CASE WHEN c.embedding IS NOT NULL
          THEN 1 - (c.embedding <=> $${embeddingParam}::vector)
          ELSE 0
        END) * 0.6 +
        ts_rank(c.fts, websearch_to_tsquery('english', $${queryParam})) * 0.4
        DESC
      LIMIT $${limitParam}
    `;
  } else {
    params.push(searchQuery);
    const queryParam = paramIdx++;

    const sourceFilter = source
      ? `AND d.source = $${paramIdx++}`
      : "";
    if (source) params.push(source);

    const scopeFilter = allowedScopes
      ? `AND ${buildScopeFilterSql("d.metadata->>'scope'", paramIdx++)}`
      : "";
    if (allowedScopes) params.push(allowedScopes);

    params.push(maxResults);
    const limitParam = paramIdx++;

    sql = `
      SELECT d.id AS doc_id, d.title, d.path, d.source, d.metadata,
             c.content, c.chunk_index,
             0 AS vector_score,
             ts_rank(c.fts, websearch_to_tsquery('english', $${queryParam})) AS text_score
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.fts @@ websearch_to_tsquery('english', $${queryParam})
        ${sourceFilter}
        ${scopeFilter}
      ORDER BY text_score DESC
      LIMIT $${limitParam}
    `;
  }

  const result = await query<{
    doc_id: number;
    title: string;
    path: string | null;
    source: string;
    metadata: Record<string, unknown> | null;
    content: string;
    chunk_index: number;
    vector_score: number;
    text_score: number;
  }>(sql, params);

  if (result.rows.length === 0) {
    return { results: [], message: "No matching documents found." };
  }

  return {
    results: result.rows.map((r) => ({
      title: r.title,
      path: r.path,
      source: r.source,
      content: r.content,
      score: Math.round((Number(r.vector_score) * 0.6 + Number(r.text_score) * 0.4) * 1000) / 1000,
      metadata: r.metadata,
    })),
  };
});

// ─── schedule_create: Create a scheduled/recurring task ───

toolRegistry.set("schedule_create", async (input, ctx) => {
  const {
    name,
    description,
    message,
    schedule_type,
    schedule_at,
    interval_minutes,
    cron_expression,
    timezone,
  } = input as {
    name: string;
    description?: string;
    message: string;
    schedule_type: "once" | "every" | "cron";
    schedule_at?: string;
    interval_minutes?: number;
    cron_expression?: string;
    timezone?: string;
  };

  const job = await createJob({
    agentId: ctx.agentId,
    name,
    description,
    payloadKind: "agent_turn",
    payloadText: message,
    scheduleKind: schedule_type === "once" ? "at" : schedule_type === "every" ? "every" : "cron",
    scheduleAt: schedule_at,
    scheduleEveryMs: interval_minutes ? interval_minutes * 60 * 1000 : undefined,
    scheduleCronExpr: cron_expression,
    scheduleCronTz: timezone || "Europe/Vienna",
    deleteAfterRun: schedule_type === "once",
  });

  return {
    created: true,
    id: job.id,
    name: job.name,
    schedule: schedule_type === "once"
      ? `once at ${schedule_at}`
      : schedule_type === "every"
        ? `every ${interval_minutes} minutes`
        : `cron: ${cron_expression}`,
  };
});

// ─── schedule_list: List all scheduled tasks ───

toolRegistry.set("schedule_list", async () => {
  const jobs = await listJobs();

  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      description: j.description,
      enabled: j.enabled,
      schedule: j.schedule_kind === "at"
        ? `once at ${j.schedule_at}`
        : j.schedule_kind === "every"
          ? `every ${Math.round((j.schedule_every_ms || 0) / 60000)} min`
          : `cron: ${j.schedule_cron_expr}`,
      lastRun: j.last_run_at,
      lastStatus: j.last_status,
      payload: j.payload_text,
    })),
  };
});

// ─── schedule_manage: Delete or toggle a scheduled task ───

toolRegistry.set("schedule_manage", async (input) => {
  const { id, action } = input as { id: string; action: "delete" | "enable" | "disable" };

  if (action === "delete") {
    await deleteJob(id);
    return { deleted: true, id };
  }

  await toggleJob(id, action === "enable");
  return { toggled: true, id, enabled: action === "enable" };
});

// ─── current_datetime ───

toolRegistry.set("current_datetime", async () => {
  return {
    datetime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    formatted: new Date().toLocaleString(),
  };
});

// ─── query_gateway_logs: Read logs from the gateway_logs table ───

toolRegistry.set("query_gateway_logs", async (input) => {
  const { level, source, since, limit, search } = input as {
    level?: string;
    source?: string;
    since?: string;
    limit?: number;
    search?: string;
  };

  const maxLimit = Math.min(limit || 500, 2000);
  const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const logs = await queryLogs({
    level: level as any,
    source: source as any,
    since: sinceDate,
    limit: maxLimit,
    search,
  });

  return {
    count: logs.length,
    since: sinceDate,
    logs,
  };
});

// ─── spawn_agent: Spawn a sub-agent to handle a specialized task ───

toolRegistry.set("spawn_agent", async (input, ctx) => {
  const { agent_id, message } = input as {
    agent_id: string;
    message: string;
  };

  const currentDepth = ctx.depth ?? 0;
  const maxDepth = ctx.maxDepth ?? 2;

  if (currentDepth >= maxDepth) {
    return { error: `Maximum spawn depth (${maxDepth}) reached. Cannot spawn sub-agents deeper.` };
  }

  if (!ctx.spawnAgent) {
    return { error: "Sub-agent spawning not available in this context." };
  }

  // Verify agent exists
  const agentResult = await query<{ id: string; name: string }>(
    "SELECT id, name FROM agents WHERE id = $1 AND enabled = true",
    [agent_id],
  );

  if (agentResult.rows.length === 0) {
    return { error: `Agent '${agent_id}' not found or disabled.` };
  }

  try {
    const result = await ctx.spawnAgent({
      agentId: agent_id,
      message,
    });

    return {
      agent: agent_id,
      agentName: agentResult.rows[0].name,
      response: result.content,
      model: result.model,
      usage: result.usage,
    };
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    return { error: `Sub-agent '${agent_id}' failed: ${message_}` };
  }
});

// ─── review_request: Submit an item for human review ───

toolRegistry.set("review_request", async (input, ctx) => {
  const {
    type,
    title,
    description,
    content = [],
    proposed_action,
    alternatives,
    priority = 0,
    tags,
    batch_id,
    wait = false,
  } = input as {
    type: string;
    title: string;
    description?: string;
    content?: unknown[];
    proposed_action?: unknown;
    alternatives?: unknown;
    priority?: number;
    tags?: string[];
    batch_id?: string;
    wait?: boolean;
  };

  const result = await query<{ id: string }>(
    `INSERT INTO review_queue (agent_id, conversation_id, type, title, description,
       content, proposed_action, alternatives, priority, tags, batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      ctx.agentId,
      ctx.conversationId,
      type,
      title,
      description || null,
      JSON.stringify(content),
      proposed_action ? JSON.stringify(proposed_action) : null,
      alternatives ? JSON.stringify(alternatives) : null,
      priority,
      tags || null,
      batch_id || null,
    ],
  );

  const reviewId = result.rows[0].id;

  // Broadcast to connected clients
  ctx.broadcast?.("review.created", {
    id: reviewId,
    agentId: ctx.agentId,
    type,
    title,
    priority,
    tags,
  });

  if (wait) {
    // Poll for resolution (max 5 minutes)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const check = await query<{ status: string; resolution: unknown; resolved_by: string }>(
        "SELECT status, resolution, resolved_by FROM review_queue WHERE id = $1",
        [reviewId],
      );
      if (check.rows[0]?.status !== "pending") {
        return {
          id: reviewId,
          status: check.rows[0].status,
          resolution: check.rows[0].resolution,
          resolvedBy: check.rows[0].resolved_by,
        };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { id: reviewId, status: "timeout", message: "Review not resolved within 5 minutes." };
  }

  return { id: reviewId, status: "pending", message: "Review item created. Will be resolved by a human." };
});

// ─── review_status: Check or list review items ───

toolRegistry.set("review_status", async (input, ctx) => {
  const { id, status_filter, batch_id, limit } = input as {
    id?: string;
    status_filter?: string;
    batch_id?: string;
    limit?: number;
  };

  if (id) {
    const result = await query(
      "SELECT * FROM review_queue WHERE id = $1",
      [id],
    );
    if (result.rows.length === 0) return { error: "Review item not found." };
    return { item: result.rows[0] };
  }

  const conditions = ["agent_id = $1"];
  const params: unknown[] = [ctx.agentId];
  let paramIdx = 2;

  if (status_filter) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status_filter);
  }
  if (batch_id) {
    conditions.push(`batch_id = $${paramIdx++}`);
    params.push(batch_id);
  }

  params.push(limit || 20);

  const result = await query(
    `SELECT id, type, title, status, priority, created_at, resolved_at
     FROM review_queue
     WHERE ${conditions.join(" AND ")}
     ORDER BY priority DESC, created_at DESC
     LIMIT $${paramIdx}`,
    params,
  );

  return { items: result.rows, count: result.rows.length };
});

// ─── skill_read: Load an external SKILL.md by name ───

toolRegistry.set("skill_read", async (input) => {
  const { name, source } = input as { name: string; source?: string };

  // Sanitize: only allow simple directory names (no path traversal)
  if (!name || /[/\\.]/.test(name)) {
    return { error: "Invalid skill name." };
  }

  if (source && !/^[a-z0-9_-]+$/i.test(source)) {
    return { error: "Invalid skill source." };
  }

  const mdPath = resolveSkillPathByName(name, source);

  if (!mdPath) {
    const sourceHint = source
      ? ` in source '${source}'`
      : "";
    return { error: `Skill '${name}' not found${sourceHint}.` };
  }

  try {
    const content = readFileSync(mdPath, "utf-8");
    return { name, source: source || null, content, path: mdPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to read skill: ${message}` };
  }
});

// ─── run_claude_code: Delegate coding tasks to Claude Code CLI ───

toolRegistry.set("run_claude_code", async (input, ctx) => {
  const { prompt, cwd, model } = input as {
    prompt: string;
    cwd?: string;
    model?: string;
  };

  // Read defaults from agent config
  const defaultCwd = (ctx.agentConfig?.defaultCwd as string) || "~/dev_mm/joi";
  const defaultModel = (ctx.agentConfig?.claudeCodeModel as string) || undefined;

  const effectiveCwd = cwd || defaultCwd;
  const effectiveModel = model || defaultModel || undefined;

  try {
    const result = await runClaudeCode({
      userMessage: prompt,
      cwd: effectiveCwd,
      model: effectiveModel,
      timeoutMs: TOOL_CLAUDE_TIMEOUT_MS,
    });

    return {
      success: true,
      content: result.content,
      model: result.model,
      usage: result.usage,
      cwd: effectiveCwd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, cwd: effectiveCwd };
  }
});

// ─── agent_heartbeat: Report agent status/progress ───

toolRegistry.set("agent_heartbeat", async (input, ctx) => {
  const { status, current_task, progress, error_message, metadata } = input as {
    status: string;
    current_task?: string;
    progress?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  };

  const heartbeat = await updateHeartbeat(ctx.agentId, {
    status,
    current_task: current_task ?? null,
    progress: progress ?? null,
    error_message: error_message ?? null,
    metadata,
  });

  ctx.broadcast?.("agent.heartbeat", {
    agentId: ctx.agentId,
    status: heartbeat.status,
    currentTask: heartbeat.current_task,
    progress: heartbeat.progress,
    timestamp: heartbeat.last_heartbeat_at,
  });

  return { updated: true, status: heartbeat.status, last_heartbeat_at: heartbeat.last_heartbeat_at };
});

// ─── agent_task_create: Assign a task to an agent ───

toolRegistry.set("agent_task_create", async (input, ctx) => {
  const { agent_id, title, description, input_data, priority, deadline } = input as {
    agent_id: string;
    title: string;
    description?: string;
    input_data?: Record<string, unknown>;
    priority?: number;
    deadline?: string;
  };

  const task = await createTask({
    agent_id,
    assigned_by: ctx.agentId,
    title,
    description,
    priority,
    input_data,
    conversation_id: ctx.conversationId,
    deadline,
  });

  ctx.broadcast?.("agent.task_created", {
    taskId: task.id,
    agentId: agent_id,
    assignedBy: ctx.agentId,
    title,
    priority: task.priority,
  });

  return { created: true, id: task.id, agent_id, title, status: task.status };
});

// ─── agent_task_update: Update task progress/status ───

toolRegistry.set("agent_task_update", async (input, ctx) => {
  const { task_id, status, progress, result_data } = input as {
    task_id: string;
    status?: string;
    progress?: number;
    result_data?: unknown;
  };

  const task = await updateTask(task_id, {
    status,
    progress,
    result_data,
    result_conversation_id: ctx.conversationId,
  });

  ctx.broadcast?.("agent.task_updated", {
    taskId: task.id,
    agentId: task.agent_id,
    status: task.status,
    progress: task.progress,
  });

  return { updated: true, id: task.id, status: task.status, progress: task.progress };
});

// ─── agent_task_list: List tasks with filters ───

toolRegistry.set("agent_task_list", async (input, ctx) => {
  const { agent_id, status, assigned_by, limit } = input as {
    agent_id?: string;
    status?: string;
    assigned_by?: string;
    limit?: number;
  };

  const tasks = await listTasks({
    agent_id: agent_id || undefined,
    status: status || undefined,
    assigned_by: assigned_by || undefined,
    limit: limit || 20,
  });

  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      agent_id: t.agent_id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      assigned_by: t.assigned_by,
      deadline: t.deadline,
      created_at: t.created_at,
      completed_at: t.completed_at,
    })),
    count: tasks.length,
  };
});

// ─── Tool definitions for Claude API ───

// Register accounting tools into main registry
for (const [name, handler] of getAccountingToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register calendar tools into main registry
for (const [name, handler] of getCalendarToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Gmail tools into main registry
for (const [name, handler] of getGmailToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register channel tools into main registry
for (const [name, handler] of getChannelToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Things3 tools into main registry
for (const [name, handler] of getThingsToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Obsidian tools into main registry
for (const [name, handler] of getObsidianToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Outline tools into main registry
for (const [name, handler] of getOutlineToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Notion tools into main registry
for (const [name, handler] of getNotionToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Apple Contacts tools into main registry
for (const [name, handler] of getContactsToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register YouTube tools into main registry
for (const [name, handler] of getYouTubeToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Skill Scout tools into main registry
for (const [name, handler] of getSkillScoutToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Knowledge Sync tools into main registry
for (const [name, handler] of getKnowledgeSyncToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Store tools into main registry
for (const [name, handler] of getStoreToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register OKR tools into main registry
for (const [name, handler] of getOKRToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register SSH/DevOps tools into main registry
for (const [name, handler] of getSSHToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Avatar/Gemini image tools into main registry
for (const [name, handler] of getAvatarToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register media integration tools (Emby + Jellyseerr) into main registry
for (const [name, handler] of getMediaIntegrationToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Register Quotes/Sales tools into main registry
for (const [name, handler] of getQuotesToolHandlers()) {
  toolRegistry.set(name, handler);
}

// Core tools always available to every agent (memory, scheduling, system)
const CORE_TOOLS = new Set([
  "memory_search", "memory_store", "memory_manage",
  "document_search", "current_datetime",
  "schedule_create", "schedule_list", "schedule_manage",
  "spawn_agent", "review_request", "review_status",
  "query_gateway_logs", "skill_read",
  "agent_heartbeat", "agent_task_create", "agent_task_update", "agent_task_list",
]);

/**
 * Get tool definitions, optionally filtered by agent skill list.
 * - If allowedSkills is null/undefined → ALL tools (personal/JOI agent)
 * - If allowedSkills is a string[] → core tools + only the listed tools
 */
export function getToolDefinitions(allowedSkills?: string[] | null): Anthropic.Tool[] {
  const allTools: Anthropic.Tool[] = [
    {
      name: "memory_search",
      description:
        "Search memories and knowledge. Searches across 5 memory areas (identity, preferences, knowledge, solutions, episodes) using hybrid BM25 + vector search. " +
        "Supports filtering by scope (e.g. company name like 'creditreform', 'itellico'), visibility ('shared', 'private'), and tags. " +
        "Use this to recall anything about the user, past conversations, or stored knowledge.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Natural language search query",
          },
          areas: {
            type: "array",
            items: { type: "string", enum: ["identity", "preferences", "knowledge", "solutions", "episodes"] },
            description: "Specific memory areas to search (optional, defaults to all)",
          },
          scope: {
            type: "string",
            description: "Filter by scope/company (e.g. 'creditreform', 'personal', 'itellico-at'). Unscoped memories are always included.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filter by tags — results must have ALL specified tags",
          },
          visibility: {
            type: "string",
            enum: ["shared", "private", "restricted"],
            description: "Filter by visibility level (default: all visibilities)",
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 10)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_store",
      description:
        "Store a memory. Use area='identity' for user facts, 'preferences' for how they like things, 'knowledge' for project/technical facts, 'solutions' for problem/fix pairs, 'episodes' for session summaries. " +
        "Set scope to associate with a company/project (e.g. 'creditreform', 'joi'). Set visibility='private' for personal notes.",
      input_schema: {
        type: "object" as const,
        properties: {
          content: {
            type: "string",
            description: "The memory content to store",
          },
          area: {
            type: "string",
            enum: ["identity", "preferences", "knowledge", "solutions", "episodes"],
            description: "Memory area (default: knowledge)",
          },
          summary: {
            type: "string",
            description: "One-line summary for quick reference",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization",
          },
          scope: {
            type: "string",
            description: "Scope/company to associate this memory with (e.g. 'creditreform', 'itellico-at', 'personal'). Inherits from conversation scope if not set.",
          },
          visibility: {
            type: "string",
            enum: ["shared", "private", "restricted"],
            description: "Visibility level (default: shared). Use 'private' for personal notes.",
          },
          confidence: {
            type: "number",
            description: "Confidence 0-1 (user-stated=1.0, inferred=0.7)",
          },
          source: {
            type: "string",
            enum: ["user", "inferred", "solution_capture", "episode"],
            description: "How this memory was created (default: user)",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "memory_manage",
      description:
        "Manage existing memories: delete, update content/confidence, or pin/unpin. Use memory_search first to find the memory ID. Pinned memories are never decayed or auto-deleted.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The memory ID (get this from memory_search results)",
          },
          action: {
            type: "string",
            enum: ["delete", "update", "pin", "unpin"],
            description: "Action to perform on the memory",
          },
          content: {
            type: "string",
            description: "New content (only for 'update' action)",
          },
          confidence: {
            type: "number",
            description: "New confidence 0-1 (only for 'update' action)",
          },
        },
        required: ["id", "action"],
      },
    },
    {
      name: "document_search",
      description:
        "Search indexed documents from Outline wiki, Obsidian vault, and other ingested sources. Uses hybrid vector + full-text search across document chunks. " +
        "Supports scope filtering to narrow results to a specific company/project. " +
        "Use this for company knowledge, wiki articles, project docs, processes, and reference material.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Natural language search query",
          },
          source: {
            type: "string",
            enum: ["obsidian", "file", "web", "manual"],
            description: "Filter by document source (optional, defaults to all sources)",
          },
          scope: {
            type: "string",
            description: "Filter by scope/company (e.g. 'creditreform', 'itellico-at'). Unscoped documents are always included.",
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 8)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "schedule_create",
      description:
        "Create a scheduled or recurring task. The agent will be called with the given message at the scheduled time. Use for reminders, recurring check-ins, periodic tasks, etc.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Short name for the scheduled task (e.g. 'morning-briefing', 'weekly-review')",
          },
          description: {
            type: "string",
            description: "What this scheduled task does",
          },
          message: {
            type: "string",
            description: "The message/prompt the agent will receive when the task runs",
          },
          schedule_type: {
            type: "string",
            enum: ["once", "every", "cron"],
            description: "once = run once at a specific time, every = repeat at interval, cron = cron expression",
          },
          schedule_at: {
            type: "string",
            description: "ISO 8601 datetime for 'once' type (e.g. '2026-02-20T09:00:00')",
          },
          interval_minutes: {
            type: "number",
            description: "Interval in minutes for 'every' type",
          },
          cron_expression: {
            type: "string",
            description: "Cron expression for 'cron' type (e.g. '0 9 * * 1' for every Monday at 9 AM)",
          },
          timezone: {
            type: "string",
            description: "Timezone (default: Europe/Vienna). Use IANA timezone names.",
          },
        },
        required: ["name", "message", "schedule_type"],
      },
    },
    {
      name: "schedule_list",
      description: "List all scheduled tasks with their status, last run info, and schedule.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "schedule_manage",
      description: "Delete, enable, or disable a scheduled task by ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The job ID to manage",
          },
          action: {
            type: "string",
            enum: ["delete", "enable", "disable"],
            description: "Action to take on the scheduled task",
          },
        },
        required: ["id", "action"],
      },
    },
    {
      name: "current_datetime",
      description: "Get the current date, time, and timezone.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "query_gateway_logs",
      description:
        "Query the JOI gateway logs from the database. Use this to analyze access logs, error logs, agent activity, and system events. Supports filtering by level, source, time range, and text search.",
      input_schema: {
        type: "object" as const,
        properties: {
          level: {
            type: "string",
            enum: ["debug", "info", "warn", "error"],
            description: "Filter by log level",
          },
          source: {
            type: "string",
            enum: ["gateway", "agent", "cron", "knowledge", "obsidian", "outline", "pty", "autolearn", "access"],
            description: "Filter by log source. Use 'access' for HTTP request logs.",
          },
          since: {
            type: "string",
            description: "ISO datetime — only return logs after this time. Defaults to last 24 hours.",
          },
          limit: {
            type: "number",
            description: "Max rows to return (default: 500, max: 2000)",
          },
          search: {
            type: "string",
            description: "Text search on the message field (case-insensitive partial match)",
          },
        },
        required: [],
      },
    },
    {
      name: "spawn_agent",
      description:
        "Spawn a specialized sub-agent to handle a task. The sub-agent runs with its own system prompt and tools, and returns its response. Use this to delegate work to specialized agents (e.g. invoice-processor, reconciliation, bmd-uploader).",
      input_schema: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "ID of the agent to spawn (e.g. 'invoice-processor', 'reconciliation')",
          },
          message: {
            type: "string",
            description: "The task/instruction to send to the sub-agent",
          },
        },
        required: ["agent_id", "message"],
      },
    },
    {
      name: "run_claude_code",
      description:
        "Run a coding task via Claude Code CLI. This tool has full file system access and can read, write, edit files, run shell commands, and perform complex multi-step coding tasks. Use it for writing code, debugging, refactoring, creating files, running tests, and any development work. The CLI runs in a PTY with a 10-minute timeout.",
      input_schema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "The coding task or instruction to execute. Be specific about what files to create/modify, what the code should do, and any constraints.",
          },
          cwd: {
            type: "string",
            description: "Working directory for the CLI session (default: from agent config, typically ~/dev_mm/joi). Use absolute paths or ~/ prefix.",
          },
          model: {
            type: "string",
            description: "Override the Claude Code model (e.g. 'sonnet', 'opus'). Leave empty to use CLI default or agent config.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "skill_read",
      description:
        "Read the full SKILL.md instructions for an installed skill by name. The system prompt lists available skills with short descriptions — use this tool to load the complete instructions when a task matches a skill, then execute with native tools.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Skill name, e.g. 'copywriting', 'seo-audit', 'skill-creator'.",
          },
          source: {
            type: "string",
            enum: ["claude-code", "gemini", "codex", "codex-system", "codex-project"],
            description: "Optional source selector. If omitted, resolve across installed sources.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "review_request",
      description:
        "Submit an item for human review. Creates a review queue entry that appears in the JOI dashboard. The human can approve, reject, or modify. Use wait=true to block until the human responds (max 5 min).",
      input_schema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["approve", "classify", "match", "select", "verify", "freeform", "info", "triage", "soul_update"],
            description: "Type of review: approve (yes/no), classify (pick category), match (confirm pairing), select (pick from options), verify (confirm data), freeform (open response), info (non-blocking summary), triage (inbox action plan), soul_update (agent soul evolution proposal)",
          },
          title: {
            type: "string",
            description: "Short title for the review item",
          },
          description: {
            type: "string",
            description: "Detailed description of what needs review",
          },
          content: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["text", "table", "image", "pdf", "diff", "json", "form"] },
                data: { type: "object" },
              },
            },
            description: "Content blocks to display (text, tables, images, PDFs, diffs, etc.)",
          },
          proposed_action: {
            type: "object",
            description: "The agent's proposed action/choice for the human to approve or modify",
          },
          alternatives: {
            type: "array",
            items: { type: "object" },
            description: "Alternative actions the human can choose from",
          },
          priority: {
            type: "number",
            description: "Priority (higher = more urgent, default 0)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for filtering (e.g. ['accounting', 'reconciliation'])",
          },
          batch_id: {
            type: "string",
            description: "Group related reviews together with a batch ID",
          },
          wait: {
            type: "boolean",
            description: "If true, block until the human resolves this review (max 5 min). Default: false.",
          },
        },
        required: ["type", "title"],
      },
    },
    {
      name: "review_status",
      description:
        "Check the status of review items. Provide an ID to check a specific item, or filter by status/batch to list items.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "Specific review item ID to check",
          },
          status_filter: {
            type: "string",
            enum: ["pending", "approved", "rejected", "modified"],
            description: "Filter by status",
          },
          batch_id: {
            type: "string",
            description: "Filter by batch ID",
          },
          limit: {
            type: "number",
            description: "Maximum items to return (default: 20)",
          },
        },
        required: [],
      },
    },
    {
      name: "agent_heartbeat",
      description:
        "Report your current status and progress. Call this when starting work (status='working'), making progress, or finishing (status='finished'/'error'). This helps track agent liveness and workload.",
      input_schema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["idle", "working", "finished", "error"],
            description: "Current agent status",
          },
          current_task: {
            type: "string",
            description: "Brief description of current task (when working)",
          },
          progress: {
            type: "number",
            description: "Progress 0.0-1.0 (when working)",
          },
          error_message: {
            type: "string",
            description: "Error details (when status is error)",
          },
          metadata: {
            type: "object",
            description: "Additional status metadata",
          },
        },
        required: ["status"],
      },
    },
    {
      name: "agent_task_create",
      description:
        "Assign a task to an agent. Creates a tracked task with priority, optional deadline, and input data. Use this to delegate work to specialized agents with accountability.",
      input_schema: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "ID of the agent to assign the task to",
          },
          title: {
            type: "string",
            description: "Short title for the task",
          },
          description: {
            type: "string",
            description: "Detailed task description and requirements",
          },
          input_data: {
            type: "object",
            description: "Structured input data for the task",
          },
          priority: {
            type: "number",
            description: "Priority 1-10 (higher = more urgent, default: 5)",
          },
          deadline: {
            type: "string",
            description: "ISO 8601 deadline (task auto-fails if not completed by then)",
          },
        },
        required: ["agent_id", "title"],
      },
    },
    {
      name: "agent_task_update",
      description:
        "Update the status or progress of a task. Use to mark tasks in_progress, completed, or failed, and to report progress.",
      input_schema: {
        type: "object" as const,
        properties: {
          task_id: {
            type: "string",
            description: "UUID of the task to update",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
            description: "New task status",
          },
          progress: {
            type: "number",
            description: "Progress 0.0-1.0",
          },
          result_data: {
            type: "object",
            description: "Task result data (when completing)",
          },
        },
        required: ["task_id"],
      },
    },
    {
      name: "agent_task_list",
      description:
        "List tasks with optional filters. See your own tasks, tasks assigned by you, or all tasks for a specific agent.",
      input_schema: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "Filter by agent ID",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
            description: "Filter by status",
          },
          assigned_by: {
            type: "string",
            description: "Filter by who assigned the task",
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 20)",
          },
        },
        required: [],
      },
    },
    ...getAccountingToolDefinitions(),
    ...getCalendarToolDefinitions(),
    ...getGmailToolDefinitions(),
    ...getChannelToolDefinitions(),
    ...getThingsToolDefinitions(),
    ...getObsidianToolDefinitions(),
    ...getOutlineToolDefinitions(),
    ...getNotionToolDefinitions(),
    ...getContactsToolDefinitions(),
    ...getYouTubeToolDefinitions(),
    ...getSkillScoutToolDefinitions(),
    ...getKnowledgeSyncToolDefinitions(),
    ...getStoreToolDefinitions(),
    ...getOKRToolDefinitions(),
    ...getSSHToolDefinitions(),
    ...getAvatarToolDefinitions(),
    ...getMediaIntegrationToolDefinitions(),
    ...getQuotesToolDefinitions(),
  ];

  // No filter = return everything (personal JOI agent)
  if (!allowedSkills) return allTools;

  // Filter: core tools + agent-specific tools
  const allowed = new Set(allowedSkills);
  return allTools.filter((t) => CORE_TOOLS.has(t.name) || allowed.has(t.name));
}

const SHADOW_SAFE_READ_TOOLS = new Set([
  "current_datetime",
  "query_gateway_logs",
  "skill_read",
  "skill_audit",
  "skill_scan_joi",
  "skill_scan_claude_code",
  "skill_scan_official",
  "skill_scan_agents",
  "youtube_transcribe",
  "audio_transcribe",
]);

const SHADOW_BLOCKED_MUTATION_TOOLS = new Set([
  "memory_store",
  "memory_manage",
  "schedule_create",
  "schedule_manage",
  "run_claude_code",
  "review_request",
  "agent_heartbeat",
  "agent_task_create",
  "agent_task_update",
  "spawn_agent",
  "contacts_update_extra",
  "channel_send",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "gmail_send",
  "gmail_mark_processed",
  "drive_upload",
  "invoice_save",
  "invoice_classify",
  "transaction_import",
  "transaction_match",
  "reconciliation_run",
  "obsidian_write",
  "okr_sync_things3",
  "okr_checkin",
  "jellyseerr_create_request",
  "jellyseerr_cancel_request",
  "quotes_create",
  "quotes_update",
  "quotes_add_item",
  "quotes_update_item",
  "quotes_remove_item",
  "quotes_recalculate",
  "quotes_generate_pdf",
  "gemini_avatar_generate",
  "gemini_avatar_generate_all",
  "avatar_style_set",
  "ssh_exec",
  "store_create_collection",
  "store_create_object",
  "store_update_object",
  "store_delete_object",
  "store_relate",
  "notion_create",
  "notion_update",
  "notion_comment",
  "tasks_create",
  "tasks_complete",
  "tasks_update",
  "tasks_move",
  "tasks_create_project",
]);

function isReadOnlyInShadowMode(name: string): boolean {
  if (SHADOW_SAFE_READ_TOOLS.has(name)) return true;
  if (SHADOW_BLOCKED_MUTATION_TOOLS.has(name)) return false;

  if (/_((create|update|delete|remove|send|write|manage|move|complete|uncomplete|toggle|sync|import|upload|save|store|set|recalculate|generate|run|request|comment|relate|mark|apply))$/i.test(name)) {
    return false;
  }
  if (/_(create|update|delete|remove|send|write|store|set|sync|upload|import)_/i.test(name)) {
    return false;
  }

  if (/(^|_)(search|list|get|read|query|status|scan|check|show|overview|report|score|servers|library|recent|recently|activity|continue|next|now|details|availability|summary|progress|groups|members|interactions|datetime|tree|migrations|transcribe|trending|available|requests|collections)(_|$)/i.test(name)) {
    return true;
  }

  return false;
}

function summarizeInputForSimulation(input: unknown): string {
  if (input == null) return "";
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  if (!raw) return "";
  if (raw.length <= 220) return raw;
  return `${raw.slice(0, 220)}... [truncated ${raw.length - 220} chars]`;
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const executionMode = ctx.executionMode || "live";
  if (executionMode !== "live") {
    const canExecute = executionMode === "shadow" && isReadOnlyInShadowMode(name);
    if (!canExecute) {
      return {
        simulated: true,
        execution_mode: executionMode,
        tool: name,
        blocked: true,
        reason: executionMode === "dry_run"
          ? "Tool execution skipped in dry_run mode."
          : "Mutating or unsafe tool blocked in shadow mode.",
        input_preview: summarizeInputForSimulation(input),
      };
    }
  }

  const handler = toolRegistry.get(name);
  if (!handler) {
    return { error: `Unknown tool: ${name}` };
  }

  try {
    return await handler(input, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Tool ${name} failed:`, message);
    return { error: message };
  }
}
