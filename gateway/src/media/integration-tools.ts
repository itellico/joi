// Emby + Jellyseerr agent tools
// Credentials are loaded from channel_configs:
// - channel_type='emby'      -> { serverUrl, apiKey, userId? }
// - channel_type='jellyseerr'-> { serverUrl, apiKey }

import type Anthropic from "@anthropic-ai/sdk";
import { query as dbQuery } from "../db/client.js";
import type { ToolContext } from "../agent/tools.js";
import { getMediaWebhookActivity } from "../channels/media-webhooks.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

type IntegrationType = "emby" | "jellyseerr";

interface ChannelConfigRow {
  id: string;
  display_name: string | null;
  config: Record<string, unknown>;
}

interface EmbyConfig {
  id: string;
  label: string;
  serverUrl: string;
  apiKey: string;
  userId?: string;
}

interface JellyseerrConfig {
  id: string;
  label: string;
  serverUrl: string;
  apiKey: string;
}

const handlers = new Map<string, ToolHandler>();
const REQUEST_TIMEOUT_MS = 20_000;
const READ_CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 400;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const COMPACT_DEFAULT_LIMIT = 20;
const COMPACT_MAX_LIMIT = 60;
const LIST_LIMIT_MAX = 200;
const WEBHOOK_ACTIVITY_DEFAULT_LIMIT = 30;

interface FetchJsonOptions {
  cacheTtlMs?: number;
  retries?: number;
}

interface CachedEntry {
  expiresAt: number;
  value: unknown;
}

class HttpStatusError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  readonly requestUrl: string;

  constructor(status: number, bodySnippet: string, requestUrl: string) {
    super(`HTTP ${status}: ${bodySnippet}`);
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.requestUrl = requestUrl;
  }
}

const readCache = new Map<string, CachedEntry>();

function toLowerText(value: unknown): string {
  return (asString(value) || "").toLowerCase();
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = toLowerText(value);
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function toBoundedInt(
  value: unknown,
  fieldName: string,
  {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    fallback,
  }: { min?: number; max?: number; fallback?: number } = {},
): number {
  const hasValue = value !== undefined && value !== null && value !== "";
  if (!hasValue && fallback !== undefined) return fallback;
  const parsed = toInteger(hasValue ? value : fallback, fieldName);
  return Math.min(max, Math.max(min, parsed));
}

function normalizeListLimit(value: unknown, fallback = COMPACT_DEFAULT_LIMIT): number {
  return toBoundedInt(value, "limit", { min: 1, max: LIST_LIMIT_MAX, fallback });
}

function normalizeStartIndex(value: unknown): number {
  return toBoundedInt(value, "startIndex", { min: 0, max: 500_000, fallback: 0 });
}

function shouldCompact(input: unknown): boolean {
  const record = typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return toBoolean(record.compact, true);
}

function compactLimitFromInput(input: unknown, fallback = COMPACT_DEFAULT_LIMIT): number {
  const record = typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return toBoundedInt(record.compactLimit, "compactLimit", {
    min: 1,
    max: COMPACT_MAX_LIMIT,
    fallback,
  });
}

function stableKey(url: string, init?: RequestInit): string {
  const method = (init?.method || "GET").toUpperCase();
  const headers = init?.headers ? JSON.stringify(init.headers) : "";
  const body = typeof init?.body === "string" ? init.body : "";
  return `${method}|${url}|${headers}|${body}`;
}

function pruneCacheIfNeeded(): void {
  if (readCache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of readCache.entries()) {
    if (entry.expiresAt <= now) readCache.delete(key);
  }
  if (readCache.size <= CACHE_MAX_ENTRIES) return;

  const entries = Array.from(readCache.entries())
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (const [key] of entries) {
    readCache.delete(key);
    if (readCache.size <= CACHE_MAX_ENTRIES) break;
  }
}

function getCachedValue<T>(key: string): T | null {
  const hit = readCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    readCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function setCachedValue(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  readCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  pruneCacheIfNeeded();
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpStatusError) return isRetryableHttpStatus(err.status);
  if (!(err instanceof Error)) return false;
  const text = err.message.toLowerCase();
  return text.includes("aborted")
    || text.includes("timeout")
    || text.includes("network")
    || text.includes("fetch failed")
    || text.includes("socket");
}

function formatUpstreamError(err: unknown): Error {
  if (!(err instanceof HttpStatusError)) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Upstream request failed: ${message}`);
  }

  const hint =
    err.status === 401 || err.status === 403
      ? "Authentication failed. Check API key."
      : err.status === 404
        ? "Resource or endpoint not found on upstream server."
        : err.status === 400
          ? "Request was rejected by upstream API."
          : err.status === 429
            ? "Upstream rate limit reached."
            : err.status >= 500
              ? "Upstream service error."
              : "Upstream request failed.";
  return new Error(`${hint} ${err.message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeJellyRequestStatus(raw: unknown): string | null {
  const normalized = toLowerText(raw);
  if (!normalized) return "all";
  const statusAliases: Record<string, string> = {
    all: "all",
    pending: "pending",
    approved: "approved",
    available: "available",
    processing: "processing",
    unavailable: "unavailable",
    failed: "failed",
    deleted: "deleted",
    completed: "completed",
    declined: "failed",
    rejected: "failed",
    cancelled: "deleted",
    canceled: "deleted",
    done: "completed",
    complete: "completed",
    running: "processing",
    "in-progress": "processing",
    "in progress": "processing",
  };
  return statusAliases[normalized] || null;
}

type CompactListEnvelope<T> = {
  compact: boolean;
  count: number;
  returned: number;
  hasMore: boolean;
  items: T[];
};

export function compactList<T>(items: T[], compact: boolean, compactLimit: number): CompactListEnvelope<T> {
  const safeItems = Array.isArray(items) ? items : [];
  if (!compact) {
    return {
      compact: false,
      count: safeItems.length,
      returned: safeItems.length,
      hasMore: false,
      items: safeItems,
    };
  }
  const limit = Math.max(1, Math.min(COMPACT_MAX_LIMIT, compactLimit));
  const sliced = safeItems.slice(0, limit);
  return {
    compact: true,
    count: safeItems.length,
    returned: sliced.length,
    hasMore: safeItems.length > sliced.length,
    items: sliced,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeServerUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function toInteger(value: unknown, fieldName: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return Math.trunc(n);
}

function toOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return toInteger(value, "value");
}

function toMediaType(value: unknown, fallback: "movie" | "series" | "all" = "all"): "movie" | "series" | "all" {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return fallback;
  if (["movie", "movies", "film", "films"].includes(raw)) return "movie";
  if (["series", "show", "shows", "tv", "episode", "episodes"].includes(raw)) return "series";
  if (["all", "any"].includes(raw)) return "all";
  return fallback;
}

function toJellyMediaType(
  value: unknown,
  fallback: "movie" | "tv" | "all" = "all",
): "movie" | "tv" | "all" {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return fallback;
  if (["movie", "movies", "film", "films"].includes(raw)) return "movie";
  if (["tv", "series", "show", "shows"].includes(raw)) return "tv";
  if (["all", "any"].includes(raw)) return "all";
  return fallback;
}

async function fetchJsonRaw<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpStatusError(response.status, text.slice(0, 300), url);
    }
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  options?: FetchJsonOptions,
): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const retries = Math.max(1, Math.min(6, options?.retries ?? RETRY_MAX_ATTEMPTS));
  const cacheTtlMs = options?.cacheTtlMs ?? 0;
  const key = cacheTtlMs > 0 && method === "GET" ? stableKey(url, init) : null;
  if (key) {
    const cached = getCachedValue<T>(key);
    if (cached !== null) return cached;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = await fetchJsonRaw<T>(url, init);
      if (key) setCachedValue(key, payload, cacheTtlMs);
      return payload;
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= retries) {
        throw formatUpstreamError(err);
      }
      const jitter = Math.floor(Math.random() * 120);
      await delay((RETRY_BASE_DELAY_MS * attempt) + jitter);
    }
  }

  throw formatUpstreamError(lastError);
}

