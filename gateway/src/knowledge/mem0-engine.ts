import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { query } from "../db/client.js";
import type { JoiConfig } from "../config/schema.js";
import type { MemoryArea, MemorySource } from "./types.js";

interface Mem0Scope {
  userId?: string;
  agentId?: string;
  runId?: string;
  tenantScope?: string;
  companyId?: string;
  contactId?: string;
}

interface Mem0ContextPayload {
  source: string;
  area?: MemoryArea;
  summary?: string;
  tags?: string[];
  confidence?: number;
  memorySource?: MemorySource;
  conversationId?: string;
  agentId?: string;
  tenantScope?: string;
  companyId?: string;
  contactId?: string;
  toolCount?: number;
  pinned?: boolean;
}

export interface Mem0SearchHit {
  id: string;
  content: string;
  score: number;
  categories: string[];
  metadata: Record<string, unknown>;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface Mem0Client {
  search: (query: string, options?: Record<string, unknown>) => Promise<{ results: unknown[] }>;
  add: (messages: Array<{ role: "user" | "assistant"; content: string }>, options?: Record<string, unknown>) => Promise<{ results: Array<{ id?: string }> }>;
  get: (id: string) => Promise<unknown>;
  update: (id: string, text: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

type Mem0Backend = { client: Mem0Client };
type Mem0VectorBackend = "pgvector" | "sqlite";

const require = createRequire(import.meta.url);

const DEFAULT_MEM0_VECTOR_BACKEND: Mem0VectorBackend = "pgvector";
const DEFAULT_MEM0_PGVECTOR_TABLE = "mem0_vectors";
const MEM0_META_TABLE = "mem0_meta";
const PG_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

let cachedBackend: { key: string; backend: Mem0Backend } | null = null;
let warnedInitError = false;
let lastInitError: string | null = null;

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dedupeLines(lines: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(line.trim());
    if (result.length >= limit) break;
  }
  return result;
}

function truncateLine(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 3) + "...";
}

function readMem0VectorBackend(): Mem0VectorBackend {
  const raw = (process.env.MEM0_VECTOR_BACKEND || "").trim().toLowerCase();
  if (raw === "sqlite" || raw === "local") return "sqlite";
  return DEFAULT_MEM0_VECTOR_BACKEND;
}

function sanitizePgIdentifier(value: string, fallback: string): string {
  const candidate = (value || "").trim();
  if (!candidate) return fallback;
  if (!PG_IDENTIFIER_RE.test(candidate)) {
    throw new Error(`Invalid PostgreSQL identifier: ${candidate}`);
  }
  return candidate.toLowerCase();
}

function readMem0PgvectorTableName(): string {
  return sanitizePgIdentifier(process.env.MEM0_PGVECTOR_TABLE || DEFAULT_MEM0_PGVECTOR_TABLE, DEFAULT_MEM0_PGVECTOR_TABLE);
}

function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}

function buildBackendKey(config: JoiConfig): string {
  const mem0 = config.memory.mem0;
  const backendMode = readMem0VectorBackend();
  return [
    mem0.userId,
    mem0.appId || "",
    config.memory.ollamaUrl,
    config.memory.embeddingModel,
    config.memory.embeddingDimension,
    backendMode,
    backendMode === "pgvector" ? readMem0PgvectorTableName() : "local",
  ].join("|");
}

function mapLocalHit(item: Record<string, unknown>): Mem0SearchHit {
  return {
    id: String(item.id || ""),
    content: parseText(item.memory),
    score: Number(item.score || 0),
    categories: Array.isArray(item.categories)
      ? item.categories.filter((c): c is string => typeof c === "string")
      : [],
    metadata: parseMetadata(item.metadata),
    createdAt: parseDate(item.createdAt),
    updatedAt: parseDate(item.updatedAt),
  };
}

