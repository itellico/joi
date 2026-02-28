import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { JoiConfigSchema, type JoiConfig } from "./schema.js";

const CONFIG_DIR = path.join(
  process.env.HOME || "/root",
  ".joi",
);
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function applyMiniRuntimeEnvOverrides(): void {
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../scripts/mini-runtime-env.sh",
  );
  if (!fs.existsSync(scriptPath)) return;

  const result = spawnSync(scriptPath, ["--plain"], {
    encoding: "utf-8",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit ${result.status ?? "unknown"}`;
    console.warn(`mini-runtime-env override skipped: ${reason}`);
    return;
  }

  const lines = (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const equalIndex = line.indexOf("=");
    if (equalIndex <= 0) continue;
    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1);
    if (!key) continue;
    process.env[key] = value;
  }
}

export function loadConfig(): JoiConfig {
  // Load .env from repo root (stable regardless of process cwd)
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  );
  dotenv.config({ path: envPath, override: true });
  applyMiniRuntimeEnvOverrides();

  let raw: Record<string, unknown> = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      raw = JSON.parse(content);
    } catch (err) {
      console.warn(`Failed to parse ${CONFIG_FILE}:`, err);
    }
  }

  // Merge env vars into auth config
  if (!raw.auth) raw.auth = {};
  const auth = raw.auth as Record<string, unknown>;
  if (process.env.ANTHROPIC_API_KEY) auth.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENROUTER_API_KEY) auth.openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.OPENROUTER_MGMT_KEY) auth.openrouterMgmtKey = process.env.OPENROUTER_MGMT_KEY;
  if (process.env.OPENAI_API_KEY) auth.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) auth.googleApiKey = process.env.GOOGLE_API_KEY;
  if (process.env.ELEVENLABS_API_KEY) auth.elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;

  // Merge env vars into gateway config
  if (!raw.gateway) raw.gateway = {};
  const gw = raw.gateway as Record<string, unknown>;
  if (process.env.GATEWAY_PORT) gw.port = Number(process.env.GATEWAY_PORT);
  if (process.env.GATEWAY_PUBLIC_URL) gw.publicUrl = process.env.GATEWAY_PUBLIC_URL;
  if (process.env.GATEWAY_SECRET) gw.secret = process.env.GATEWAY_SECRET;

  // Merge env vars into memory config
  if (!raw.memory) raw.memory = {};
  const mem = raw.memory as Record<string, unknown>;
  if (process.env.OLLAMA_URL) {
    mem.ollamaUrl = process.env.OLLAMA_URL;
  }
  if (process.env.DATABASE_URL) {
    // DB URL handled by pg client directly
  }
  const mem0 = ((mem.mem0 as Record<string, unknown> | undefined) ?? {});
  if (process.env.MEM0_ENABLED) mem0.enabled = process.env.MEM0_ENABLED === "true";
  if (process.env.MEM0_USER_ID) mem0.userId = process.env.MEM0_USER_ID;
  if (process.env.MEM0_APP_ID) mem0.appId = process.env.MEM0_APP_ID;
  if (process.env.MEM0_SHADOW_WRITE_LOCAL) mem0.shadowWriteLocal = process.env.MEM0_SHADOW_WRITE_LOCAL === "true";
  if (process.env.MEM0_SESSION_CONTEXT_LIMIT) mem0.sessionContextLimit = Number(process.env.MEM0_SESSION_CONTEXT_LIMIT);
  mem.mem0 = mem0;

  // Merge env vars into outline config
  if (!raw.outline) raw.outline = {};
  const outline = raw.outline as Record<string, unknown>;
  if (process.env.OUTLINE_API_KEY) outline.apiKey = process.env.OUTLINE_API_KEY;
  if (process.env.OUTLINE_API_URL) outline.apiUrl = process.env.OUTLINE_API_URL;
  if (process.env.OUTLINE_WEBHOOK_SECRET) outline.webhookSecret = process.env.OUTLINE_WEBHOOK_SECRET;
  if (process.env.OUTLINE_SYNC_ENABLED) outline.syncEnabled = process.env.OUTLINE_SYNC_ENABLED === "true";

  // Merge env vars into telegram config
  if (!raw.telegram) raw.telegram = {};
  const tg = raw.telegram as Record<string, unknown>;
  if (process.env.TELEGRAM_BOT_TOKEN) tg.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_BOT_USERNAME) tg.botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (process.env.TELEGRAM_CHAT_ID) tg.chatId = process.env.TELEGRAM_CHAT_ID;

  // Merge env vars into APNs config
  if (!raw.apns) raw.apns = {};
  const apns = raw.apns as Record<string, unknown>;
  if (process.env.APNS_KEY_PATH) apns.keyPath = process.env.APNS_KEY_PATH;
  if (process.env.APNS_KEY_ID) apns.keyId = process.env.APNS_KEY_ID;
  if (process.env.APNS_TEAM_ID) apns.teamId = process.env.APNS_TEAM_ID;
  if (process.env.APNS_BUNDLE_ID) apns.bundleId = process.env.APNS_BUNDLE_ID;
  if (process.env.APNS_BUNDLE_ID_DEVELOPMENT) apns.bundleIdDevelopment = process.env.APNS_BUNDLE_ID_DEVELOPMENT;
  if (process.env.APNS_BUNDLE_ID_PRODUCTION) apns.bundleIdProduction = process.env.APNS_BUNDLE_ID_PRODUCTION;
  if (process.env.APNS_PRODUCTION) apns.production = process.env.APNS_PRODUCTION === "true";

  // Merge env vars into LiveKit config
  if (!raw.livekit) raw.livekit = {};
  const lk = raw.livekit as Record<string, unknown>;
  if (process.env.LIVEKIT_URL) lk.url = process.env.LIVEKIT_URL;
  if (process.env.LIVEKIT_API_KEY) lk.apiKey = process.env.LIVEKIT_API_KEY;
  if (process.env.LIVEKIT_API_SECRET) lk.apiSecret = process.env.LIVEKIT_API_SECRET;
  if (process.env.DEEPGRAM_API_KEY) lk.deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  if (process.env.CARTESIA_API_KEY) lk.cartesiaApiKey = process.env.CARTESIA_API_KEY;
  if (process.env.JOI_VOICE_MODEL && lk.voiceModel === undefined) lk.voiceModel = process.env.JOI_VOICE_MODEL;
  if (process.env.JOI_VOICE_HISTORY_LIMIT) {
    const n = Number(process.env.JOI_VOICE_HISTORY_LIMIT);
    if (Number.isFinite(n) && lk.voiceHistoryLimit === undefined) lk.voiceHistoryLimit = n;
  }
  if (process.env.JOI_VOICE_ENABLE_TOOLS && lk.voiceEnableTools === undefined) lk.voiceEnableTools = process.env.JOI_VOICE_ENABLE_TOOLS === "1";
  if (process.env.JOI_VOICE_INCLUDE_MEMORY && lk.voiceIncludeMemory === undefined) lk.voiceIncludeMemory = process.env.JOI_VOICE_INCLUDE_MEMORY === "1";
  if (process.env.JOI_VOICE_MIN_ENDPOINT_SEC) {
    const n = Number(process.env.JOI_VOICE_MIN_ENDPOINT_SEC);
    if (Number.isFinite(n) && lk.voiceMinEndpointSec === undefined) lk.voiceMinEndpointSec = n;
  }
  if (process.env.JOI_VOICE_MAX_ENDPOINT_SEC) {
    const n = Number(process.env.JOI_VOICE_MAX_ENDPOINT_SEC);
    if (Number.isFinite(n) && lk.voiceMaxEndpointSec === undefined) lk.voiceMaxEndpointSec = n;
  }
  if (process.env.JOI_TTS_CACHE_ENABLED && lk.ttsCacheEnabled === undefined) lk.ttsCacheEnabled = process.env.JOI_TTS_CACHE_ENABLED !== "0";
  if (process.env.JOI_TTS_CACHE_LOCAL_MAX_ITEMS) {
    const n = Number(process.env.JOI_TTS_CACHE_LOCAL_MAX_ITEMS);
    if (Number.isFinite(n) && lk.ttsCacheLocalMaxItems === undefined) lk.ttsCacheLocalMaxItems = n;
  }
  if (process.env.JOI_TTS_CACHE_LOCAL_MAX_BYTES) {
    const n = Number(process.env.JOI_TTS_CACHE_LOCAL_MAX_BYTES);
    if (Number.isFinite(n) && lk.ttsCacheLocalMaxBytes === undefined) lk.ttsCacheLocalMaxBytes = n;
  }
  if (process.env.JOI_TTS_CACHE_MAX_TEXT_CHARS) {
    const n = Number(process.env.JOI_TTS_CACHE_MAX_TEXT_CHARS);
    if (Number.isFinite(n) && lk.ttsCacheMaxTextChars === undefined) lk.ttsCacheMaxTextChars = n;
  }
  if (process.env.JOI_TTS_CACHE_MAX_AUDIO_BYTES) {
    const n = Number(process.env.JOI_TTS_CACHE_MAX_AUDIO_BYTES);
    if (Number.isFinite(n) && lk.ttsCacheMaxAudioBytes === undefined) lk.ttsCacheMaxAudioBytes = n;
  }
  if (process.env.JOI_TTS_CACHE_REDIS_TTL_SEC) {
    const n = Number(process.env.JOI_TTS_CACHE_REDIS_TTL_SEC);
    if (Number.isFinite(n) && lk.ttsCacheRedisTtlSec === undefined) lk.ttsCacheRedisTtlSec = n;
  }
  if (process.env.JOI_TTS_CACHE_PREFIX && lk.ttsCachePrefix === undefined) lk.ttsCachePrefix = process.env.JOI_TTS_CACHE_PREFIX;
  if (process.env.JOI_TTS_CACHE_REDIS_URL && lk.ttsCacheRedisUrl === undefined) lk.ttsCacheRedisUrl = process.env.JOI_TTS_CACHE_REDIS_URL;

  // Merge env vars into tasks config
  if (!raw.tasks) raw.tasks = {};
  const tasks = raw.tasks as Record<string, unknown>;
  if (process.env.JOI_REMINDER_SYNC_MODE) tasks.reminderSyncMode = process.env.JOI_REMINDER_SYNC_MODE;
  if (process.env.JOI_COMPLETED_REMINDER_RETENTION_DAYS) {
    const n = Number(process.env.JOI_COMPLETED_REMINDER_RETENTION_DAYS);
    if (Number.isFinite(n)) tasks.completedReminderRetentionDays = Math.floor(n);
  }
  if (process.env.JOI_PROJECT_LOGBOOK_PAGE_SIZE) {
    const n = Number(process.env.JOI_PROJECT_LOGBOOK_PAGE_SIZE);
    if (Number.isFinite(n)) tasks.projectLogbookPageSize = Math.floor(n);
  }

  // Merge env vars into AutoDev config
  if (!raw.autodev) raw.autodev = {};
  const autodev = raw.autodev as Record<string, unknown>;
  if (process.env.JOI_AUTODEV_EXECUTOR_MODE) autodev.executorMode = process.env.JOI_AUTODEV_EXECUTOR_MODE;
  if (process.env.JOI_AUTODEV_PARALLEL_EXECUTION) {
    autodev.parallelExecution = process.env.JOI_AUTODEV_PARALLEL_EXECUTION !== "0"
      && process.env.JOI_AUTODEV_PARALLEL_EXECUTION.toLowerCase() !== "false";
  }
  if (process.env.JOI_AUTODEV_DISCUSSION_MODE) {
    autodev.discussionMode = process.env.JOI_AUTODEV_DISCUSSION_MODE !== "0"
      && process.env.JOI_AUTODEV_DISCUSSION_MODE.toLowerCase() !== "false";
  }
  if (process.env.JOI_AUTODEV_DISCUSSION_MAX_TURNS) {
    const n = Number(process.env.JOI_AUTODEV_DISCUSSION_MAX_TURNS);
    if (Number.isFinite(n)) autodev.discussionMaxTurns = Math.floor(n);
  }

  const result = JoiConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("Config validation errors:", result.error.format());
    throw new Error("Invalid JOI config");
  }

  return result.data;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveConfig(config: JoiConfig): void {
  const sanitized = JoiConfigSchema.parse(config);
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitized, null, 2), "utf-8");
}