async function listConfigs(type: IntegrationType): Promise<ChannelConfigRow[]> {
  const result = await dbQuery<ChannelConfigRow>(
    `SELECT id, display_name, config
       FROM channel_configs
      WHERE channel_type = $1 AND enabled = true
      ORDER BY created_at ASC`,
    [type],
  );
  return result.rows;
}

async function resolveConfig(
  type: IntegrationType,
  server?: string,
): Promise<ChannelConfigRow | null> {
  if (server) {
    const byId = await dbQuery<ChannelConfigRow>(
      `SELECT id, display_name, config
         FROM channel_configs
        WHERE channel_type = $1 AND enabled = true AND id = $2
        LIMIT 1`,
      [type, server],
    );
    if (byId.rows.length > 0) return byId.rows[0];
  }

  const rows = await listConfigs(type);
  return rows[0] || null;
}

function parseEmbyConfig(row: ChannelConfigRow | null): EmbyConfig | null {
  if (!row) return null;
  const serverUrl = asString(row.config.serverUrl ?? row.config.url);
  const apiKey = asString(row.config.apiKey ?? row.config.token);
  const userId = asString(row.config.userId);
  if (!serverUrl || !apiKey) return null;
  return {
    id: row.id,
    label: row.display_name || row.id,
    serverUrl: normalizeServerUrl(serverUrl),
    apiKey,
    userId,
  };
}

function parseJellyseerrConfig(row: ChannelConfigRow | null): JellyseerrConfig | null {
  if (!row) return null;
  const serverUrl = asString(row.config.serverUrl ?? row.config.url);
  const apiKey = asString(row.config.apiKey ?? row.config.token);
  if (!serverUrl || !apiKey) return null;
  return {
    id: row.id,
    label: row.display_name || row.id,
    serverUrl: normalizeServerUrl(serverUrl),
    apiKey,
  };
}

async function getEmbyConfig(server?: string): Promise<EmbyConfig | null> {
  const row = await resolveConfig("emby", server);
  return parseEmbyConfig(row);
}

async function getJellyseerrConfig(server?: string): Promise<JellyseerrConfig | null> {
  const row = await resolveConfig("jellyseerr", server);
  return parseJellyseerrConfig(row);
}

async function getEmbyUserId(config: EmbyConfig): Promise<string | null> {
  if (config.userId) return config.userId;
  try {
    const users = await fetchJson<Array<{ Id: string }>>(
      `${config.serverUrl}/Users?api_key=${encodeURIComponent(config.apiKey)}`,
    );
    return users?.[0]?.Id || null;
  } catch {
    return null;
  }
}

function embyTypeParam(mediaType: "movie" | "series" | "all"): string {
  if (mediaType === "movie") return "Movie";
  if (mediaType === "series") return "Series,Episode";
  return "Movie,Series,Episode";
}

function embySortOrder(raw: unknown): "Ascending" | "Descending" {
  const value = asString(raw)?.toLowerCase();
  return value === "ascending" ? "Ascending" : "Descending";
}

function mapEmbyItem(item: any, serverUrl: string): Record<string, unknown> {
  const people = Array.isArray(item.People)
    ? item.People.map((person: any) => ({
        name: person?.Name,
        type: person?.Type,
      })).filter((person: any) => asString(person?.name))
    : [];
  return {
    id: item.Id,
    name: item.Name,
    type: item.Type,
    overview: item.Overview,
    year: item.ProductionYear,
    premiereDate: item.PremiereDate,
    genres: item.Genres || [],
    people,
    communityRating: item.CommunityRating,
    officialRating: item.OfficialRating,
    runTimeTicks: item.RunTimeTicks,
    playedPercentage: item.UserData?.PlayedPercentage,
    seriesName: item.SeriesName,
    seasonName: item.SeasonName,
    indexNumber: item.IndexNumber,
    parentIndexNumber: item.ParentIndexNumber,
    played: item.UserData?.Played,
    playCount: item.UserData?.PlayCount,
    lastPlayedDate: item.UserData?.LastPlayedDate,
    imageUrl: item.ImageTags?.Primary
      ? `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}`
      : undefined,
    backdropUrl: Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]
      ? `${serverUrl}/Items/${item.Id}/Images/Backdrop?tag=${item.BackdropImageTags[0]}`
      : undefined,
  };
}

