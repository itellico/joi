import { z } from "zod";
import os from "node:os";
import path from "node:path";

// Model route: which provider + model to use for a task
const ModelRouteSchema = z.object({
  model: z.string(),
  provider: z.enum(["anthropic", "openrouter", "ollama"]),
});

// Model routing config: map task types to specific models
const ModelRoutesSchema = z.object({
  chat: ModelRouteSchema.optional(),
  utility: ModelRouteSchema.optional(),
}).optional();

export const ModelConfigSchema = z.object({
  primary: z.string().default("claude-sonnet-4-20250514"),
  fallbacks: z.array(z.string()).default([]),
  routes: ModelRoutesSchema,
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  model: ModelConfigSchema.optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).default([]),
  maxSpawnDepth: z.number().default(2),
});

export const GatewayConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default("0.0.0.0"),
  publicUrl: z.string().optional(), // e.g. https://joi.itellico.org — used for OAuth redirects
  secret: z.string().optional(),
  corsOrigins: z.array(z.string()).default(["http://localhost:5173"]),
});

export const AuthConfigSchema = z.object({
  anthropicApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  openrouterMgmtKey: z.string().optional(), // Management key for OpenRouter admin API (credits, activity, keys)
  openaiApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  elevenlabsApiKey: z.string().optional(),
});

export const MemoryConfigSchema = z.object({
  ollamaUrl: z.string().default("http://localhost:11434"),
  embeddingModel: z.string().default("nomic-embed-text"),
  embeddingDimension: z.number().default(768),
  vectorWeight: z.number().default(0.7),
  textWeight: z.number().default(0.3),
  autoLearn: z.boolean().default(true),
  flushTokenThreshold: z.number().default(80_000),
  mmr: z
    .object({
      enabled: z.boolean().default(true),
      lambda: z.number().default(0.7),
    })
    .default({}),
  temporalDecay: z
    .object({
      enabled: z.boolean().default(true),
      halfLifeDays: z.number().default(30),
    })
    .default({}),
  mem0: z
    .object({
      enabled: z.boolean().default(false),
      userId: z.string().default("primary-user"),
      appId: z.string().optional(),
      shadowWriteLocal: z.boolean().default(false),
      sessionContextLimit: z.number().default(8),
    })
    .default({}),
});

export const ObsidianConfigSchema = z.object({
  vaultPath: z.string().optional(),
  syncEnabled: z.boolean().default(false),
  watchPatterns: z.array(z.string()).default(["**/*.md"]),
  ignorePatterns: z.array(z.string()).default([".obsidian/**", ".trash/**"]),
});

export const OutlineConfigSchema = z.object({
  apiKey: z.string().optional(),
  apiUrl: z.string().default("https://go-outline.itellico.ai/api"),
  syncEnabled: z.boolean().default(false),
  syncIntervalMs: z.number().default(3 * 60 * 1000),
  webhookSecret: z.string().optional(),
});

export const TelegramConfigSchema = z.object({
  botToken: z.string().optional(),
  botUsername: z.string().optional(), // e.g. "joi_pa_bot"
  chatId: z.string().optional(),     // user's chat ID for notifications
});

export const APNsConfigSchema = z.object({
  keyPath: z.string().optional(),       // Path to .p8 auth key file
  keyId: z.string().optional(),         // Key ID from Apple Developer portal
  teamId: z.string().optional(),        // Team ID from Apple Developer portal
  bundleId: z.string().default("com.joi.app.ios"),
  bundleIdDevelopment: z.string().optional(),
  bundleIdProduction: z.string().optional(),
  production: z.boolean().default(false),
});

export const PronunciationRuleSchema = z.object({
  word: z.string(),                           // text to match (case-insensitive)
  replacement: z.string(),                    // what TTS should say instead
  ipa: z.string().optional(),                 // optional IPA for Cartesia pronunciation dict
});

