import crypto from "node:crypto";
import { query } from "../db/client.js";
import { listExternalSkillCatalog } from "../skills/catalog.js";

export type HumanizerStage =
  | "tool_announcement"
  | "pre_tool_start"
  | "pre_tool_progress"
  | "tool_start"
  | "tool_progress"
  | "tool_long"
  | "chat_streaming";

export type HumanizerChannel = "any" | "voice" | "chat";

interface HumanizerTemplateRow {
  id: string;
  name: string | null;
  stage: HumanizerStage;
  channel: HumanizerChannel;
  language: string;
  agent_id: string | null;
  skill_name: string | null;
  tool_pattern: string | null;
  template: string;
  weight: number;
  allow_emoji: boolean;
  enabled: boolean;
  metadata: unknown;
  created_at?: string | Date;
}

interface HumanizerTemplate extends HumanizerTemplateRow {
  matcher: RegExp | null;
  emojiPool: string[];
}

interface HumanizerProfileRow {
  id: string;
  enabled: boolean;
  avoid_repeat_window: number;
  emoji_probability: number | string;
  allow_emojis_in_chat: boolean;
  max_emojis: number;
  config: unknown;
}

export interface HumanizerProfile {
  id: string;
  enabled: boolean;
  avoidRepeatWindow: number;
  emojiProbability: number;
  allowEmojisInChat: boolean;
  maxEmojis: number;
  config: Record<string, unknown>;
}

interface HumanizerGroupCountRow {
  key: string;
  count: number;
}

interface HumanizerTopOutputRow {
  output_text: string | null;
  count: number;
}

export interface HumanizerSelectionInput {
  channel: Extract<HumanizerChannel, "voice" | "chat">;
  stage: HumanizerStage;
  language?: string | null;
  strictLanguage?: boolean;
  agentId?: string | null;
  skillName?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  hint?: string | null;
  conversationId?: string | null;
  allowEmoji?: boolean;
  seed?: string | null;
  emitEvent?: boolean;
}

export interface HumanizerSelectionResult {
  text: string;
  templateId: string;
  source: "db";
  stage: HumanizerStage;
  channel: Extract<HumanizerChannel, "voice" | "chat">;
  language: string;
}

export interface HumanizerOverview {
  generatedAt: string;
  cache: {
    templatesLoaded: number;
    loadedAt: string | null;
    staleMs: number | null;
  };
  inventory: {
    agents: number;
    enabledAgents: number;
    gatewaySkills: number;
    externalSkills: number;
    cronJobs: number;
  };
  templates: {
    total: number;
    enabled: number;
    emojiEnabled: number;
    byStage: Record<string, number>;
    byLanguage: Record<string, number>;
    byChannel: Record<string, number>;
  };
  coverage: {
    agentsWithCustomTemplates: number;
    agentsWithCustomTemplatesPercent: number;
    skillsWithCustomTemplates: number;
    skillsWithCustomTemplatesPercent: number;
  };
  events7d: {
    total: number;
    uniqueOutputs: number;
    uniquenessPercent: number;
    byStage: Record<string, number>;
    topRepeatedOutputs: Array<{ text: string; count: number }>;
  };
  profile: HumanizerProfile;
}

const DEFAULT_PROFILE: HumanizerProfile = {
  id: "default",
  enabled: true,
  avoidRepeatWindow: 6,
  emojiProbability: 0.35,
  allowEmojisInChat: true,
  maxEmojis: 1,
  config: {},
};

const DEFAULT_EMOJIS = ["✨", "⏳", "🤝", "🧠", "🔎", "📚", "📡", "✅", "📬", "🎬"];

const CACHE_TTL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.JOI_HUMANIZER_CACHE_TTL_MS || "60000", 10) || 60_000,
);

let cachedTemplates: HumanizerTemplate[] = [];
let cachedProfile: HumanizerProfile = { ...DEFAULT_PROFILE };
let cacheLoadedAt = 0;
let refreshInFlight: Promise<void> | null = null;