function compactEmbyItem(item: Record<string, unknown>): Record<string, unknown> {
  const people = Array.isArray(item.people) ? item.people as Array<Record<string, unknown>> : [];
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    year: item.year,
    mediaType: item.type === "Series" || item.type === "Episode" ? "series" : "movie",
    genres: Array.isArray(item.genres) ? (item.genres as unknown[]).slice(0, 3) : [],
    cast: people
      .filter((person) => toLowerText(person.type).includes("actor") || toLowerText(person.type).includes("guest"))
      .slice(0, 3)
      .map((person) => person.name),
    directors: people
      .filter((person) => toLowerText(person.type) === "director")
      .slice(0, 2)
      .map((person) => person.name),
    communityRating: item.communityRating,
    played: item.played,
    playCount: item.playCount,
    imageUrl: item.imageUrl,
  };
}

function statusNameFromCode(status: number): string {
  const map: Record<number, string> = {
    1: "pending",
    2: "approved",
    3: "declined",
    4: "available",
    5: "processing",
  };
  return map[status] || "unknown";
}

function mapJellyMedia(item: any, defaultType?: "movie" | "tv"): Record<string, unknown> {
  const mediaType = item.mediaType || defaultType || item.type || "movie";
  return {
    id: item.id,
    tmdbId: item.id,
    mediaType,
    title: item.title || item.name,
    overview: item.overview,
    posterUrl: item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : undefined,
    backdropUrl: item.backdropPath
      ? `https://image.tmdb.org/t/p/original${item.backdropPath}`
      : undefined,
    releaseDate: item.releaseDate || item.firstAirDate,
    rating: item.voteAverage,
    status: item.mediaInfo?.status,
    requestStatus: item.mediaInfo?.requests?.[0]?.status,
  };
}

function compactJellyMedia(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: item.id,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
    releaseDate: item.releaseDate,
    rating: item.rating,
    status: item.status,
    requestStatus: item.requestStatus,
    posterUrl: item.posterUrl,
  };
}

function mapJellyRequest(req: any): Record<string, unknown> {
  return {
    id: req.id,
    status: req.status,
    statusName: statusNameFromCode(req.status),
    mediaType: req.type === "movie" ? "movie" : "tv",
    mediaId: req.media?.tmdbId || req.media?.id,
    title: req.media?.title || req.media?.name || "Unknown",
    posterUrl: req.media?.posterPath ? `https://image.tmdb.org/t/p/w500${req.media.posterPath}` : undefined,
    requestedBy: req.requestedBy?.displayName || req.requestedBy?.email || "Unknown",
    requestedDate: req.createdAt,
    modifiedDate: req.updatedAt,
    seasons: req.seasons?.map((s: any) => s.seasonNumber),
  };
}

function mapEmbyPerson(person: any, serverUrl: string): Record<string, unknown> {
  const id = person.Id || person.id;
  return {
    id,
    name: person.Name || person.name,
    type: person.Type || person.type || "Person",
    role: person.Role || person.role,
    imageUrl: id && person.PrimaryImageTag
      ? `${serverUrl}/Items/${id}/Images/Primary?tag=${person.PrimaryImageTag}`
      : undefined,
  };
}

function compactJellyRequest(req: Record<string, unknown>): Record<string, unknown> {
  return {
    id: req.id,
    status: req.status,
    statusName: req.statusName,
    mediaType: req.mediaType,
    mediaId: req.mediaId,
    title: req.title,
    requestedBy: req.requestedBy,
    requestedDate: req.requestedDate,
    seasons: req.seasons,
  };
}