function buildMem0RequestBase(config: JoiConfig, scope: Mem0Scope = {}): Record<string, unknown> {
  const appId = config.memory.mem0.appId?.trim();
  const metadata: Record<string, unknown> = {};
  const filters: Record<string, unknown> = {};
  const tenantScope = scope.tenantScope?.trim();
  const companyId = scope.companyId?.trim();
  const contactId = scope.contactId?.trim();

  if (appId) {
    metadata.appId = appId;
    filters.appId = appId;
  }
  if (tenantScope) {
    metadata.scope = tenantScope;
    filters.scope = tenantScope;
  }
  if (companyId) {
    metadata.companyId = companyId;
    filters.companyId = companyId;
  }
  if (contactId) {
    metadata.contactId = contactId;
    filters.contactId = contactId;
  }

  return {
    userId: scope.userId || config.memory.mem0.userId,
    ...(scope.agentId ? { agentId: scope.agentId } : {}),
    ...(scope.runId ? { runId: scope.runId } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}

function getMem0BasePath(): string {
  return path.join(process.env.HOME || process.cwd(), ".joi", "mem0");
}

function ensureWritableFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const fd = fs.openSync(filePath, "a");
    fs.closeSync(fd);
  }
}

class PgVectorMem0Store {
  private readonly tableName: string;
  private readonly embeddingIndex: string;
  private readonly payloadIndex: string;
  private readonly dimension: number;
  private initialized: Promise<void> | null = null;
  private cachedUserId: string | null = null;

