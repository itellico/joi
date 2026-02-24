// Memory Searcher: Hybrid BM25 + vector search with per-area weights, MMR, temporal decay

import { query } from "../db/client.js";
import { embed } from "./embeddings.js";
import { applyTemporalDecayToScore, ageInDaysFromDate } from "./temporal-decay.js";
import { mmrRerank } from "./mmr.js";
import { loadVerifiedFactsContext } from "./facts.js";
import { isMem0Enabled, loadMem0SessionContext } from "./mem0-engine.js";
import type { JoiConfig } from "../config/schema.js";
import type {
  MemoryArea,
  MemorySearchOptions,
  MemorySearchResult,
  AreaSearchConfig,
} from "./types.js";

const DEFAULT_MEM0_CONTEXT_TIMEOUT_MS = 1500;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T, onTimeout: () => void): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

// Load per-area search config from DB
async function loadAreaConfigs(): Promise<Map<MemoryArea, AreaSearchConfig>> {
  const result = await query<{
    area: MemoryArea;
    vector_weight: number;
    text_weight: number;
    temporal_decay_enabled: boolean;
    half_life_days: number | null;
    min_confidence: number;
  }>("SELECT * FROM memory_search_config");

  const configs = new Map<MemoryArea, AreaSearchConfig>();
  for (const row of result.rows) {
    configs.set(row.area, {
      area: row.area,
      vectorWeight: row.vector_weight,
      textWeight: row.text_weight,
      temporalDecayEnabled: row.temporal_decay_enabled,
      halfLifeDays: row.half_life_days,
      minConfidence: row.min_confidence,
    });
  }
  return configs;
}

// Fallback config if DB not seeded
const FALLBACK_CONFIGS: Record<MemoryArea, AreaSearchConfig> = {
  identity:    { area: "identity",    vectorWeight: 0.3, textWeight: 0.7, temporalDecayEnabled: false, halfLifeDays: null, minConfidence: 0.1 },
  preferences: { area: "preferences", vectorWeight: 0.3, textWeight: 0.7, temporalDecayEnabled: true,  halfLifeDays: 180,  minConfidence: 0.2 },
  knowledge:   { area: "knowledge",   vectorWeight: 0.6, textWeight: 0.4, temporalDecayEnabled: true,  halfLifeDays: 60,   minConfidence: 0.3 },
  solutions:   { area: "solutions",   vectorWeight: 0.8, textWeight: 0.2, temporalDecayEnabled: true,  halfLifeDays: 120,  minConfidence: 0.3 },
  episodes:    { area: "episodes",    vectorWeight: 0.4, textWeight: 0.3, temporalDecayEnabled: true,  halfLifeDays: 14,   minConfidence: 0.2 },
};

interface RawSearchRow {
  id: string;
  area: MemoryArea;
  content: string;
  summary: string | null;
  tags: string[];
  confidence: number;
  access_count: number;
  reinforcement_count: number;
  source: string;
  conversation_id: string | null;
  channel_id: string | null;
  project_id: string | null;
  scope: string | null;
  visibility: string;
  pinned: boolean;
  superseded_by: string | null;
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date;
  expires_at: Date | null;
  vector_score: number | null;
  text_score: number | null;
}

