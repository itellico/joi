export interface ModelRoute {
  task: string;
  model: string;
  provider: string;
}

export type ModelInfo = {
  id: string;
  name: string;
  tier: string;
  costPer1kIn: number;
  costPer1kOut: number;
};

export interface AvailableModels {
  available: {
    anthropic: ModelInfo[];
    openrouter: ModelInfo[];
    ollama: ModelInfo[];
  };
  hasAnthropicKey: boolean;
  hasOpenRouterKey: boolean;
  hasOllama: boolean;
}

export interface OllamaStatus {
  available: boolean;
  modelLoaded: boolean;
  error?: string;
}

export interface CoderConfig {
  model: string;
  claudeCodeModel: string;
  defaultCwd: string;
}

export interface PronunciationRule {
  word: string;
  replacement: string;
  ipa?: string;
}

export interface LiveKitSettings {
  url: string;
  apiKey: string | null;
  apiSecret: string | null;
  language: string;
  sttProvider: string;
  sttModel: string;
  ttsProvider: string;
  ttsModel: string;
  ttsVoice: string;
  deepgramApiKey: string | null;
  cartesiaApiKey: string | null;
  pronunciations: PronunciationRule[];
  voicePrompt: string;
  voiceModel: string;
  voiceHistoryLimit: number;
  voiceEnableTools: boolean;
  voiceIncludeMemory: boolean;
  voiceMinEndpointSec: number;
  voiceMaxEndpointSec: number;
  ttsCacheEnabled: boolean;
  ttsCacheLocalMaxItems: number;
  ttsCacheLocalMaxBytes: number;
  ttsCacheMaxTextChars: number;
  ttsCacheMaxAudioBytes: number;
  ttsCacheRedisTtlSec: number;
  ttsCachePrefix: string;
  ttsCacheRedisUrl: string;
  wakeWordEnabled: boolean;
}

export interface SettingsData {
  network?: {
    homeIp: string | null;
    roadIp: string | null;
    activeIp: string | null;
    activeMode: string;
    configuredMode: string;
  };
  auth: {
    anthropicApiKey: string | null;
    openrouterApiKey: string | null;
    openaiApiKey: string | null;
    elevenlabsApiKey: string | null;
  };
  memory: {
    ollamaUrl: string;
    embeddingModel: string;
    embeddingDimension: number;
    vectorWeight: number;
    textWeight: number;
    autoLearn: boolean;
    flushTokenThreshold: number;
    mmr: { enabled: boolean; lambda: number };
    temporalDecay: { enabled: boolean; halfLifeDays: number };
    mem0: {
      enabled: boolean;
      userId: string;
      appId: string;
      shadowWriteLocal: boolean;
      sessionContextLimit: number;
    };
  };
  obsidian: {
    vaultPath: string;
    syncEnabled: boolean;
  };
  telegram: {
    botToken: string | null;
    botUsername: string | null;
    chatId: string | null;
  };
  tasks: {
    lockedProjects: string[];
    reminderSyncMode: "cron_only" | "cron_plus_things";
    completedReminderRetentionDays: number;
    projectLogbookPageSize: number;
  };
  autodev: {
    executorMode: "auto" | "claude-code" | "gemini-cli" | "codex-cli";
    parallelExecution: boolean;
    discussionMode: boolean;
    discussionMaxTurns: number;
  };
  livekit: LiveKitSettings;
}

export type ModelOption = { id: string; label: string };

export interface LiveKitKeys {
  deepgramApiKey: string;
  cartesiaApiKey: string;
  apiKey: string;
  apiSecret: string;
}

export interface LiveKitEdits {
  url: string;
  language: string;
  sttProvider: string;
  sttModel: string;
  ttsProvider: string;
  ttsModel: string;
  ttsVoice: string;
  pronunciations: PronunciationRule[];
  voicePrompt: string;
  voiceModel: string;
  voiceHistoryLimit: number;
  voiceEnableTools: boolean;
  voiceIncludeMemory: boolean;
  voiceMinEndpointSec: number;
  voiceMaxEndpointSec: number;
  ttsCacheEnabled: boolean;
  ttsCacheLocalMaxItems: number;
  ttsCacheLocalMaxBytes: number;
  ttsCacheMaxTextChars: number;
  ttsCacheMaxAudioBytes: number;
  ttsCacheRedisTtlSec: number;
  ttsCachePrefix: string;
  ttsCacheRedisUrl: string;
  wakeWordEnabled: boolean;
}