  constructor(tableName: string, dimension: number) {
    this.tableName = sanitizePgIdentifier(tableName, DEFAULT_MEM0_PGVECTOR_TABLE);
    this.embeddingIndex = sanitizePgIdentifier(`${this.tableName}_embedding_idx`, `${DEFAULT_MEM0_PGVECTOR_TABLE}_embedding_idx`);
    this.payloadIndex = sanitizePgIdentifier(`${this.tableName}_payload_idx`, `${DEFAULT_MEM0_PGVECTOR_TABLE}_payload_idx`);
    this.dimension = dimension;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.initializeInternal();
    }
    return this.initialized;
  }

  private async initializeInternal(): Promise<void> {
    try {
      await query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (err) {
      // Extension might already exist with limited privilege; continue and let table creation fail loudly if required.
      console.warn("[Mem0] pgvector extension check failed:", err);
    }

    await query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
         id TEXT PRIMARY KEY,
         embedding vector(${this.dimension}) NOT NULL,
         payload JSONB NOT NULL,
         created_at TIMESTAMPTZ DEFAULT NOW(),
         updated_at TIMESTAMPTZ DEFAULT NOW()
       )`,
    );

    await query(
      `CREATE INDEX IF NOT EXISTS ${this.embeddingIndex}
         ON ${this.tableName}
         USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,
    );

    await query(
      `CREATE INDEX IF NOT EXISTS ${this.payloadIndex}
         ON ${this.tableName}
         USING gin (payload jsonb_path_ops)`,
    );

    await query(
      `CREATE TABLE IF NOT EXISTS ${MEM0_META_TABLE} (
         id SMALLINT PRIMARY KEY CHECK (id = 1),
         user_id TEXT NOT NULL,
         updated_at TIMESTAMPTZ DEFAULT NOW()
       )`,
    );
  }

  private buildFilterWhere(
    filters?: Record<string, unknown>,
    startParamIndex = 1,
  ): { where: string; params: unknown[] } {
    if (!filters || Object.keys(filters).length === 0) {
      return { where: "", params: [] };
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    let idx = startParamIndex;

    for (const [key, value] of Object.entries(filters)) {
      if (!PG_IDENTIFIER_RE.test(key)) continue;
      if (value === undefined || value === null) continue;
      clauses.push(`(payload ->> '${key}') = $${idx++}`);
      params.push(String(value));
    }

    if (clauses.length === 0) {
      return { where: "", params: [] };
    }

    return {
      where: `WHERE ${clauses.join(" AND ")}`,
      params,
    };
  }

  async insert(vectors: number[][], ids: string[], payloads: Record<string, unknown>[]): Promise<void> {
    await this.ensureInitialized();

    for (let i = 0; i < vectors.length; i += 1) {
      const vector = vectors[i] || [];
      if (vector.length !== this.dimension) {
        throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`);
      }

      const id = ids[i];
      const payload = payloads[i] || {};

      await query(
        `INSERT INTO ${this.tableName} (id, embedding, payload, updated_at)
         VALUES ($1, $2::vector, $3::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [id, toPgVectorLiteral(vector), JSON.stringify(payload)],
      );
    }
  }

  async search(queryVector: number[], limit = 10, filters?: Record<string, unknown>): Promise<Array<{ id: string; payload: Record<string, unknown>; score: number }>> {
    await this.ensureInitialized();

    if (queryVector.length !== this.dimension) {
      throw new Error(`Query dimension mismatch. Expected ${this.dimension}, got ${queryVector.length}`);
    }

    const maxLimit = Math.max(1, Math.min(200, Math.floor(limit || 10)));
    const vectorLiteral = toPgVectorLiteral(queryVector);
    const filter = this.buildFilterWhere(filters, 2);

    const sql = `SELECT id, payload, 1 - (embedding <=> $1::vector) AS score
                 FROM ${this.tableName}
                 ${filter.where}
                 ORDER BY embedding <=> $1::vector ASC
                 LIMIT $${filter.params.length + 2}`;

    const result = await query<{ id: string; payload: Record<string, unknown>; score: number }>(
      sql,
      [vectorLiteral, ...filter.params, maxLimit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      payload: parseMetadata(row.payload),
      score: Number(row.score || 0),
    }));
  }

  async get(vectorId: string): Promise<{ id: string; payload: Record<string, unknown> } | null> {
    await this.ensureInitialized();

    const result = await query<{ id: string; payload: Record<string, unknown> }>(
      `SELECT id, payload
       FROM ${this.tableName}
       WHERE id = $1
       LIMIT 1`,
      [vectorId],
    );

    if (!result.rows[0]) return null;
    return {
      id: result.rows[0].id,
      payload: parseMetadata(result.rows[0].payload),
    };
  }

  async update(vectorId: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    await this.ensureInitialized();

    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`);
    }

    await query(
      `UPDATE ${this.tableName}
       SET embedding = $2::vector,
           payload = $3::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [vectorId, toPgVectorLiteral(vector), JSON.stringify(payload)],
    );
  }

  async delete(vectorId: string): Promise<void> {
    await this.ensureInitialized();
    await query(`DELETE FROM ${this.tableName} WHERE id = $1`, [vectorId]);
  }

  async deleteCol(): Promise<void> {
    await this.ensureInitialized();
    await query(`TRUNCATE TABLE ${this.tableName}`);
  }

  async list(filters?: Record<string, unknown>, limit = 100): Promise<[Array<{ id: string; payload: Record<string, unknown> }>, number]> {
    await this.ensureInitialized();

    const maxLimit = Math.max(1, Math.min(500, Math.floor(limit || 100)));
    const filter = this.buildFilterWhere(filters);

    const listSql = `SELECT id, payload
                     FROM ${this.tableName}
                     ${filter.where}
                     ORDER BY updated_at DESC
                     LIMIT $${filter.params.length + 1}`;

    const rows = await query<{ id: string; payload: Record<string, unknown> }>(
      listSql,
      [...filter.params, maxLimit],
    );

    const countSql = `SELECT count(*)::int AS total
                      FROM ${this.tableName}
                      ${filter.where}`;

    const total = await query<{ total: number }>(countSql, filter.params);

    return [
      rows.rows.map((row) => ({ id: row.id, payload: parseMetadata(row.payload) })),
      total.rows[0]?.total ?? 0,
    ];
  }

  async getUserId(): Promise<string> {
    await this.ensureInitialized();
    if (this.cachedUserId) return this.cachedUserId;

    const existing = await query<{ user_id: string }>(`SELECT user_id FROM ${MEM0_META_TABLE} WHERE id = 1 LIMIT 1`);
    if (existing.rows[0]?.user_id) {
      this.cachedUserId = existing.rows[0].user_id;
      return this.cachedUserId;
    }

    const generated = crypto.randomUUID();
    await query(
      `INSERT INTO ${MEM0_META_TABLE} (id, user_id, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
      [generated],
    );
    this.cachedUserId = generated;
    return generated;
  }

  async setUserId(userId: string): Promise<void> {
    await this.ensureInitialized();
    await query(
      `INSERT INTO ${MEM0_META_TABLE} (id, user_id, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
      [userId],
    );
    this.cachedUserId = userId;
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }
}