const recentSelections = new Map<string, string[]>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLanguageCode(language: string | null | undefined): string {
  const normalized = String(language || "").trim().toLowerCase();
  if (!normalized) return "en";
  if (normalized.startsWith("de")) return "de";
  if (normalized.startsWith("en")) return "en";
  return normalized.split(/[-_]/)[0] || "en";
}

function isGerman(language: string | null | undefined): boolean {
  return normalizeLanguageCode(language) === "de";
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isMissingHumanizerSchemaError(err: unknown): boolean {
  const code = isRecord(err) ? String(err.code || "") : "";
  return code === "42P01" || code === "42703";
}

function compilePattern(pattern: string | null): RegExp | null {
  if (!pattern || !pattern.trim()) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function parseEmojiPool(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const emojis = metadata.emojis;
  if (!Array.isArray(emojis)) return [];
  return emojis
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 20);
}

function mapProfileRow(row: HumanizerProfileRow | undefined): HumanizerProfile {
  if (!row) return { ...DEFAULT_PROFILE };

  const emojiProbabilityRaw = typeof row.emoji_probability === "string"
    ? Number.parseFloat(row.emoji_probability)
    : Number(row.emoji_probability);

  return {
    id: row.id || "default",
    enabled: Boolean(row.enabled),
    avoidRepeatWindow: Math.floor(clampNumber(Number(row.avoid_repeat_window), 0, 50)),
    emojiProbability: clampNumber(emojiProbabilityRaw, 0, 1),
    allowEmojisInChat: Boolean(row.allow_emojis_in_chat),
    maxEmojis: Math.floor(clampNumber(Number(row.max_emojis), 0, 5)),
    config: isRecord(row.config) ? row.config : {},
  };
}

function mapTemplateRow(row: HumanizerTemplateRow): HumanizerTemplate {
  return {
    ...row,
    language: normalizeLanguageCode(row.language),
    matcher: compilePattern(row.tool_pattern),
    emojiPool: parseEmojiPool(row.metadata),
  };
}

function hashToUnitInterval(seed: string): number {
  const digest = crypto.createHash("sha1").update(seed).digest("hex");
  const n = Number.parseInt(digest.slice(0, 8), 16);
  if (!Number.isFinite(n)) return Math.random();
  return (n % 10000) / 10000;
}

function pickWeightedTemplate(
  entries: Array<{ template: HumanizerTemplate; score: number }>,
  seed: string,
): HumanizerTemplate | null {
  if (entries.length === 0) return null;

  let total = 0;
  for (const entry of entries) {
    total += Math.max(1, entry.score);
  }

  if (total <= 0) return entries[0]?.template ?? null;

  let target = hashToUnitInterval(seed) * total;
  for (const entry of entries) {
    target -= Math.max(1, entry.score);
    if (target <= 0) return entry.template;
  }

  return entries[entries.length - 1]?.template ?? null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstStringField(input: unknown, key: string): string | null {
  if (!isRecord(input)) return null;
  return asString(input[key]);
}

function getInputHint(toolInput: unknown): string | null {
  const hintKeys = [
    "query",
    "q",
    "search",
    "term",
    "name",
    "title",
    "contact",
    "person",
    "subject",
    "topic",
    "collection",
    "event",
    "location",
    "city",
  ] as const;

  for (const key of hintKeys) {
    const raw = firstStringField(toolInput, key);
    if (!raw) continue;
    const compact = raw.replace(/\s+/g, " ").trim();
    if (compact.length <= 48) return compact;
    return `${compact.slice(0, 45).trimEnd()}...`;
  }

  return null;
}

function chooseEmoji(emojiPool: string[], seed: string): string {
  const source = emojiPool.length > 0 ? emojiPool : DEFAULT_EMOJIS;
  const idx = Math.floor(hashToUnitInterval(`${seed}:emoji`) * source.length) % source.length;
  return source[idx] || "";
}

function renderTemplate(
  template: HumanizerTemplate,
  input: HumanizerSelectionInput,
  language: string,
  toolName: string,
  hint: string | null,
): string {
  const defaultHint = isGerman(language) ? "das" : "that";
  const hintValue = hint ? `"${hint}"` : defaultHint;
  const normalizedTool = toolName ? toolName.replace(/[_-]+/g, " ") : (isGerman(language) ? "anfrage" : "request");

  let output = template.template
    .replace(/\{hint\}/g, hintValue)
    .replace(/\{tool\}/g, normalizedTool)
    .replace(/\s+/g, " ")
    .trim();

  const allowEmoji = input.channel === "chat"
    && cachedProfile.allowEmojisInChat
    && (input.allowEmoji ?? true)
    && template.allow_emoji
    && cachedProfile.maxEmojis > 0;

  const includeEmoji = allowEmoji && hashToUnitInterval(`${input.seed || ""}:${template.id}:allow`) <= cachedProfile.emojiProbability;
  const emoji = includeEmoji ? chooseEmoji(template.emojiPool, `${input.seed || ""}:${template.id}`) : "";

  output = output.replace(/\{emoji\}/g, emoji);
  if (!emoji) {
    output = output.replace(/\s*\{emoji\}\s*/g, " ").replace(/\s+/g, " ").trim();
  }

  return output;
}

function rememberSelection(memoryKey: string, templateId: string): void {
  if (cachedProfile.avoidRepeatWindow <= 0) return;

  const history = recentSelections.get(memoryKey) || [];
  history.push(templateId);

  const maxKeep = Math.max(cachedProfile.avoidRepeatWindow * 3, 10);
  if (history.length > maxKeep) {
    history.splice(0, history.length - maxKeep);
  }
  recentSelections.set(memoryKey, history);

  if (recentSelections.size > 5000) {
    const oldestKey = recentSelections.keys().next().value;
    if (typeof oldestKey === "string") recentSelections.delete(oldestKey);
  }
}

function collectCandidates(input: HumanizerSelectionInput, language: string): HumanizerTemplate[] {
  const toolName = (input.toolName || "").trim().toLowerCase();
  const strictLanguage = input.strictLanguage === true;

  return cachedTemplates.filter((template) => {
    if (!template.enabled) return false;
    if (template.stage !== input.stage) return false;
    if (!(template.channel === "any" || template.channel === input.channel)) return false;
    if (strictLanguage) {
      if (template.language !== language) return false;
    } else if (!(template.language === "any" || template.language === language)) {
      return false;
    }
    if (template.agent_id && template.agent_id !== input.agentId) return false;
    if (template.skill_name && template.skill_name !== input.skillName) return false;
    if (template.matcher && !template.matcher.test(toolName)) return false;
    return true;
  });
}

function scoreCandidate(
  candidate: HumanizerTemplate,
  input: HumanizerSelectionInput,
  language: string,
  hasToolName: boolean,
): number {
  let score = Math.max(1, Number(candidate.weight) || 1);

  if (candidate.channel === input.channel) score += 15;
  if (candidate.language === language) score += 20;
  if (candidate.agent_id && candidate.agent_id === input.agentId) score += 25;
  if (candidate.skill_name && candidate.skill_name === input.skillName) score += 15;
  if (candidate.matcher && hasToolName) score += 20;

  return score;
}

function maybeRefreshCache(force = false): void {
  const stale = Date.now() - cacheLoadedAt > CACHE_TTL_MS;
  if (!force && !stale) return;
  if (refreshInFlight) return;

  refreshInFlight = refreshHumanizerCache(force).finally(() => {
    refreshInFlight = null;
  });
}

function shouldEmitEvent(input: HumanizerSelectionInput): boolean {
  return input.emitEvent !== false;
}

function emitSelectionEvent(input: HumanizerSelectionInput, templateId: string, text: string, language: string): void {
  if (!shouldEmitEvent(input)) return;

  const metadata = {
    seed: input.seed || null,
    toolInputHint: input.hint || getInputHint(input.toolInput),
  };

  void query(
    `INSERT INTO humanizer_events (
      event_type,
      conversation_id,
      agent_id,
      skill_name,
      tool_name,
      channel,
      stage,
      language,
      template_id,
      output_text,
      metadata
    ) VALUES (
      'selection', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
    )`,
    [
      input.conversationId || null,
      input.agentId || null,
      input.skillName || null,
      input.toolName || null,
      input.channel,
      input.stage,
      language,
      templateId,
      text,
      JSON.stringify(metadata),
    ],
  ).catch(() => {});
}

export async function refreshHumanizerCache(force = false): Promise<void> {
  const isFresh = !force && cacheLoadedAt > 0 && (Date.now() - cacheLoadedAt <= CACHE_TTL_MS);
  if (isFresh) return;

  try {
    const [templateRows, profileRows] = await Promise.all([
      query<HumanizerTemplateRow>(
        `SELECT id, name, stage, channel, language, agent_id, skill_name, tool_pattern,
                template, weight, allow_emoji, enabled, metadata, created_at
         FROM humanizer_templates
         WHERE enabled = true
         ORDER BY stage, channel, language, weight DESC, created_at ASC`,
      ),
      query<HumanizerProfileRow>(
        `SELECT id, enabled, avoid_repeat_window, emoji_probability,
                allow_emojis_in_chat, max_emojis, config
         FROM humanizer_profiles
         WHERE id = 'default'
         LIMIT 1`,
      ),
    ]);

    cachedTemplates = templateRows.rows.map(mapTemplateRow);
    cachedProfile = mapProfileRow(profileRows.rows[0]);
    cacheLoadedAt = Date.now();
  } catch (err) {
    if (!isMissingHumanizerSchemaError(err)) {
      console.warn("[Humanizer] Failed to refresh cache:", err);
    }
  }
}

export function kickoffHumanizerCacheRefresh(force = false): void {
  maybeRefreshCache(force);
}

export function getCachedHumanizerProfile(): HumanizerProfile {
  maybeRefreshCache(false);
  return { ...cachedProfile, config: { ...cachedProfile.config } };
}

export async function updateHumanizerProfile(patch: Partial<{
  enabled: boolean;
  avoidRepeatWindow: number;
  emojiProbability: number;
  allowEmojisInChat: boolean;
  maxEmojis: number;
  config: Record<string, unknown>;
}>): Promise<HumanizerProfile> {
  const current = getCachedHumanizerProfile();
  const next: HumanizerProfile = {
    ...current,
    enabled: patch.enabled ?? current.enabled,
    avoidRepeatWindow: patch.avoidRepeatWindow !== undefined
      ? Math.floor(clampNumber(patch.avoidRepeatWindow, 0, 50))
      : current.avoidRepeatWindow,
    emojiProbability: patch.emojiProbability !== undefined
      ? clampNumber(patch.emojiProbability, 0, 1)
      : current.emojiProbability,
    allowEmojisInChat: patch.allowEmojisInChat ?? current.allowEmojisInChat,
    maxEmojis: patch.maxEmojis !== undefined
      ? Math.floor(clampNumber(patch.maxEmojis, 0, 5))
      : current.maxEmojis,
    config: patch.config !== undefined ? patch.config : current.config,
  };

  await query(
    `INSERT INTO humanizer_profiles (
      id, enabled, avoid_repeat_window, emoji_probability,
      allow_emojis_in_chat, max_emojis, config, updated_at
    ) VALUES (
      'default', $1, $2, $3, $4, $5, $6::jsonb, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      avoid_repeat_window = EXCLUDED.avoid_repeat_window,
      emoji_probability = EXCLUDED.emoji_probability,
      allow_emojis_in_chat = EXCLUDED.allow_emojis_in_chat,
      max_emojis = EXCLUDED.max_emojis,
      config = EXCLUDED.config,
      updated_at = NOW()`,
    [
      next.enabled,
      next.avoidRepeatWindow,
      next.emojiProbability,
      next.allowEmojisInChat,
      next.maxEmojis,
      JSON.stringify(next.config || {}),
    ],
  );

  await refreshHumanizerCache(true);
  return getCachedHumanizerProfile();
}

export function selectHumanizedLine(input: HumanizerSelectionInput): HumanizerSelectionResult | null {
  maybeRefreshCache(false);

  if (!cachedProfile.enabled || cachedTemplates.length === 0) return null;

  const language = normalizeLanguageCode(input.language);
  const toolName = (input.toolName || "").trim().toLowerCase();
  const seed = input.seed || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const hint = (input.hint || getInputHint(input.toolInput));

  const candidates = collectCandidates(input, language);
  if (candidates.length === 0) return null;

  const memoryKey = [
    input.conversationId || "global",
    input.channel,
    input.stage,
    language,
    input.agentId || "any-agent",
    toolName || "any-tool",
  ].join(":");

  const recent = recentSelections.get(memoryKey) || [];
  const recentSet = new Set(recent.slice(-cachedProfile.avoidRepeatWindow));
  const filteredCandidates = candidates.filter((candidate) => !recentSet.has(candidate.id));
  const effectiveCandidates = filteredCandidates.length > 0 ? filteredCandidates : candidates;

  const weighted = effectiveCandidates.map((candidate) => ({
    template: candidate,
    score: scoreCandidate(candidate, input, language, toolName.length > 0),
  }));

  const selected = pickWeightedTemplate(weighted, `${seed}:${input.stage}:${toolName}`);
  if (!selected) return null;

  const text = renderTemplate(selected, { ...input, seed }, language, toolName, hint);
  if (!text) return null;

  rememberSelection(memoryKey, selected.id);
  emitSelectionEvent(input, selected.id, text, language);

  return {
    text,
    templateId: selected.id,
    source: "db",
    stage: input.stage,
    channel: input.channel,
    language,
  };
}

export async function listHumanizerTemplates(filters?: {
  stage?: string;
  channel?: string;
  language?: string;
  enabled?: boolean;
  agentId?: string;
}): Promise<HumanizerTemplateRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.stage) {
    where.push(`stage = $${idx++}`);
    params.push(filters.stage);
  }
  if (filters?.channel) {
    where.push(`channel = $${idx++}`);
    params.push(filters.channel);
  }
  if (filters?.language) {
    where.push(`language = $${idx++}`);
    params.push(normalizeLanguageCode(filters.language));
  }
  if (filters?.enabled !== undefined) {
    where.push(`enabled = $${idx++}`);
    params.push(filters.enabled);
  }
  if (filters?.agentId) {
    where.push(`agent_id = $${idx++}`);
    params.push(filters.agentId);
  }

  const sql = `
    SELECT id, name, stage, channel, language, agent_id, skill_name, tool_pattern,
           template, weight, allow_emoji, enabled, metadata, created_at
    FROM humanizer_templates
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY stage, channel, language, weight DESC, created_at ASC
  `;

  const result = await query<HumanizerTemplateRow>(sql, params);
  return result.rows;
}