export async function searchMemories(
  options: MemorySearchOptions,
  config: JoiConfig,
): Promise<MemorySearchResult[]> {
  const {
    query: searchQuery, areas, limit = 10, minConfidence, includeSuperseded = false,
    scope, visibility, tags,
  } = options;

  // Load area configs
  let areaConfigs: Map<MemoryArea, AreaSearchConfig>;
  try {
    areaConfigs = await loadAreaConfigs();
  } catch {
    areaConfigs = new Map(Object.entries(FALLBACK_CONFIGS) as [MemoryArea, AreaSearchConfig][]);
  }

  // Default search scope is the operational memory subset.
  // Identity/preferences should come from verified Facts, not inferred memory rows.
  const targetAreas = areas || (["knowledge", "solutions", "episodes"] as MemoryArea[]);

  // Generate query embedding
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embed(searchQuery, config);
  } catch (err) {
    console.warn("Failed to embed query, falling back to FTS only:", err);
  }

  const allResults: MemorySearchResult[] = [];

  // Normalize scope filter to array
  const scopeFilter: string[] | null = scope
    ? (Array.isArray(scope) ? scope : [scope])
    : null;

  // Search each area with its specific weights
  for (const area of targetAreas) {
    const areaConfig = areaConfigs.get(area) || FALLBACK_CONFIGS[area];
    const effectiveMinConfidence = minConfidence ?? areaConfig.minConfidence;

    // Build query parts
    const conditions: string[] = [`area = '${area}'`];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (!includeSuperseded) {
      conditions.push("superseded_by IS NULL");
    }

    conditions.push(`confidence >= $${paramIdx++}`);
    params.push(effectiveMinConfidence);

    // Check for expired memories
    conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);

    // Scope filter: match specific scopes OR include unscoped (global) rows
    if (scopeFilter && scopeFilter.length > 0) {
      conditions.push(`(scope = ANY($${paramIdx}::text[]) OR scope IS NULL)`);
      params.push(scopeFilter);
      paramIdx++;
    }

    // Visibility filter
    if (visibility) {
      conditions.push(`visibility = $${paramIdx++}`);
      params.push(visibility);
    }

    // Tag filter: memories must contain ALL specified tags
    if (tags && tags.length > 0) {
      conditions.push(`tags @> $${paramIdx++}::text[]`);
      params.push(tags);
    }

    const whereClause = conditions.join(" AND ");

    // Combined query: vector similarity + FTS rank
    let sql: string;
    if (queryEmbedding) {
      params.push(`[${queryEmbedding.join(",")}]`);
      const embeddingParam = paramIdx++;

      params.push(searchQuery);
      const queryParam = paramIdx++;

      sql = `
        SELECT *,
          CASE WHEN embedding IS NOT NULL
            THEN 1 - (embedding <=> $${embeddingParam}::vector)
            ELSE 0
          END AS vector_score,
          ts_rank(fts, websearch_to_tsquery('english', $${queryParam})) AS text_score
        FROM memories
        WHERE ${whereClause}
        ORDER BY
          (CASE WHEN embedding IS NOT NULL
            THEN 1 - (embedding <=> $${embeddingParam}::vector)
            ELSE 0
          END) * ${areaConfig.vectorWeight} +
          ts_rank(fts, websearch_to_tsquery('english', $${queryParam})) * ${areaConfig.textWeight}
          DESC
        LIMIT 20
      `;
    } else {
      // FTS only fallback
      params.push(searchQuery);
      const queryParam = paramIdx++;

      sql = `
        SELECT *,
          0 AS vector_score,
          ts_rank(fts, websearch_to_tsquery('english', $${queryParam})) AS text_score
        FROM memories
        WHERE ${whereClause}
          AND fts @@ websearch_to_tsquery('english', $${queryParam})
        ORDER BY text_score DESC
        LIMIT 20
      `;
    }

    const result = await query<RawSearchRow>(sql, params);

    for (const row of result.rows) {
      const vectorScore = Number(row.vector_score) || 0;
      const textScore = Number(row.text_score) || 0;

      // Weighted merge
      let score = areaConfig.vectorWeight * vectorScore + areaConfig.textWeight * textScore;

      // Skip zero-score results
      if (score <= 0) continue;

      // Apply temporal decay
      let decayMultiplier = 1;
      if (areaConfig.temporalDecayEnabled && areaConfig.halfLifeDays && !row.pinned) {
        const ageInDays = ageInDaysFromDate(new Date(row.created_at));
        decayMultiplier = Math.exp(-(Math.LN2 / areaConfig.halfLifeDays) * ageInDays);
        score = score * decayMultiplier;
      }

      // Confidence weighting
      score = score * row.confidence;

      allResults.push({
        memory: {
          id: row.id,
          area: row.area,
          content: row.content,
          summary: row.summary,
          tags: row.tags || [],
          confidence: row.confidence,
          accessCount: row.access_count,
          reinforcementCount: row.reinforcement_count,
          source: row.source as any,
          conversationId: row.conversation_id,
          channelId: row.channel_id,
          projectId: row.project_id,
          scope: row.scope || null,
          visibility: (row.visibility || "shared") as any,
          pinned: row.pinned,
          supersededBy: row.superseded_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          lastAccessedAt: new Date(row.last_accessed_at),
          expiresAt: row.expires_at ? new Date(row.expires_at) : null,
        },
        score,
        vectorScore,
        textScore,
        decayMultiplier,
        matchedArea: area,
      });
    }
  }

  // Sort by score
  allResults.sort((a, b) => b.score - a.score);

  // Apply MMR re-ranking for diversity
  if (config.memory.mmr.enabled && allResults.length > 1) {
    const mmrItems = allResults.map((r, i) => ({
      id: r.memory.id || String(i),
      score: r.score,
      content: r.memory.content,
      _original: r,
    }));

    const reranked = mmrRerank(mmrItems, {
      enabled: true,
      lambda: config.memory.mmr.lambda,
    });

    const rerankedResults = reranked.map((item) => (item as any)._original as MemorySearchResult);
    // Update access timestamps for returned results
    const topResults = rerankedResults.slice(0, limit);
    updateAccessTimestamps(topResults.map((r) => r.memory.id));
    return topResults;
  }

  const topResults = allResults.slice(0, limit);
  updateAccessTimestamps(topResults.map((r) => r.memory.id));
  return topResults;
}