function createSqliteBackend(config: JoiConfig): Mem0Client {
  const basePath = getMem0BasePath();
  fs.mkdirSync(basePath, { recursive: true });

  // Mem0 telemetry can block local search/add calls when network egress is flaky.
  // Default it off for JOI local runtime unless explicitly enabled by env.
  if (!process.env.MEM0_TELEMETRY) process.env.MEM0_TELEMETRY = "false";
  // Some mem0/ollama code paths fall back to env-based host resolution.
  // Keep these aligned with JOI config to avoid accidental localhost fallback.
  if (!process.env.OLLAMA_HOST) process.env.OLLAMA_HOST = config.memory.ollamaUrl;
  if (!process.env.OLLAMA_BASE_URL) process.env.OLLAMA_BASE_URL = config.memory.ollamaUrl;
  if (!process.env.OLLAMA_URL) process.env.OLLAMA_URL = config.memory.ollamaUrl;

  const historyDbPath = path.join(basePath, "mem0-history.db");
  const vectorDbPath = path.join(basePath, "mem0-vector-store.db");
  ensureWritableFile(historyDbPath);
  ensureWritableFile(vectorDbPath);

  const { Memory: Mem0LocalMemory } = require("mem0ai/oss") as {
    Memory: new (options: Record<string, unknown>) => Mem0Client;
  };

  return new Mem0LocalMemory({
    version: "v1.1",
    historyDbPath,
    embedder: {
      provider: "ollama",
      config: {
        host: config.memory.ollamaUrl,
        url: config.memory.ollamaUrl,
        model: config.memory.embeddingModel,
        embeddingDims: config.memory.embeddingDimension,
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "joi_memories",
        dimension: config.memory.embeddingDimension,
        dbPath: vectorDbPath,
      },
    },
    // Use OpenAI-compatible config for LLM to avoid mem0 OSS ollama-LLM host bugs.
    // JOI uses infer=false for conversation ingest, so this path is mostly dormant.
    llm: {
      provider: "openai",
      config: {
        baseURL: `${config.memory.ollamaUrl.replace(/\/+$/, "")}/v1`,
        apiKey: "ollama",
        model: "gpt-4o-mini",
      },
    },
  });
}