export const LiveKitConfigSchema = z.object({
  url: z.string().optional(),                // wss://your-project.livekit.cloud
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  language: z.string().default("en"),        // Global default language for STT/TTS (per-channel overrides via channel_configs.language)
  sttProvider: z.enum(["deepgram", "openai"]).default("deepgram"),
  sttModel: z.string().default("nova-3"),
  ttsProvider: z.enum(["cartesia", "elevenlabs", "openai"]).default("cartesia"),
  ttsModel: z.string().default("sonic-2"),
  ttsVoice: z.string().optional(),           // provider-specific voice ID
  deepgramApiKey: z.string().optional(),
  cartesiaApiKey: z.string().optional(),
  pronunciations: z.array(PronunciationRuleSchema).default([
    { word: "JOI", replacement: "Joy" },
  ]),
  voicePrompt: z.string().default(
    "You are responding via voice (text-to-speech). Keep responses concise and conversational. " +
    "Avoid markdown, bullet points, code blocks, or other visual formatting — speak naturally. " +
    "Use the following pronunciation guides when writing these words: JOI should be written as \"Joy\"."
  ),
  voiceModel: z.string().default("openai/gpt-4o-mini"),
  voiceHistoryLimit: z.number().int().min(2).max(50).default(8),
  voiceEnableTools: z.boolean().default(false),
  voiceIncludeMemory: z.boolean().default(false),
  voiceMinEndpointSec: z.number().min(0).default(0.15),
  voiceMaxEndpointSec: z.number().min(0).default(0.8),
  ttsCacheEnabled: z.boolean().default(true),
  ttsCacheLocalMaxItems: z.number().int().min(0).default(512),
  ttsCacheLocalMaxBytes: z.number().int().min(1024 * 1024).default(64 * 1024 * 1024),
  ttsCacheMaxTextChars: z.number().int().min(32).default(280),
  ttsCacheMaxAudioBytes: z.number().int().min(16384).default(2 * 1024 * 1024),
  ttsCacheRedisTtlSec: z.number().int().min(60).default(7 * 24 * 60 * 60),
  ttsCachePrefix: z.string().default("joi:tts:v1"),
  ttsCacheRedisUrl: z.string().optional(),   // Optional local/managed Redis URL (redis://...)
  wakeWordEnabled: z.boolean().default(true),
});

export const TasksConfigSchema = z.object({
  lockedProjects: z.array(z.string()).default([]),
  reminderSyncMode: z.enum(["cron_only", "cron_plus_things"]).default("cron_plus_things"),
  completedReminderRetentionDays: z.number().int().min(0).max(365).default(14),
  projectLogbookPageSize: z.number().int().min(10).max(200).default(25),
});

export const MediaConfigSchema = z.object({
  storagePath: z.string().default(path.join(os.homedir(), ".joi", "media")),
  thumbnailMaxWidth: z.number().default(400),
  thumbnailQuality: z.number().default(80),
  maxFileSizeMB: z.number().default(100),
  downloadEnabled: z.boolean().default(true),
}).default({});

export const AutoDevConfigSchema = z.object({
  executorMode: z.enum(["auto", "claude-code", "gemini-cli", "codex-cli"]).default("auto"),
  parallelExecution: z.boolean().default(true),
  discussionMode: z.boolean().default(false),
  discussionMaxTurns: z.number().int().min(1).max(5).default(5),
});

export const JoiConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  agents: z.array(AgentConfigSchema).default([]),
  models: ModelConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  obsidian: ObsidianConfigSchema.default({}),
  outline: OutlineConfigSchema.default({}),
  telegram: TelegramConfigSchema.default({}),
  apns: APNsConfigSchema.default({}),
  tasks: TasksConfigSchema.default({}),
  livekit: LiveKitConfigSchema.default({}),
  autodev: AutoDevConfigSchema.default({}),
  media: MediaConfigSchema,
});

export type JoiConfig = z.infer<typeof JoiConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type LiveKitConfig = z.infer<typeof LiveKitConfigSchema>;
export type MediaConfig = z.infer<typeof MediaConfigSchema>;