// Update access timestamps in background (don't await)
function updateAccessTimestamps(ids: string[]): void {
  if (ids.length === 0) return;
  query(
    `UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW()
     WHERE id = ANY($1)`,
    [ids],
  ).catch(() => { /* non-critical */ });
}

function uniqueLines(lines: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(line.trim());
    if (out.length >= limit) break;
  }
  return out;
}

// Load session context: identity + preferences + solutions + recent episodes
export async function loadSessionContext(config: JoiConfig): Promise<{
  identity: string[];
  preferences: string[];
  solutions: string[];
  recentEpisodes: string[];
}> {
  return loadSessionContextScoped(config, {});
}

export async function loadSessionContextScoped(
  config: JoiConfig,
  scope: {
    tenantScope?: string;
    companyId?: string;
    contactId?: string;
  },
): Promise<{
  identity: string[];
  preferences: string[];
  solutions: string[];
  recentEpisodes: string[];
}> {
  if (isMem0Enabled(config)) {
    const emptyMem0Context = {
      identity: [] as string[],
      preferences: [] as string[],
      solutions: [] as string[],
      recentEpisodes: [] as string[],
    };
    const mem0TimeoutMs = readPositiveIntEnv("JOI_MEM0_CONTEXT_TIMEOUT_MS", DEFAULT_MEM0_CONTEXT_TIMEOUT_MS);

    const [factsContext, mem0Context] = await Promise.all([
      loadVerifiedFactsContext().catch(() => ({ identity: [], preferences: [] })),
      withTimeout(
        loadMem0SessionContext(config, scope).catch((err) => {
          console.warn("[Mem0] session context load failed:", (err as Error).message);
          return emptyMem0Context;
        }),
        mem0TimeoutMs,
        emptyMem0Context,
        () => console.warn(`[Mem0] session context timed out after ${mem0TimeoutMs}ms; continuing without mem0 context`),
      ),
    ]);
    return {
      identity: uniqueLines([...factsContext.identity, ...mem0Context.identity], 12),
      preferences: uniqueLines([...factsContext.preferences, ...mem0Context.preferences], 12),
      solutions: uniqueLines(mem0Context.solutions, 12),
      recentEpisodes: uniqueLines(mem0Context.recentEpisodes, 12),
    };
  }

  const factsContext = await loadVerifiedFactsContext();

  // Learned solutions/approaches by confidence + reinforcement
  const solutionsResult = await query<{ content: string; summary: string | null }>(
    `SELECT content, summary FROM memories
     WHERE area = 'solutions' AND superseded_by IS NULL AND confidence >= 0.3
     ORDER BY confidence DESC, reinforcement_count DESC LIMIT 10`,
  );

  // Last 3 days of episodes
  const episodesResult = await query<{ content: string; summary: string | null; created_at: Date }>(
    `SELECT content, summary, created_at FROM memories
     WHERE area = 'episodes' AND superseded_by IS NULL
       AND created_at >= NOW() - INTERVAL '3 days'
     ORDER BY created_at DESC LIMIT 10`,
  );

  return {
    identity: uniqueLines(factsContext.identity, 12),
    preferences: uniqueLines(factsContext.preferences, 12),
    solutions: uniqueLines(solutionsResult.rows.map((r) => r.summary || r.content), 12),
    recentEpisodes: uniqueLines(episodesResult.rows.map((r) => r.summary || r.content), 12),
  };
}