export async function updateHumanizerTemplate(
  id: string,
  patch: Partial<{
    name: string | null;
    stage: HumanizerStage;
    channel: HumanizerChannel;
    language: string;
    agentId: string | null;
    skillName: string | null;
    toolPattern: string | null;
    template: string;
    weight: number;
    allowEmoji: boolean;
    enabled: boolean;
    metadata: Record<string, unknown>;
  }>,
): Promise<HumanizerTemplateRow | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];
  let idx = 1;

  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = $${idx++}`);
    vals.push(value);
  };

  if (patch.name !== undefined) assign("name", patch.name);
  if (patch.stage !== undefined) assign("stage", patch.stage);
  if (patch.channel !== undefined) assign("channel", patch.channel);
  if (patch.language !== undefined) assign("language", normalizeLanguageCode(patch.language));
  if (patch.agentId !== undefined) assign("agent_id", patch.agentId);
  if (patch.skillName !== undefined) assign("skill_name", patch.skillName);
  if (patch.toolPattern !== undefined) assign("tool_pattern", patch.toolPattern);
  if (patch.template !== undefined) assign("template", patch.template);
  if (patch.weight !== undefined) assign("weight", Math.max(1, Math.floor(patch.weight)));
  if (patch.allowEmoji !== undefined) assign("allow_emoji", patch.allowEmoji);
  if (patch.enabled !== undefined) assign("enabled", patch.enabled);
  if (patch.metadata !== undefined) {
    sets.push(`metadata = $${idx++}::jsonb`);
    vals.push(JSON.stringify(patch.metadata));
  }

  vals.push(id);

  const result = await query<HumanizerTemplateRow>(
    `UPDATE humanizer_templates
     SET ${sets.join(", ")}
     WHERE id = $${idx}
     RETURNING id, name, stage, channel, language, agent_id, skill_name, tool_pattern,
               template, weight, allow_emoji, enabled, metadata, created_at`,
    vals,
  );

  await refreshHumanizerCache(true);
  return result.rows[0] || null;
}

function rowsToRecord(rows: HumanizerGroupCountRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.key] = Number(row.count) || 0;
    return acc;
  }, {});
}

export async function getHumanizerOverview(): Promise<HumanizerOverview> {
  await refreshHumanizerCache(false);

  let agentTotals: { rows: Array<{ total: number; enabled: number }> } = {
    rows: [{ total: 0, enabled: 0 }],
  };
  let skillTotals: { rows: Array<{ total: number }> } = { rows: [{ total: 0 }] };
  let cronTotals: { rows: Array<{ total: number }> } = { rows: [{ total: 0 }] };
  let templateTotals: { rows: Array<{ total: number; enabled: number; emoji_enabled: number }> } = {
    rows: [{ total: 0, enabled: 0, emoji_enabled: 0 }],
  };
  let templatesByStage: { rows: HumanizerGroupCountRow[] } = { rows: [] };
  let templatesByLanguage: { rows: HumanizerGroupCountRow[] } = { rows: [] };
  let templatesByChannel: { rows: HumanizerGroupCountRow[] } = { rows: [] };
  let agentsWithCustomTemplates: { rows: Array<{ count: number }> } = { rows: [{ count: 0 }] };
  let skillsWithCustomTemplates: { rows: Array<{ count: number }> } = { rows: [{ count: 0 }] };
  let eventsTotals: { rows: Array<{ total: number; unique_outputs: number }> } = {
    rows: [{ total: 0, unique_outputs: 0 }],
  };
  let eventsByStage: { rows: HumanizerGroupCountRow[] } = { rows: [] };
  let topOutputs: { rows: HumanizerTopOutputRow[] } = { rows: [] };

  try {
    [
      agentTotals,
      skillTotals,
      cronTotals,
      templateTotals,
      templatesByStage,
      templatesByLanguage,
      templatesByChannel,
      agentsWithCustomTemplates,
      skillsWithCustomTemplates,
      eventsTotals,
      eventsByStage,
      topOutputs,
    ] = await Promise.all([
      query<{ total: number; enabled: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE enabled = true)::int AS enabled
         FROM agents`,
      ),
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM skills_registry`,
      ),
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM cron_jobs`,
      ),
      query<{ total: number; enabled: number; emoji_enabled: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE enabled = true)::int AS enabled,
                COUNT(*) FILTER (WHERE enabled = true AND allow_emoji = true)::int AS emoji_enabled
         FROM humanizer_templates`,
      ),
      query<HumanizerGroupCountRow>(
        `SELECT stage AS key, COUNT(*)::int AS count
         FROM humanizer_templates
         WHERE enabled = true
         GROUP BY stage`,
      ),
      query<HumanizerGroupCountRow>(
        `SELECT language AS key, COUNT(*)::int AS count
         FROM humanizer_templates
         WHERE enabled = true
         GROUP BY language`,
      ),
      query<HumanizerGroupCountRow>(
        `SELECT channel AS key, COUNT(*)::int AS count
         FROM humanizer_templates
         WHERE enabled = true
         GROUP BY channel`,
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM (
           SELECT DISTINCT agent_id
           FROM humanizer_templates
           WHERE enabled = true AND agent_id IS NOT NULL
         ) t`,
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM (
           SELECT DISTINCT skill_name
           FROM humanizer_templates
           WHERE enabled = true AND skill_name IS NOT NULL
         ) t`,
      ),
      query<{ total: number; unique_outputs: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(DISTINCT output_text)::int AS unique_outputs
         FROM humanizer_events
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND event_type = 'selection'`,
      ),
      query<HumanizerGroupCountRow>(
        `SELECT stage AS key, COUNT(*)::int AS count
         FROM humanizer_events
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND event_type = 'selection'
         GROUP BY stage`,
      ),
      query<HumanizerTopOutputRow>(
        `SELECT output_text, COUNT(*)::int AS count
         FROM humanizer_events
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND event_type = 'selection'
           AND output_text IS NOT NULL
         GROUP BY output_text
         ORDER BY count DESC
         LIMIT 10`,
      ),
    ]);
  } catch (err) {
    if (!isMissingHumanizerSchemaError(err)) throw err;
  }

  const externalSkills = listExternalSkillCatalog().length;
  const agents = Number(agentTotals.rows[0]?.total || 0);
  const enabledAgents = Number(agentTotals.rows[0]?.enabled || 0);
  const gatewaySkills = Number(skillTotals.rows[0]?.total || 0);
  const cronJobs = Number(cronTotals.rows[0]?.total || 0);

  const templatesTotal = Number(templateTotals.rows[0]?.total || 0);
  const templatesEnabled = Number(templateTotals.rows[0]?.enabled || 0);
  const templatesEmoji = Number(templateTotals.rows[0]?.emoji_enabled || 0);

  const coveredAgents = Number(agentsWithCustomTemplates.rows[0]?.count || 0);
  const coveredSkills = Number(skillsWithCustomTemplates.rows[0]?.count || 0);

  const selectionEvents = Number(eventsTotals.rows[0]?.total || 0);
  const uniqueOutputs = Number(eventsTotals.rows[0]?.unique_outputs || 0);
  const uniquenessPercent = selectionEvents > 0
    ? Number(((uniqueOutputs / selectionEvents) * 100).toFixed(1))
    : 0;

  const agentsCoveragePercent = enabledAgents > 0
    ? Number(((coveredAgents / enabledAgents) * 100).toFixed(1))
    : 0;
  const skillsCoveragePercent = gatewaySkills > 0
    ? Number(((coveredSkills / gatewaySkills) * 100).toFixed(1))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    cache: {
      templatesLoaded: cachedTemplates.length,
      loadedAt: cacheLoadedAt > 0 ? new Date(cacheLoadedAt).toISOString() : null,
      staleMs: cacheLoadedAt > 0 ? Date.now() - cacheLoadedAt : null,
    },
    inventory: {
      agents,
      enabledAgents,
      gatewaySkills,
      externalSkills,
      cronJobs,
    },
    templates: {
      total: templatesTotal,
      enabled: templatesEnabled,
      emojiEnabled: templatesEmoji,
      byStage: rowsToRecord(templatesByStage.rows),
      byLanguage: rowsToRecord(templatesByLanguage.rows),
      byChannel: rowsToRecord(templatesByChannel.rows),
    },
    coverage: {
      agentsWithCustomTemplates: coveredAgents,
      agentsWithCustomTemplatesPercent: agentsCoveragePercent,
      skillsWithCustomTemplates: coveredSkills,
      skillsWithCustomTemplatesPercent: skillsCoveragePercent,
    },
    events7d: {
      total: selectionEvents,
      uniqueOutputs,
      uniquenessPercent,
      byStage: rowsToRecord(eventsByStage.rows),
      topRepeatedOutputs: topOutputs.rows
        .map((row) => ({
          text: row.output_text || "",
          count: Number(row.count) || 0,
        }))
        .filter((row) => row.text.length > 0),
    },
    profile: getCachedHumanizerProfile(),
  };
}

export async function runHumanizerAudit(triggeredBy = "manual"): Promise<HumanizerOverview> {
  const overview = await getHumanizerOverview();

  await query(
    `INSERT INTO humanizer_events (
      event_type,
      channel,
      stage,
      language,
      metadata
    ) VALUES (
      'audit', 'any', 'chat_streaming', 'en', $1::jsonb
    )`,
    [JSON.stringify({ triggeredBy, overview })],
  ).catch(() => {});

  return overview;
}

export function summarizeHumanizerAudit(overview: HumanizerOverview): string {
  return [
    `templates=${overview.templates.enabled}/${overview.templates.total}`,
    `emoji=${overview.templates.emojiEnabled}`,
    `events7d=${overview.events7d.total}`,
    `unique=${overview.events7d.uniquenessPercent}%`,
    `agentCoverage=${overview.coverage.agentsWithCustomTemplatesPercent}%`,
  ].join(" ");
}