function normalizeLookupKey(value: unknown): string {
  return (asString(value) || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parsePagedInput(
  input: unknown,
  {
    fallbackLimit = COMPACT_DEFAULT_LIMIT,
    maxLimit = LIST_LIMIT_MAX,
  }: { fallbackLimit?: number; maxLimit?: number } = {},
): { limit: number; startIndex: number; compact: boolean; compactLimit: number } {
  const record = typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const limit = toBoundedInt(record.limit, "limit", {
    min: 1,
    max: maxLimit,
    fallback: fallbackLimit,
  });
  const startIndex = normalizeStartIndex(record.startIndex);
  const compact = shouldCompact(input);
  const compactLimit = compactLimitFromInput(input, Math.min(limit, COMPACT_DEFAULT_LIMIT));
  return { limit, startIndex, compact, compactLimit };
}

function applyCompactProjection(
  items: Array<Record<string, unknown>>,
  compact: boolean,
  compactLimit: number,
  projector: (item: Record<string, unknown>) => Record<string, unknown>,
): CompactListEnvelope<Record<string, unknown>> {
  const list = compact ? items.map(projector) : items;
  return compactList(list, compact, compactLimit);
}

// ─── Emby tools ────────────────────────────────────────────────────────────────

handlers.set("emby_servers", async () => {
  const rows = await listConfigs("emby");
  const servers = rows
    .map((row) => parseEmbyConfig(row))
    .filter((row): row is EmbyConfig => row !== null)
    .map((row) => ({
      id: row.id,
      name: row.label,
      serverUrl: row.serverUrl,
      hasUserId: Boolean(row.userId),
    }));
  return { servers, count: servers.length };
});

handlers.set("emby_library", async (input) => {
  const {
    server,
    mediaType = "movie",
    sortBy = "DateCreated",
    sortOrder = "Descending",
  } = (input || {}) as {
    server?: string;
    mediaType?: string;
    sortBy?: string;
    sortOrder?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 50,
  });

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const embyMediaType = toMediaType(mediaType, "movie");
  if (embyMediaType === "all") {
    return { error: "mediaType must be 'movie' or 'series' for library browsing." };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    IncludeItemTypes: embyTypeParam(embyMediaType),
    Recursive: "true",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: asString(sortBy) || "DateCreated",
    SortOrder: embySortOrder(sortOrder),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,Genres,CommunityRating,OfficialRating,DateCreated,People,Studios",
  });

  const data = await fetchJson<{ Items?: any[]; TotalRecordCount?: number }>(
    `${config.serverUrl}/Users/${userId}/Items?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    mediaType: embyMediaType,
    totalCount: data.TotalRecordCount ?? allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("emby_search", async (input) => {
  const {
    server,
    query,
    person,
    actor,
    director,
    writer,
    mode = "auto",
    mediaType = "all",
    sortBy = "SortName",
    sortOrder = "Ascending",
  } = (input || {}) as {
    server?: string;
    query?: string;
    person?: string;
    actor?: string;
    director?: string;
    writer?: string;
    mode?: string;
    mediaType?: string;
    sortBy?: string;
    sortOrder?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 50,
  });

  const searchQuery = asString(query);
  if (!searchQuery) return { error: "query is required." };

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const embyMediaType = toMediaType(mediaType, "all");
  const normalizedMode = asString(mode)?.toLowerCase() || "auto";
  if (!["auto", "title", "person"].includes(normalizedMode)) {
    return { error: "mode must be one of: auto, title, person." };
  }

  const actorInput = asString(actor);
  const directorInput = asString(director);
  const writerInput = asString(writer);
  const explicitPerson = asString(person) || actorInput || directorInput || writerInput;
  let resolvedPersonName: string | undefined;
  if (explicitPerson) {
    resolvedPersonName = explicitPerson;
  } else if (normalizedMode === "person") {
    resolvedPersonName = searchQuery;
  } else if (normalizedMode === "auto") {
    // Auto-detect person lookups when the query likely is a full name and Emby
    // has an exact person match. This enables queries like "movies with Jack Nicholson".
    const looksLikeName = searchQuery.split(/\s+/).filter(Boolean).length >= 2;
    if (looksLikeName) {
      const people = await fetchJson<{ Items?: Array<{ Name?: string }> }>(
        `${config.serverUrl}/Persons?api_key=${encodeURIComponent(config.apiKey)}&SearchTerm=${encodeURIComponent(searchQuery)}&Limit=5`,
      );
      const exact = (people.Items || []).find((item) => {
        const name = asString(item?.Name);
        return Boolean(name) && name!.toLowerCase() === searchQuery.toLowerCase();
      });
      if (exact?.Name) {
        resolvedPersonName = exact.Name;
      }
    }
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    IncludeItemTypes: embyTypeParam(embyMediaType),
    Recursive: "true",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: asString(sortBy) || "SortName",
    SortOrder: embySortOrder(sortOrder),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,Genres,CommunityRating,OfficialRating,People",
  });
  if (resolvedPersonName) {
    params.set("Person", resolvedPersonName);
  } else {
    params.set("SearchTerm", searchQuery);
  }

  const data = await fetchJson<{ Items?: any[] }>(
    `${config.serverUrl}/Users/${userId}/Items?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  let allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));

  const personMatches = (item: Record<string, unknown>, name: string, role?: string): boolean => {
    const people = Array.isArray(item.people) ? item.people as Array<Record<string, unknown>> : [];
    const target = normalizeLookupKey(name);
    if (!target) return false;
    return people.some((entry) => {
      const personName = normalizeLookupKey(entry.name);
      if (!personName || !personName.includes(target)) return false;
      if (!role) return true;
      return toLowerText(entry.type) === role.toLowerCase();
    });
  };

  if (actorInput) {
    allItems = allItems.filter((item) => personMatches(item, actorInput, "Actor"));
  }
  if (directorInput) {
    allItems = allItems.filter((item) => personMatches(item, directorInput, "Director"));
  }
  if (writerInput) {
    allItems = allItems.filter((item) => personMatches(item, writerInput, "Writer"));
  }

  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    query: searchQuery,
    searchMode: resolvedPersonName ? "person" : "title",
    person: resolvedPersonName,
    filters: {
      actor: actorInput || null,
      director: directorInput || null,
      writer: writerInput || null,
    },
    count: allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("emby_item_details", async (input) => {
  const {
    server,
    itemId,
  } = (input || {}) as {
    server?: string;
    itemId?: string;
  };

  const normalizedItemId = asString(itemId);
  if (!normalizedItemId) return { error: "itemId is required." };

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    Fields: "Overview,Genres,CommunityRating,OfficialRating,People,Studios,ExternalUrls",
  });

  const item = await fetchJson<any>(
    `${config.serverUrl}/Users/${userId}/Items/${encodeURIComponent(normalizedItemId)}?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );

  return {
    server: { id: config.id, name: config.label },
    item: mapEmbyItem(item, config.serverUrl),
  };
});

handlers.set("emby_recently_watched", async (input) => {
  const {
    server,
    mediaType = "all",
  } = (input || {}) as {
    server?: string;
    mediaType?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 20,
    maxLimit: 100,
  });

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const embyMediaType = toMediaType(mediaType, "all");
  const params = new URLSearchParams({
    api_key: config.apiKey,
    IncludeItemTypes: embyTypeParam(embyMediaType),
    IsPlayed: "true",
    Recursive: "true",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    StartIndex: String(startIndex),
    Limit: String(limit),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,Genres,CommunityRating,OfficialRating,DatePlayed",
  });

  const data = await fetchJson<{ Items?: any[] }>(
    `${config.serverUrl}/Users/${userId}/Items?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    mediaType: embyMediaType,
    count: allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("emby_continue_watching", async (input) => {
  const {
    server,
  } = (input || {}) as {
    server?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 20,
    maxLimit: 100,
  });

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    StartIndex: String(startIndex),
    Limit: String(limit),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,Genres,CommunityRating,OfficialRating",
  });

  const data = await fetchJson<{ Items?: any[] }>(
    `${config.serverUrl}/Users/${userId}/Items/Resume?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    count: allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("emby_next_up", async (input) => {
  const {
    server,
  } = (input || {}) as {
    server?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 20,
    maxLimit: 100,
  });

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    UserId: userId,
    StartIndex: String(startIndex),
    Limit: String(limit),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,SeriesName,SeasonName",
  });

  const data = await fetchJson<{ Items?: any[] }>(
    `${config.serverUrl}/Shows/NextUp?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    count: allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("emby_now_playing", async (input) => {
  const { server } = (input || {}) as { server?: string };
  const compact = shouldCompact(input);
  const compactLimit = compactLimitFromInput(input, COMPACT_DEFAULT_LIMIT);

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const sessions = await fetchJson<any[]>(
    `${config.serverUrl}/Sessions?api_key=${encodeURIComponent(config.apiKey)}`,
    undefined,
    { cacheTtlMs: 8_000 },
  );
  const allItems = (sessions || [])
    .filter((session) => session.NowPlayingItem)
    .map((session) => ({
      id: session.NowPlayingItem.Id,
      userId: session.UserId,
      userName: session.UserName,
      itemName: session.NowPlayingItem.Name,
      itemType: session.NowPlayingItem.Type,
      playState: {
        positionTicks: session.PlayState?.PositionTicks || 0,
        isPaused: session.PlayState?.IsPaused || false,
      },
      deviceName: session.DeviceName,
      client: session.Client,
    }));
  const projected = compactList(allItems, compact, compactLimit);

  return {
    server: { id: config.id, name: config.label },
    count: allItems.length,
    compact: projected.compact,
    hasMore: projected.hasMore,
    returned: projected.returned,
    items: projected.items,
  };
});

handlers.set("emby_person_search", async (input) => {
  const {
    server,
    query,
  } = (input || {}) as {
    server?: string;
    query?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 20,
  });

  const searchQuery = asString(query);
  if (!searchQuery) return { error: "query is required." };

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    SearchTerm: searchQuery,
    StartIndex: String(startIndex),
    Limit: String(limit),
  });

  const data = await fetchJson<{ Items?: any[]; TotalRecordCount?: number }>(
    `${config.serverUrl}/Persons?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const people = (data.Items || []).map((item) => mapEmbyPerson(item, config.serverUrl));
  const projected = compactList(people, compact, compactLimit);

  return {
    server: { id: config.id, name: config.label },
    query: searchQuery,
    totalCount: data.TotalRecordCount ?? people.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    people: projected.items,
  };
});

handlers.set("emby_person_credits", async (input) => {
  const {
    server,
    person,
    personId,
    mediaType = "movie",
    sortBy = "SortName",
    sortOrder = "Ascending",
  } = (input || {}) as {
    server?: string;
    person?: string;
    personId?: string;
    mediaType?: string;
    sortBy?: string;
    sortOrder?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 30,
  });

  const config = await getEmbyConfig(server);
  if (!config) {
    return { error: "No Emby integration configured. Add one in Integrations." };
  }

  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { error: `Could not resolve Emby user for server '${config.label}'.` };
  }

  const embyMediaType = toMediaType(mediaType, "movie");
  let personName = asString(person);
  const normalizedPersonId = asString(personId);

  if (!personName && normalizedPersonId) {
    const details = await fetchJson<any>(
      `${config.serverUrl}/Persons/${encodeURIComponent(normalizedPersonId)}?api_key=${encodeURIComponent(config.apiKey)}`,
      undefined,
      { cacheTtlMs: READ_CACHE_TTL_MS },
    );
    personName = asString(details?.Name || details?.name);
  }

  if (!personName) {
    return { error: "person or personId is required." };
  }

  const params = new URLSearchParams({
    api_key: config.apiKey,
    Person: personName,
    IncludeItemTypes: embyTypeParam(embyMediaType),
    Recursive: "true",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: asString(sortBy) || "SortName",
    SortOrder: embySortOrder(sortOrder),
    EnableImageTypes: "Primary,Backdrop",
    Fields: "Overview,Genres,CommunityRating,OfficialRating,People",
  });

  const data = await fetchJson<{ Items?: any[]; TotalRecordCount?: number }>(
    `${config.serverUrl}/Users/${userId}/Items?${params.toString()}`,
    undefined,
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.Items || []).map((item) => mapEmbyItem(item, config.serverUrl));
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactEmbyItem);

  return {
    server: { id: config.id, name: config.label },
    person: personName,
    mediaType: embyMediaType,
    totalCount: data.TotalRecordCount ?? allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("media_availability_overview", async (input) => {
  const {
    embyServer,
    jellyseerrServer,
    query,
    mediaType = "all",
  } = (input || {}) as {
    embyServer?: string;
    jellyseerrServer?: string;
    query?: string;
    mediaType?: string;
  };
  const { limit, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 30,
  });

  const searchQuery = asString(query);
  if (!searchQuery) return { error: "query is required." };

  const emby = await getEmbyConfig(embyServer);
  const jelly = await getJellyseerrConfig(jellyseerrServer);
  if (!emby && !jelly) {
    return { error: "No Emby or Jellyseerr integration configured." };
  }

  const embyMediaType = toMediaType(mediaType, "all");
  const jellyMediaType = toJellyMediaType(mediaType, "all");

  let embyItems: Array<Record<string, unknown>> = [];
  if (emby) {
    const userId = await getEmbyUserId(emby);
    if (userId) {
      const params = new URLSearchParams({
        api_key: emby.apiKey,
        SearchTerm: searchQuery,
        IncludeItemTypes: embyTypeParam(embyMediaType),
        Recursive: "true",
        Limit: String(limit),
        EnableImageTypes: "Primary,Backdrop",
        Fields: "Overview,Genres,CommunityRating,OfficialRating",
      });
      const data = await fetchJson<{ Items?: any[] }>(
        `${emby.serverUrl}/Users/${userId}/Items?${params.toString()}`,
        undefined,
        { cacheTtlMs: READ_CACHE_TTL_MS },
      );
      embyItems = (data.Items || []).map((item) => mapEmbyItem(item, emby.serverUrl));
    }
  }

  let jellyItems: Array<Record<string, unknown>> = [];
  if (jelly) {
    const data = await fetchJson<{ results?: any[] }>(
      `${jelly.serverUrl}/api/v1/search?query=${encodeURIComponent(searchQuery)}`,
      { headers: { "X-Api-Key": jelly.apiKey } },
      { cacheTtlMs: READ_CACHE_TTL_MS },
    );
    jellyItems = (data.results || [])
      .map((item) => mapJellyMedia(item))
      .filter((item) => jellyMediaType === "all" || item.mediaType === jellyMediaType);
  }

  const embyKeySet = new Set(embyItems.map((item) => normalizeLookupKey(item.name)));
  const jellyWithLibrary = jellyItems.map((item) => {
    const key = normalizeLookupKey(item.title);
    const inLibrary = key.length > 0 && embyKeySet.has(key);
    return {
      ...item,
      inLibrary,
      availabilityHint: inLibrary ? "in_emby_library" : "not_in_emby_library",
    };
  });

  const embyProjected = applyCompactProjection(embyItems, compact, compactLimit, compactEmbyItem);
  const jellyProjected = applyCompactProjection(jellyWithLibrary, compact, compactLimit, compactJellyMedia);

  return {
    query: searchQuery,
    mediaType: mediaType,
    summary: {
      embyMatches: embyItems.length,
      jellyseerrMatches: jellyItems.length,
      overlap: jellyWithLibrary.filter((item) => item.inLibrary === true).length,
    },
    emby: emby
      ? {
          server: { id: emby.id, name: emby.label },
          compact: embyProjected.compact,
          hasMore: embyProjected.hasMore,
          returned: embyProjected.returned,
          items: embyProjected.items,
        }
      : null,
    jellyseerr: jelly
      ? {
          server: { id: jelly.id, name: jelly.label },
          compact: jellyProjected.compact,
          hasMore: jellyProjected.hasMore,
          returned: jellyProjected.returned,
          items: jellyProjected.items,
        }
      : null,
  };
});

handlers.set("media_recent_activity", async (input) => {
  const { provider, channelId } = (input || {}) as { provider?: string; channelId?: string };
  const limit = toBoundedInt((input as any)?.limit, "limit", {
    min: 1,
    max: 200,
    fallback: WEBHOOK_ACTIVITY_DEFAULT_LIMIT,
  });
  const normalizedProvider = toLowerText(provider);
  const normalizedChannelId = asString(channelId);
  const events = getMediaWebhookActivity({
    limit,
    provider: normalizedProvider || undefined,
    channelId: normalizedChannelId,
  });
  return {
    count: events.length,
    limit,
    provider: normalizedProvider || "all",
    channelId: normalizedChannelId || null,
    events,
  };
});

// ─── Jellyseerr tools ────────────────────────────────────────────────────────

handlers.set("jellyseerr_servers", async () => {
  const rows = await listConfigs("jellyseerr");
  const servers = rows
    .map((row) => parseJellyseerrConfig(row))
    .filter((row): row is JellyseerrConfig => row !== null)
    .map((row) => ({
      id: row.id,
      name: row.label,
      serverUrl: row.serverUrl,
    }));
  return { servers, count: servers.length };
});

handlers.set("jellyseerr_search", async (input) => {
  const {
    server,
    query,
    mediaType = "all",
  } = (input || {}) as {
    server?: string;
    query?: string;
    mediaType?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 30,
  });

  const normalizedQuery = asString(query);
  if (!normalizedQuery) return { error: "query is required." };

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const page = Math.floor(startIndex / limit) + 1;
  const normalizedMediaType = toJellyMediaType(mediaType, "all");
  const data = await fetchJson<{ results?: any[] }>(
    `${config.serverUrl}/api/v1/search?query=${encodeURIComponent(normalizedQuery)}&page=${page}&language=en`,
    {
      headers: { "X-Api-Key": config.apiKey },
    },
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const allItems = (data.results || [])
    .map((item) => mapJellyMedia(item))
    .filter((item) => normalizedMediaType === "all" || item.mediaType === normalizedMediaType);
  const projected = applyCompactProjection(allItems, compact, compactLimit, compactJellyMedia);

  return {
    server: { id: config.id, name: config.label },
    query: normalizedQuery,
    mediaType: normalizedMediaType,
    count: allItems.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("jellyseerr_requests", async (input) => {
  const {
    server,
    status = "all",
  } = (input || {}) as {
    server?: string;
    status?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 20,
  });

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const normalizedFilter = normalizeJellyRequestStatus(status);
  if (!normalizedFilter) {
    return {
      error: "status must be one of: all, pending, approved, available, processing, unavailable, failed, deleted, completed.",
    };
  }

  let url = `${config.serverUrl}/api/v1/request?take=${limit}&skip=${startIndex}`;
  if (normalizedFilter !== "all") {
    url += `&filter=${encodeURIComponent(normalizedFilter)}`;
  }

  const data = await fetchJson<{ results?: any[] }>(url, {
    headers: { "X-Api-Key": config.apiKey },
  }, {
    cacheTtlMs: READ_CACHE_TTL_MS,
  });

  const requests = (data.results || []).map((request) => mapJellyRequest(request));
  const projected = applyCompactProjection(requests, compact, compactLimit, compactJellyRequest);
  return {
    server: { id: config.id, name: config.label },
    status: normalizedFilter,
    count: requests.length,
    page: {
      startIndex,
      limit,
      hasMore: projected.hasMore,
      returned: projected.returned,
    },
    compact: projected.compact,
    requests: projected.items,
  };
});

handlers.set("jellyseerr_requests_summary", async (input) => {
  const { server } = (input || {}) as { server?: string };
  const limit = toBoundedInt((input as any)?.limit, "limit", {
    min: 1,
    max: 50,
    fallback: 5,
  });

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const data = await fetchJson<{ results?: any[] }>(
    `${config.serverUrl}/api/v1/request?take=200&skip=0`,
    { headers: { "X-Api-Key": config.apiKey } },
    { cacheTtlMs: READ_CACHE_TTL_MS },
  );
  const requests = (data.results || []).map((request) => mapJellyRequest(request));
  const byStatus = new Map<string, Array<Record<string, unknown>>>();
  for (const request of requests) {
    const status = asString(request.statusName) || "unknown";
    const bucket = byStatus.get(status) || [];
    bucket.push(request);
    byStatus.set(status, bucket);
  }

  const summary = Array.from(byStatus.entries())
    .map(([status, list]) => ({
      status,
      count: list.length,
      samples: list.slice(0, limit).map((item) => compactJellyRequest(item)),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    server: { id: config.id, name: config.label },
    total: requests.length,
    statuses: summary,
  };
});

handlers.set("jellyseerr_request_status", async (input) => {
  const {
    server,
    requestId,
  } = (input || {}) as {
    server?: string;
    requestId?: number | string;
  };

  const id = toInteger(requestId, "requestId");

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const request = await fetchJson<any>(`${config.serverUrl}/api/v1/request/${id}`, {
    headers: { "X-Api-Key": config.apiKey },
  }, {
    cacheTtlMs: READ_CACHE_TTL_MS,
  });

  return {
    server: { id: config.id, name: config.label },
    request: mapJellyRequest(request),
  };
});

handlers.set("jellyseerr_create_request", async (input) => {
  const {
    server,
    mediaType,
    tmdbId,
    seasons,
  } = (input || {}) as {
    server?: string;
    mediaType?: string;
    tmdbId?: number | string;
    seasons?: Array<number | string>;
  };

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const normalizedType = toJellyMediaType(mediaType, "all");
  if (normalizedType === "all") {
    return { error: "mediaType must be 'movie' or 'tv'." };
  }

  const body: Record<string, unknown> = {
    mediaType: normalizedType,
    mediaId: toInteger(tmdbId, "tmdbId"),
  };

  if (normalizedType === "tv" && Array.isArray(seasons) && seasons.length > 0) {
    body.seasons = seasons.map((season) => toInteger(season, "seasons[]"));
  }

  const request = await fetchJson<any>(`${config.serverUrl}/api/v1/request`, {
    method: "POST",
    headers: {
      "X-Api-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    server: { id: config.id, name: config.label },
    success: true,
    requestId: request.id,
    request,
  };
});

handlers.set("jellyseerr_cancel_request", async (input) => {
  const {
    server,
    requestId,
  } = (input || {}) as {
    server?: string;
    requestId?: number | string;
  };

  const id = toInteger(requestId, "requestId");
  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  await fetchJson<unknown>(`${config.serverUrl}/api/v1/request/${id}`, {
    method: "DELETE",
    headers: { "X-Api-Key": config.apiKey },
  });

  return {
    server: { id: config.id, name: config.label },
    success: true,
    requestId: id,
  };
});

handlers.set("jellyseerr_trending", async (input) => {
  const {
    server,
    mediaType = "all",
  } = (input || {}) as {
    server?: string;
    mediaType?: string;
  };
  const { limit, startIndex, compact, compactLimit } = parsePagedInput(input, {
    fallbackLimit: 30,
  });

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const normalizedType = toJellyMediaType(mediaType, "all");
  const items: Array<Record<string, unknown>> = [];

  if (normalizedType === "all" || normalizedType === "movie") {
    const movies = await fetchJson<{ results?: any[] }>(
      `${config.serverUrl}/api/v1/discover/movies?page=1`,
      { headers: { "X-Api-Key": config.apiKey } },
      { cacheTtlMs: READ_CACHE_TTL_MS },
    );
    for (const movie of movies.results || []) {
      items.push(mapJellyMedia(movie, "movie"));
    }
  }

  if (normalizedType === "all" || normalizedType === "tv") {
    const tv = await fetchJson<{ results?: any[] }>(
      `${config.serverUrl}/api/v1/discover/tv?page=1`,
      { headers: { "X-Api-Key": config.apiKey } },
      { cacheTtlMs: READ_CACHE_TTL_MS },
    );
    for (const show of tv.results || []) {
      items.push(mapJellyMedia(show, "tv"));
    }
  }

  const paged = items.slice(startIndex, startIndex + limit);
  const projected = applyCompactProjection(paged, compact, compactLimit, compactJellyMedia);

  return {
    server: { id: config.id, name: config.label },
    mediaType: normalizedType,
    count: items.length,
    page: {
      startIndex,
      limit,
      hasMore: startIndex + limit < items.length,
      returned: projected.returned,
    },
    compact: projected.compact,
    items: projected.items,
  };
});

handlers.set("jellyseerr_available", async (input) => {
  const {
    server,
    mediaType,
    tmdbId,
  } = (input || {}) as {
    server?: string;
    mediaType?: string;
    tmdbId?: number | string;
  };

  const normalizedType = toJellyMediaType(mediaType, "all");
  if (normalizedType === "all") {
    return { error: "mediaType must be 'movie' or 'tv'." };
  }

  const config = await getJellyseerrConfig(server);
  if (!config) {
    return { error: "No Jellyseerr integration configured. Add one in Integrations." };
  }

  const id = toInteger(tmdbId, "tmdbId");
  const endpoint = normalizedType === "movie" ? "movie" : "tv";

  const details = await fetchJson<any>(`${config.serverUrl}/api/v1/${endpoint}/${id}`, {
    headers: { "X-Api-Key": config.apiKey },
  }, {
    cacheTtlMs: READ_CACHE_TTL_MS,
  });

  const mediaStatus = details.mediaInfo?.status;
  const requestStatus = details.mediaInfo?.requests?.[0]?.status;
  const statusName =
    mediaStatus === 5
      ? "available"
      : mediaStatus === 4
        ? "partially_available"
        : mediaStatus === 3
          ? "processing"
          : "not_available";

  return {
    server: { id: config.id, name: config.label },
    mediaType: normalizedType,
    tmdbId: id,
    available: mediaStatus === 5,
    status: statusName,
    requestStatus: typeof requestStatus === "number" ? statusNameFromCode(requestStatus) : undefined,
  };
});

export function getMediaIntegrationToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getMediaIntegrationToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "emby_servers",
      description: "List configured Emby servers available to JOI.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "emby_library",
      description: "Browse your Emby library (movies or series) with paging, sorting, and optional compact output.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional, defaults to first configured)." },
          mediaType: { type: "string", enum: ["movie", "series"], description: "Library section (default: movie)." },
          limit: { type: "number", description: "Max results (default 50, max 200)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          sortBy: { type: "string", description: "Sort field (default DateCreated)." },
          sortOrder: { type: "string", enum: ["Ascending", "Descending"], description: "Sort order." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "emby_person_search",
      description: "Search Emby people/person records (actors, directors, writers) by name.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          query: { type: "string", description: "Person name search text." },
          limit: { type: "number", description: "Max results (default 20)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: ["query"],
      },
    },
    {
      name: "emby_person_credits",
      description: "List Emby items for a given person (actor/director/writer), by name or personId.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          person: { type: "string", description: "Person name. Use this or personId." },
          personId: { type: "string", description: "Emby person ID. Use this or person." },
          mediaType: { type: "string", enum: ["movie", "series"], description: "Filter media type (default movie)." },
          limit: { type: "number", description: "Max results (default 30)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          sortBy: { type: "string", description: "Sort field (default SortName)." },
          sortOrder: { type: "string", enum: ["Ascending", "Descending"], description: "Sort order." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "emby_search",
      description: "Search your Emby library by title text and/or people (actor/director/writer). Use this for 'what do I have' questions.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          query: { type: "string", description: "Search text (title or person)." },
          person: { type: "string", description: "General person filter." },
          actor: { type: "string", description: "Actor filter." },
          director: { type: "string", description: "Director filter." },
          writer: { type: "string", description: "Writer filter." },
          mode: { type: "string", enum: ["auto", "title", "person"], description: "Search strategy (default auto)." },
          mediaType: { type: "string", enum: ["movie", "series", "all"], description: "Optional media type filter." },
          limit: { type: "number", description: "Max results (default 50)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          sortBy: { type: "string", description: "Sort field (default SortName)." },
          sortOrder: { type: "string", enum: ["Ascending", "Descending"], description: "Sort order." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: ["query"],
      },
    },
    {
      name: "emby_item_details",
      description: "Get detailed metadata for one Emby item.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          itemId: { type: "string", description: "Emby item ID." },
        },
        required: ["itemId"],
      },
    },
    {
      name: "emby_recently_watched",
      description: "Get recently watched items from Emby watch history.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          mediaType: { type: "string", enum: ["movie", "series", "all"], description: "Filter by media type." },
          limit: { type: "number", description: "Max results (default 20)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "emby_continue_watching",
      description: "Get in-progress Emby items that can be continued.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          limit: { type: "number", description: "Max results (default 20)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "emby_next_up",
      description: "Get the next episode queue from Emby for started series.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          limit: { type: "number", description: "Max results (default 20)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "emby_now_playing",
      description: "Get active Emby sessions and currently playing media.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Emby server ID (optional)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "media_availability_overview",
      description: "Cross-check Emby library results and Jellyseerr search results for the same query.",
      input_schema: {
        type: "object" as const,
        properties: {
          embyServer: { type: "string", description: "Optional Emby server ID." },
          jellyseerrServer: { type: "string", description: "Optional Jellyseerr server ID." },
          query: { type: "string", description: "Title/person query to check across both systems." },
          mediaType: { type: "string", enum: ["movie", "series", "tv", "all"], description: "Optional media type filter." },
          limit: { type: "number", description: "Max results per provider (default 30)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: ["query"],
      },
    },
    {
      name: "media_recent_activity",
      description: "Show recent inbound webhook activity observed by JOI (Emby, Jellyseerr, generic webhook).",
      input_schema: {
        type: "object" as const,
        properties: {
          provider: {
            type: "string",
            enum: [
              "all",
              "emby",
              "jellyseerr",
              "webhook",
            ],
            description: "Optional provider filter.",
          },
          channelId: { type: "string", description: "Optional specific channel ID filter." },
          limit: { type: "number", description: "Max events to return (default 30)." },
        },
        required: [],
      },
    },
    {
      name: "jellyseerr_servers",
      description: "List configured Jellyseerr servers available to JOI.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "jellyseerr_search",
      description: "Search Jellyseerr/TMDB catalog for discovery and request candidates (not a direct view of your Emby library holdings).",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          query: { type: "string", description: "Search text." },
          mediaType: { type: "string", enum: ["movie", "tv", "all"], description: "Optional media type filter." },
          limit: { type: "number", description: "Max results (default 30)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: ["query"],
      },
    },
    {
      name: "jellyseerr_requests",
      description: "List Jellyseerr requests with status filtering and paging.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          status: {
            type: "string",
            enum: [
              "all",
              "pending",
              "approved",
              "available",
              "processing",
              "unavailable",
              "failed",
              "deleted",
              "completed",
              "declined",
              "rejected",
              "cancelled",
              "canceled",
              "done",
              "running",
              "in-progress",
              "complete",
            ],
          },
          limit: { type: "number", description: "Max results (default 20)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "jellyseerr_requests_summary",
      description: "Summarize Jellyseerr requests grouped by status with sample entries.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          limit: { type: "number", description: "Sample requests per status (default 5)." },
        },
        required: [],
      },
    },
    {
      name: "jellyseerr_request_status",
      description: "Get status for one Jellyseerr request by request ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          requestId: { type: "number", description: "Request ID." },
        },
        required: ["requestId"],
      },
    },
    {
      name: "jellyseerr_create_request",
      description: "Create a Jellyseerr request for a movie or TV show.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          mediaType: { type: "string", enum: ["movie", "tv"], description: "Media type." },
          tmdbId: { type: "number", description: "TMDB ID." },
          seasons: {
            type: "array",
            items: { type: "number" },
            description: "Season numbers (TV only, optional).",
          },
        },
        required: ["mediaType", "tmdbId"],
      },
    },
    {
      name: "jellyseerr_cancel_request",
      description: "Cancel a Jellyseerr request by request ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          requestId: { type: "number", description: "Request ID." },
        },
        required: ["requestId"],
      },
    },
    {
      name: "jellyseerr_trending",
      description: "Get trending movies/TV from Jellyseerr discover endpoints.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          mediaType: { type: "string", enum: ["movie", "tv", "all"], description: "Filter media type." },
          limit: { type: "number", description: "Max results (default 30)." },
          startIndex: { type: "number", description: "Offset for pagination (default 0)." },
          compact: { type: "boolean", description: "Return a concise result shape (default true)." },
          compactLimit: { type: "number", description: "Max items when compact mode is enabled." },
        },
        required: [],
      },
    },
    {
      name: "jellyseerr_available",
      description: "Check availability/request status for one TMDB title in Jellyseerr.",
      input_schema: {
        type: "object" as const,
        properties: {
          server: { type: "string", description: "Jellyseerr server ID (optional)." },
          mediaType: { type: "string", enum: ["movie", "tv"], description: "Media type." },
          tmdbId: { type: "number", description: "TMDB ID." },
        },
        required: ["mediaType", "tmdbId"],
      },
    },
  ];
}