function createPgvectorBackend(config: JoiConfig): Mem0Client {
  // Keep env host fallbacks aligned with JOI config
  if (!process.env.MEM0_TELEMETRY) process.env.MEM0_TELEMETRY = "false";
  if (!process.env.OLLAMA_HOST) process.env.OLLAMA_HOST = config.memory.ollamaUrl;
  if (!process.env.OLLAMA_BASE_URL) process.env.OLLAMA_BASE_URL = config.memory.ollamaUrl;
  if (!process.env.OLLAMA_URL) process.env.OLLAMA_URL = config.memory.ollamaUrl;

  const { Memory: Mem0LocalMemory } = require("mem0ai/oss") as {
    Memory: new (options: Record<string, unknown>) => Mem0Client & { vectorStore?: unknown; collectionName?: string };
  };

  // Mem0 OSS currently requires a vector store provider at construction time.
  // We bootstrap with a minimal langchain-compatible stub, then replace vectorStore
  // with a pgvector-backed adapter that supports filters and CRUD.
  const langchainBootstrapStore = {
    addVectors: async () => {},
    similaritySearchVectorWithScore: async () => [],
    delete: async () => {},
  };

  const tableName = readMem0PgvectorTableName();

  const client = new Mem0LocalMemory({
    version: "v1.1",
    disableHistory: true,
    embedder: {
      provider: "ollama",
      config: {
        host: config.memory.ollamaUrl,
        url: config.memory.ollamaUrl,
        model: config.memory.embeddingModel,
        embeddingDims: config.memory.embeddingDimension,
      },
    },
    vectorStore: {
      provider: "langchain",
      config: {
        client: langchainBootstrapStore,
        dimension: config.memory.embeddingDimension,
      },
    },
    llm: {
      provider: "openai",
      config: {
        baseURL: `${config.memory.ollamaUrl.replace(/\/+$/, "")}/v1`,
        apiKey: "ollama",
        model: "gpt-4o-mini",
      },
    },
  });

  client.vectorStore = new PgVectorMem0Store(tableName, config.memory.embeddingDimension);
  client.collectionName = tableName;

  return client;
}

function getBackend(config: JoiConfig): Mem0Backend | null {
  if (!config.memory.mem0.enabled) return null;

  const key = buildBackendKey(config);
  if (cachedBackend && cachedBackend.key === key) return cachedBackend.backend;

  try {
    const backendMode = readMem0VectorBackend();
    const backend: Mem0Backend = {
      client: backendMode === "sqlite"
        ? createSqliteBackend(config)
        : createPgvectorBackend(config),
    };
    cachedBackend = { key, backend };
    warnedInitError = false;
    lastInitError = null;
    return backend;
  } catch (err) {
    lastInitError = err instanceof Error ? err.message : String(err);
    if (!warnedInitError) {
      console.warn("[Mem0] backend init failed:", err);
      warnedInitError = true;
    }
    return null;
  }
}

export function isMem0Enabled(config: JoiConfig): boolean {
  return getBackend(config) !== null;
}

export function getMem0RuntimeStatus(config: JoiConfig): {
  configured: boolean;
  active: boolean;
  error: string | null;
} {
  if (!config.memory.mem0.enabled) {
    return {
      configured: false,
      active: false,
      error: null,
    };
  }

  const backend = getBackend(config);
  return {
    configured: true,
    active: backend !== null,
    error: backend ? null : (lastInitError || "Mem0 backend initialization failed"),
  };
}

export async function searchMem0(
  config: JoiConfig,
  queryText: string,
  options: {
    areas?: MemoryArea[];
    limit?: number;
    agentId?: string;
    runId?: string;
    tenantScope?: string;
    companyId?: string;
    contactId?: string;
  } = {},
): Promise<Mem0SearchHit[]> {
  const backend = getBackend(config);
  if (!backend) return [];

  try {
    const limit = options.limit || 10;
    const primaryBase = buildMem0RequestBase(config, {
      agentId: options.agentId,
      runId: options.runId,
      tenantScope: options.tenantScope,
      companyId: options.companyId,
      contactId: options.contactId,
    });

    const raw = await backend.client.search(queryText, {
      ...primaryBase,
      limit,
    });

    let hits = raw.results
      .map((r) => mapLocalHit(r as unknown as Record<string, unknown>))
      .filter((h) => Boolean(h.content));

    // Backward-compatible personal scope fallback:
    // allow reads of legacy rows that were stored before explicit scope metadata existed.
    if (hits.length === 0 && options.tenantScope === "personal") {
      const legacyBase = buildMem0RequestBase(config, {
        agentId: options.agentId,
        runId: options.runId,
        companyId: options.companyId,
        contactId: options.contactId,
      });
      const legacyRaw = await backend.client.search(queryText, {
        ...legacyBase,
        limit,
      });
      hits = legacyRaw.results
        .map((r) => mapLocalHit(r as unknown as Record<string, unknown>))
        .filter((h) => Boolean(h.content))
        .filter((h) => {
          const scope = typeof h.metadata.scope === "string"
            ? h.metadata.scope.trim().toLowerCase()
            : "";
          return !scope || scope === "personal";
        });
    }

    if (options.areas && options.areas.length > 0) {
      const allowed = new Set(options.areas.map((a) => String(a).toLowerCase()));
      hits = hits.filter((h) => {
        const area = String(h.metadata.area || "").toLowerCase();
        return area ? allowed.has(area) : false;
      });
    }

    return hits;
  } catch (err) {
    console.warn("[Mem0] search failed:", err);
    return [];
  }
}

export async function storeMemoryInMem0(
  config: JoiConfig,
  input: {
    content: string;
    area: MemoryArea;
    summary?: string;
    tags?: string[];
    confidence?: number;
    source?: MemorySource;
    conversationId?: string;
    agentId?: string;
    tenantScope?: string;
    companyId?: string;
    contactId?: string;
  },
): Promise<Mem0SearchHit | null> {
  const backend = getBackend(config);
  if (!backend) return null;

  const content = input.content.trim();
  if (!content) return null;

  const payload = [content, input.summary ? `Summary: ${input.summary.trim()}` : ""]
    .filter(Boolean)
    .join("\n");

  const metadata: Mem0ContextPayload = {
    source: "joi_memory_store",
    area: input.area,
    summary: input.summary,
    tags: input.tags,
    confidence: input.confidence,
    memorySource: input.source,
    conversationId: input.conversationId,
    agentId: input.agentId,
    tenantScope: input.tenantScope,
    companyId: input.companyId,
    contactId: input.contactId,
  };

  try {
    const base = buildMem0RequestBase(config, {
      agentId: input.agentId,
      runId: input.conversationId,
      tenantScope: input.tenantScope,
      companyId: input.companyId,
      contactId: input.contactId,
    });

    const baseMetadata = parseMetadata(base.metadata);

    const raw = await backend.client.add(
      [{ role: "user", content: payload }],
      {
        ...base,
        infer: false,
        metadata: {
          ...baseMetadata,
          ...metadata,
        },
      },
    );

    const firstId = raw.results[0]?.id;
    if (!firstId) return null;

    const fetched = await backend.client.get(firstId).catch(() => null);
    if (!fetched) {
      const now = new Date();
      return {
        id: firstId,
        content,
        score: 0,
        categories: [],
        metadata: { ...baseMetadata, ...metadata },
        createdAt: now,
        updatedAt: now,
      };
    }

    return mapLocalHit(fetched as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn("[Mem0] store failed:", err);
    return null;
  }
}

export async function ingestConversationToMem0(
  config: JoiConfig,
  input: {
    conversationId: string;
    agentId: string;
    userMessage: string;
    assistantResponse: string;
    toolCount?: number;
    tenantScope?: string;
    companyId?: string;
    contactId?: string;
  },
): Promise<void> {
  const backend = getBackend(config);
  if (!backend) return;

  const userText = input.userMessage.trim();
  if (!userText) return;
  const assistantText = input.assistantResponse.trim();

  const metadata: Mem0ContextPayload = {
    source: "joi_chat_turn",
    conversationId: input.conversationId,
    agentId: input.agentId,
    tenantScope: input.tenantScope,
    companyId: input.companyId,
    contactId: input.contactId,
    toolCount: input.toolCount || 0,
  };

  try {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: userText },
    ];
    if (assistantText) messages.push({ role: "assistant", content: assistantText });

    const base = buildMem0RequestBase(config, {
      agentId: input.agentId,
      runId: input.conversationId,
      tenantScope: input.tenantScope,
      companyId: input.companyId,
      contactId: input.contactId,
    });

    const baseMetadata = parseMetadata(base.metadata);

    await backend.client.add(messages, {
      ...base,
      // Keep mode robust without requiring extra chat models in Ollama.
      infer: false,
      metadata: {
        ...baseMetadata,
        ...metadata,
      },
    });
  } catch (err) {
    console.warn("[Mem0] conversation ingest failed:", err);
  }
}

export async function updateMem0Memory(
  config: JoiConfig,
  memoryId: string,
  updates: {
    text?: string;
    metadataPatch?: Record<string, unknown>;
  },
): Promise<Mem0SearchHit | null> {
  const backend = getBackend(config);
  if (!backend) return null;

  try {
    const existing = await backend.client.get(memoryId);
    if (!existing) return null;

    const existingObj = existing as unknown as Record<string, unknown>;
    const currentText = parseText(existingObj.memory);
    const mergedMetadata = {
      ...parseMetadata(existingObj.metadata),
      ...(updates.metadataPatch || {}),
    };

    const nextText = updates.text ?? currentText;
    const localAny = backend.client as any;
    if (typeof localAny.updateMemory === "function") {
      await localAny.updateMemory(memoryId, nextText, {}, mergedMetadata);
    } else {
      await backend.client.update(memoryId, nextText);
    }

    const refreshed = await backend.client.get(memoryId);
    if (!refreshed) return null;
    return mapLocalHit(refreshed as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn("[Mem0] update failed:", err);
    return null;
  }
}

export async function setMem0MemoryPinned(
  config: JoiConfig,
  memoryId: string,
  pinned: boolean,
): Promise<Mem0SearchHit | null> {
  return updateMem0Memory(config, memoryId, {
    metadataPatch: { pinned },
  });
}

export async function deleteMem0Memory(
  config: JoiConfig,
  memoryId: string,
): Promise<boolean> {
  const backend = getBackend(config);
  if (!backend) return false;

  try {
    await backend.client.delete(memoryId);
    return true;
  } catch (err) {
    console.warn("[Mem0] delete failed:", err);
    return false;
  }
}

export async function loadMem0SessionContext(
  config: JoiConfig,
  scope: {
    tenantScope?: string;
    companyId?: string;
    contactId?: string;
  } = {},
): Promise<{
  identity: string[];
  preferences: string[];
  solutions: string[];
  recentEpisodes: string[];
}> {
  const backend = getBackend(config);
  if (!backend) {
    return { identity: [], preferences: [], solutions: [], recentEpisodes: [] };
  }

  const limit = Math.max(3, Math.min(20, config.memory.mem0.sessionContextLimit || 8));

  const [identity, preferences, solutions, recentEpisodes] = await Promise.all([
    searchMem0(config, "stable user identity facts such as name, role, key relationships", {
      limit,
      tenantScope: scope.tenantScope,
      companyId: scope.companyId,
      contactId: scope.contactId,
    }),
    searchMem0(config, "explicit user preferences for communication, workflow, tools, and style", {
      limit,
      tenantScope: scope.tenantScope,
      companyId: scope.companyId,
      contactId: scope.contactId,
    }),
    searchMem0(config, "solutions and approaches that worked well previously", {
      limit,
      tenantScope: scope.tenantScope,
      companyId: scope.companyId,
      contactId: scope.contactId,
    }),
    searchMem0(config, "recent context and active threads from latest conversations", {
      limit,
      tenantScope: scope.tenantScope,
      companyId: scope.companyId,
      contactId: scope.contactId,
    }),
  ]);

  return {
    identity: dedupeLines(identity.map((h) => truncateLine(h.content)), limit),
    preferences: dedupeLines(preferences.map((h) => truncateLine(h.content)), limit),
    solutions: dedupeLines(solutions.map((h) => truncateLine(h.content)), limit),
    recentEpisodes: dedupeLines(recentEpisodes.map((h) => truncateLine(h.content)), limit),
  };
}
