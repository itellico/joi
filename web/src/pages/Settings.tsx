import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader, PageBody, Card, Button, MetaText, Tabs } from "../components/ui";
import type {
  SettingsData, ModelRoute, AvailableModels, OllamaStatus, CoderConfig, LiveKitKeys, LiveKitEdits,
} from "./settings/types";
import GeneralTab from "./settings/GeneralTab";
import VoiceTab from "./settings/VoiceTab";
import ModelsTab from "./settings/ModelsTab";
import MemoryTab from "./settings/MemoryTab";
import IntegrationsTab from "./settings/IntegrationsTab";
import AutodevTab from "./settings/AutodevTab";
import CrmTab from "./settings/CrmTab";
import HumanizerTab from "./settings/HumanizerTab";
import { LANGUAGE_PRESETS, type LanguagePresetId } from "./settings/languagePresets";

type SettingsDraftSnapshot = {
  memory: SettingsData["memory"];
  obsidian: SettingsData["obsidian"];
  tasks: SettingsData["tasks"];
  autodev: SettingsData["autodev"];
  telegram: {
    botUsername: string;
    chatId: string;
  };
  livekit: LiveKitEdits;
  routes: ModelRoute[];
  coderConfig: CoderConfig | null;
  applyLanguageToAllChannels: boolean;
};

const EMPTY_API_KEYS = {
  anthropicApiKey: "",
  openrouterApiKey: "",
  openaiApiKey: "",
  elevenlabsApiKey: "",
};

const EMPTY_LIVEKIT_KEYS: LiveKitKeys = {
  deepgramApiKey: "",
  cartesiaApiKey: "",
  apiKey: "",
  apiSecret: "",
};

function createDefaultLivekitEdits(): LiveKitEdits {
  return {
    url: "",
    language: "en",
    sttProvider: "deepgram",
    sttModel: "nova-3",
    ttsProvider: "cartesia",
    ttsModel: "sonic-2",
    ttsVoice: "",
    pronunciations: [{ word: "JOI", replacement: "Joy" }],
    voicePrompt: "",
    voiceModel: "openai/gpt-4o-mini",
    voiceHistoryLimit: 8,
    voiceEnableTools: false,
    voiceIncludeMemory: false,
    voiceMinEndpointSec: 0.15,
    voiceMaxEndpointSec: 0.8,
    ttsCacheEnabled: true,
    ttsCacheLocalMaxItems: 512,
    ttsCacheLocalMaxBytes: 64 * 1024 * 1024,
    ttsCacheMaxTextChars: 280,
    ttsCacheMaxAudioBytes: 2 * 1024 * 1024,
    ttsCacheRedisTtlSec: 604800,
    ttsCachePrefix: "joi:tts:v1",
    ttsCacheRedisUrl: "",
    wakeWordEnabled: true,
  };
}

function cloneLivekitEdits(livekitEdits: LiveKitEdits): LiveKitEdits {
  return {
    ...livekitEdits,
    pronunciations: livekitEdits.pronunciations.map((rule) => ({ ...rule })),
  };
}

function normalizeRoutes(routes: ModelRoute[]): ModelRoute[] {
  return [...routes]
    .map((route) => ({ ...route }))
    .sort((a, b) => a.task.localeCompare(b.task));
}

function buildSettingsDraftSnapshot(params: {
  settings: SettingsData;
  routes: ModelRoute[];
  coderConfig: CoderConfig | null;
  livekitEdits: LiveKitEdits;
  applyLanguageToAllChannels: boolean;
}): SettingsDraftSnapshot {
  return {
    memory: {
      ...params.settings.memory,
      mem0: { ...params.settings.memory.mem0 },
      mmr: { ...params.settings.memory.mmr },
      temporalDecay: { ...params.settings.memory.temporalDecay },
    },
    obsidian: { ...params.settings.obsidian },
    tasks: {
      lockedProjects: [...params.settings.tasks.lockedProjects],
      reminderSyncMode: params.settings.tasks.reminderSyncMode,
      completedReminderRetentionDays: params.settings.tasks.completedReminderRetentionDays,
      projectLogbookPageSize: params.settings.tasks.projectLogbookPageSize,
    },
    autodev: {
      ...params.settings.autodev,
    },
    telegram: {
      botUsername: params.settings.telegram.botUsername || "",
      chatId: params.settings.telegram.chatId || "",
    },
    livekit: cloneLivekitEdits(params.livekitEdits),
    routes: normalizeRoutes(params.routes),
    coderConfig: params.coderConfig
      ? {
          model: params.coderConfig.model,
          claudeCodeModel: params.coderConfig.claudeCodeModel,
          defaultCwd: params.coderConfig.defaultCwd,
        }
      : null,
    applyLanguageToAllChannels: params.applyLanguageToAllChannels,
  };
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [models, setModels] = useState<AvailableModels | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [memoryStats, setMemoryStats] = useState<Array<{ area: string; count: number; avg_confidence: number }>>([]);
  const [coderConfig, setCoderConfig] = useState<CoderConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pullingModel, setPullingModel] = useState(false);
  const [pullingLlmModel, setPullingLlmModel] = useState<string | null>(null);
  const [applyLanguageToAllChannels, setApplyLanguageToAllChannels] = useState(false);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState<string>("");

  const [apiKeys, setApiKeys] = useState(EMPTY_API_KEYS);
  const [telegramBotToken, setTelegramBotToken] = useState("");

  const [livekitKeys, setLivekitKeys] = useState<LiveKitKeys>(EMPTY_LIVEKIT_KEYS);
  const [livekitEdits, setLivekitEdits] = useState<LiveKitEdits>(createDefaultLivekitEdits);

  const fetchAll = useCallback(async () => {
    try {
      const [settingsRes, routesRes, modelsRes, ollamaRes, statsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/model-routes"),
        fetch("/api/settings/models"),
        fetch("/api/settings/ollama"),
        fetch("/api/memories/stats"),
      ]);

      const s = await settingsRes.json();
      const normalized: SettingsData = {
        ...s,
        memory: {
          ...s.memory,
          mem0: {
            enabled: s.memory?.mem0?.enabled ?? false,
            userId: s.memory?.mem0?.userId ?? "primary-user",
            appId: s.memory?.mem0?.appId ?? "",
            shadowWriteLocal: s.memory?.mem0?.shadowWriteLocal ?? true,
            sessionContextLimit: s.memory?.mem0?.sessionContextLimit ?? 8,
          },
        },
        tasks: {
          lockedProjects: Array.isArray(s.tasks?.lockedProjects) ? s.tasks.lockedProjects : [],
          reminderSyncMode: s.tasks?.reminderSyncMode === "cron_only" ? "cron_only" : "cron_plus_things",
          completedReminderRetentionDays:
            Number.isFinite(Number(s.tasks?.completedReminderRetentionDays))
              ? Math.max(0, Math.floor(Number(s.tasks?.completedReminderRetentionDays)))
              : 14,
          projectLogbookPageSize:
            Number.isFinite(Number(s.tasks?.projectLogbookPageSize))
              ? Math.min(200, Math.max(10, Math.floor(Number(s.tasks?.projectLogbookPageSize))))
              : 25,
        },
        autodev: {
          executorMode: s.autodev?.executorMode === "claude-code"
            || s.autodev?.executorMode === "gemini-cli"
            || s.autodev?.executorMode === "codex-cli"
            || s.autodev?.executorMode === "auto"
            ? s.autodev.executorMode
            : "auto",
          parallelExecution: s.autodev?.parallelExecution !== false,
          discussionMode: s.autodev?.discussionMode === true,
          discussionMaxTurns: Number.isFinite(Number(s.autodev?.discussionMaxTurns))
            ? Math.min(5, Math.max(1, Math.floor(Number(s.autodev.discussionMaxTurns))))
            : 5,
        },
      };
      setSettings(normalized);

      const nextLivekitEdits: LiveKitEdits = s.livekit
        ? {
          url: s.livekit.url || "",
          language: s.livekit.language || "en",
          sttProvider: s.livekit.sttProvider || "deepgram",
          sttModel: s.livekit.sttModel || "nova-3",
          ttsProvider: s.livekit.ttsProvider || "cartesia",
          ttsModel: s.livekit.ttsModel || "sonic-2",
          ttsVoice: s.livekit.ttsVoice || "",
          pronunciations: s.livekit.pronunciations?.length > 0
            ? s.livekit.pronunciations
            : [{ word: "JOI", replacement: "Joy" }],
          voicePrompt: s.livekit.voicePrompt || "",
          voiceModel: s.livekit.voiceModel || "openai/gpt-4o-mini",
          voiceHistoryLimit: Number(s.livekit.voiceHistoryLimit || 8),
          voiceEnableTools: !!s.livekit.voiceEnableTools,
          voiceIncludeMemory: !!s.livekit.voiceIncludeMemory,
          voiceMinEndpointSec: Number(s.livekit.voiceMinEndpointSec || 0.15),
          voiceMaxEndpointSec: Number(s.livekit.voiceMaxEndpointSec || 0.8),
          ttsCacheEnabled: s.livekit.ttsCacheEnabled !== false,
          ttsCacheLocalMaxItems: Number(s.livekit.ttsCacheLocalMaxItems || 512),
          ttsCacheLocalMaxBytes: Number(s.livekit.ttsCacheLocalMaxBytes || 64 * 1024 * 1024),
          ttsCacheMaxTextChars: Number(s.livekit.ttsCacheMaxTextChars || 280),
          ttsCacheMaxAudioBytes: Number(s.livekit.ttsCacheMaxAudioBytes || 2 * 1024 * 1024),
          ttsCacheRedisTtlSec: Number(s.livekit.ttsCacheRedisTtlSec || 604800),
          ttsCachePrefix: s.livekit.ttsCachePrefix || "joi:tts:v1",
          ttsCacheRedisUrl: s.livekit.ttsCacheRedisUrl || "",
          wakeWordEnabled: s.livekit.wakeWordEnabled !== false,
        }
        : createDefaultLivekitEdits();
      setLivekitEdits(nextLivekitEdits);

      const r = await routesRes.json() as { routes?: ModelRoute[] };
      const nextRoutes = r.routes || [];
      setRoutes(nextRoutes);

      const m = await modelsRes.json();
      setModels(m);

      const o = await ollamaRes.json();
      setOllama(o);

      const st = await statsRes.json();
      setMemoryStats(st.stats || []);

      const agentsRes = await fetch("/api/agents");
      const agentsData = await agentsRes.json() as {
        agents?: Array<{ id: string; model?: string; config?: { claudeCodeModel?: string; defaultCwd?: string } }>;
      };
      const coder = agentsData.agents?.find((a) => a.id === "coder");
      const nextCoderConfig = coder
        ? {
          model: coder.model || "claude-sonnet-4-20250514",
          claudeCodeModel: coder.config?.claudeCodeModel || "",
          defaultCwd: coder.config?.defaultCwd || "~/dev_mm/joi",
        }
        : null;
      setCoderConfig(nextCoderConfig);

      const baselineSnapshot = buildSettingsDraftSnapshot({
        settings: normalized,
        routes: nextRoutes,
        coderConfig: nextCoderConfig,
        livekitEdits: nextLivekitEdits,
        applyLanguageToAllChannels: false,
      });
      setInitialDraftSnapshot(JSON.stringify(baselineSnapshot));
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const currentDraftSnapshot = useMemo(() => {
    if (!settings) return "";
    const snapshot = buildSettingsDraftSnapshot({
      settings,
      routes,
      coderConfig,
      livekitEdits,
      applyLanguageToAllChannels,
    });
    return JSON.stringify(snapshot);
  }, [applyLanguageToAllChannels, coderConfig, livekitEdits, routes, settings]);

  const hasSecretKeyEdits = useMemo(() => {
    const keyFields = [
      apiKeys.anthropicApiKey,
      apiKeys.openrouterApiKey,
      apiKeys.openaiApiKey,
      apiKeys.elevenlabsApiKey,
      telegramBotToken,
      livekitKeys.deepgramApiKey,
      livekitKeys.cartesiaApiKey,
      livekitKeys.apiKey,
      livekitKeys.apiSecret,
    ];
    return keyFields.some((value) => value.trim().length > 0 && !value.includes("***"));
  }, [apiKeys, livekitKeys, telegramBotToken]);

  const hasUnsavedChanges = useMemo(() => {
    if (!settings) return false;
    if (hasSecretKeyEdits) return true;
    if (!initialDraftSnapshot) return false;
    return currentDraftSnapshot !== initialDraftSnapshot;
  }, [currentDraftSnapshot, hasSecretKeyEdits, initialDraftSnapshot, settings]);

  const clearSecretDraftInputs = useCallback(() => {
    setApiKeys(EMPTY_API_KEYS);
    setTelegramBotToken("");
    setLivekitKeys(EMPTY_LIVEKIT_KEYS);
  }, []);

  useEffect(() => {
    if (hasUnsavedChanges) {
      setSaved(false);
    }
  }, [hasUnsavedChanges]);

  const saveSettings = async (options?: {
    livekitEdits?: LiveKitEdits;
    routes?: ModelRoute[];
    applyLanguageToAllChannels?: boolean;
    restartLivekit?: boolean;
  }) => {
    setSaving(true);
    setSaved(false);

    const effectiveLivekitEdits = options?.livekitEdits ?? livekitEdits;
    const effectiveRoutes = options?.routes ?? routes;
    const effectiveApplyLanguageToAllChannels = options?.applyLanguageToAllChannels ?? applyLanguageToAllChannels;

    const authUpdates: Record<string, string> = {};
    if (apiKeys.anthropicApiKey && !apiKeys.anthropicApiKey.includes("***")) {
      authUpdates.anthropicApiKey = apiKeys.anthropicApiKey;
    }
    if (apiKeys.openrouterApiKey && !apiKeys.openrouterApiKey.includes("***")) {
      authUpdates.openrouterApiKey = apiKeys.openrouterApiKey;
    }
    if (apiKeys.openaiApiKey && !apiKeys.openaiApiKey.includes("***")) {
      authUpdates.openaiApiKey = apiKeys.openaiApiKey;
    }
    if (apiKeys.elevenlabsApiKey && !apiKeys.elevenlabsApiKey.includes("***")) {
      authUpdates.elevenlabsApiKey = apiKeys.elevenlabsApiKey;
    }

    const livekitUpdates: Record<string, unknown> = {
      url: effectiveLivekitEdits.url,
      language: effectiveLivekitEdits.language,
      sttProvider: effectiveLivekitEdits.sttProvider,
      sttModel: effectiveLivekitEdits.sttModel,
      ttsProvider: effectiveLivekitEdits.ttsProvider,
      ttsModel: effectiveLivekitEdits.ttsModel,
      ttsVoice: effectiveLivekitEdits.ttsVoice,
      pronunciations: effectiveLivekitEdits.pronunciations.filter((p) => p.word.trim() && p.replacement.trim()),
      voicePrompt: effectiveLivekitEdits.voicePrompt,
      voiceModel: effectiveLivekitEdits.voiceModel,
      voiceHistoryLimit: effectiveLivekitEdits.voiceHistoryLimit,
      voiceEnableTools: effectiveLivekitEdits.voiceEnableTools,
      voiceIncludeMemory: effectiveLivekitEdits.voiceIncludeMemory,
      voiceMinEndpointSec: effectiveLivekitEdits.voiceMinEndpointSec,
      voiceMaxEndpointSec: effectiveLivekitEdits.voiceMaxEndpointSec,
      ttsCacheEnabled: effectiveLivekitEdits.ttsCacheEnabled,
      ttsCacheLocalMaxItems: effectiveLivekitEdits.ttsCacheLocalMaxItems,
      ttsCacheLocalMaxBytes: effectiveLivekitEdits.ttsCacheLocalMaxBytes,
      ttsCacheMaxTextChars: effectiveLivekitEdits.ttsCacheMaxTextChars,
      ttsCacheMaxAudioBytes: effectiveLivekitEdits.ttsCacheMaxAudioBytes,
      ttsCacheRedisTtlSec: effectiveLivekitEdits.ttsCacheRedisTtlSec,
      ttsCachePrefix: effectiveLivekitEdits.ttsCachePrefix,
      ttsCacheRedisUrl: effectiveLivekitEdits.ttsCacheRedisUrl,
      wakeWordEnabled: effectiveLivekitEdits.wakeWordEnabled,
      applyLanguageToAllChannels: effectiveApplyLanguageToAllChannels,
    };
    if (livekitKeys.deepgramApiKey && !livekitKeys.deepgramApiKey.includes("***")) {
      livekitUpdates.deepgramApiKey = livekitKeys.deepgramApiKey;
    }
    if (livekitKeys.cartesiaApiKey && !livekitKeys.cartesiaApiKey.includes("***")) {
      livekitUpdates.cartesiaApiKey = livekitKeys.cartesiaApiKey;
    }
    if (livekitKeys.apiKey && !livekitKeys.apiKey.includes("***")) {
      livekitUpdates.apiKey = livekitKeys.apiKey;
    }
    if (livekitKeys.apiSecret && !livekitKeys.apiSecret.includes("***")) {
      livekitUpdates.apiSecret = livekitKeys.apiSecret;
    }
    try {
      const telegramUpdates: Record<string, string> = {};
      if (telegramBotToken && !telegramBotToken.includes("***")) {
        telegramUpdates.botToken = telegramBotToken;
      }
      if (settings?.telegram.botUsername !== undefined) {
        telegramUpdates.botUsername = settings.telegram.botUsername || "";
      }
      if (settings?.telegram.chatId !== undefined) {
        telegramUpdates.chatId = settings.telegram.chatId || "";
      }

      const memoryUpdates = settings
        ? {
            ...settings.memory,
            mem0: {
              ...settings.memory.mem0,
            },
          }
        : undefined;

      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: Object.keys(authUpdates).length > 0 ? authUpdates : undefined,
          memory: memoryUpdates,
          obsidian: settings?.obsidian,
          tasks: settings?.tasks,
          autodev: settings?.autodev,
          telegram: Object.keys(telegramUpdates).length > 0 ? telegramUpdates : undefined,
          livekit: livekitUpdates,
        }),
      });

      if (effectiveRoutes.length > 0) {
        await fetch("/api/settings/model-routes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes: effectiveRoutes }),
        });
      }

      if (coderConfig) {
        await fetch("/api/agents/coder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: coderConfig.model,
            config: {
              claudeCodeModel: coderConfig.claudeCodeModel || null,
              defaultCwd: coderConfig.defaultCwd,
            },
          }),
        });
      }

      if (options?.restartLivekit) {
        try {
          await fetch("/api/services/livekit/restart", { method: "POST" });
        } catch (err) {
          console.warn("LiveKit restart failed after settings save:", err);
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      clearSecretDraftInputs();
      setApplyLanguageToAllChannels(false);
      fetchAll();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const pullOllamaModel = async () => {
    setPullingModel(true);
    try {
      await fetch("/api/settings/ollama/pull", { method: "POST" });
      const o = await (await fetch("/api/settings/ollama")).json();
      setOllama(o);
    } catch (err) {
      console.error("Pull failed:", err);
    } finally {
      setPullingModel(false);
    }
  };

  const pullOllamaLlmModel = async (model: string) => {
    const trimmed = model.trim();
    if (!trimmed) return;
    setPullingLlmModel(trimmed);
    try {
      await fetch("/api/settings/ollama/pull-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: trimmed }),
      });
      await fetchAll();
    } catch (err) {
      console.error(`Failed to pull Ollama LLM model ${trimmed}:`, err);
    } finally {
      setPullingLlmModel(null);
    }
  };

  const updateRoute = (task: string, field: "model" | "provider", value: string) => {
    setRoutes((prev) =>
      prev.map((r) => {
        if (r.task !== task) return r;
        if (field === "provider" && value !== r.provider && models) {
          const providerModels = models.available[value as keyof typeof models.available];
          const firstModel = providerModels?.[0]?.id || r.model;
          return { ...r, provider: value, model: firstModel };
        }
        return { ...r, [field]: value };
      }),
    );
  };

  const mergePresetRoutes = (existingRoutes: ModelRoute[], presetRoutes: ModelRoute[]): ModelRoute[] => {
    if (existingRoutes.length === 0) return presetRoutes.map((r) => ({ ...r }));

    const byTask = new Map(presetRoutes.map((r) => [r.task, r]));
    const next = existingRoutes.map((route) => {
      const presetRoute = byTask.get(route.task);
      return presetRoute ? { ...route, model: presetRoute.model, provider: presetRoute.provider } : route;
    });
    const knownTasks = new Set(next.map((r) => r.task));
    for (const route of presetRoutes) {
      if (!knownTasks.has(route.task)) next.push({ ...route });
    }
    return next;
  };

  const applyLanguagePreset = async (presetId: LanguagePresetId) => {
    if (saving) return;
    const preset = LANGUAGE_PRESETS[presetId];
    const nextLivekitEdits: LiveKitEdits = {
      ...livekitEdits,
      ...preset.livekit,
      pronunciations: preset.livekit.pronunciations.map((rule) => ({ ...rule })),
    };
    const nextRoutes = mergePresetRoutes(routes, preset.routes);

    setSaved(false);
    setApplyLanguageToAllChannels(true);
    setLivekitEdits(nextLivekitEdits);
    setRoutes(nextRoutes);

    await saveSettings({
      livekitEdits: nextLivekitEdits,
      routes: nextRoutes,
      applyLanguageToAllChannels: true,
      restartLivekit: true,
    });
  };

  const languageLabelByCode: Record<string, string> = {
    en: "English",
    de: "Deutsch",
    fr: "Français",
    es: "Español",
    it: "Italiano",
    pt: "Português",
  };

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <PageBody>
          <Card><p className="text-muted">Loading...</p></Card>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <>
            {saved && <span className="text-success text-md">Saved!</span>}
            <Button variant="primary" size="sm" onClick={() => void saveSettings()} disabled={saving || !hasUnsavedChanges}>
              {saving ? "Saving..." : hasUnsavedChanges ? "Save Changes" : "No Changes"}
            </Button>
          </>
        }
      />

      <PageBody>
        <Card className="mb-4">
          <h3 className="mb-2">Language Presets</h3>
          <MetaText size="sm" className="block mb-3 text-md">
            Apply a safe preset for voice language, STT/TTS defaults, and model routing. Presets are saved immediately and LiveKit is restarted automatically.
          </MetaText>
          <MetaText size="sm" className="block mb-3 text-md">
            Current staged language: <strong>{languageLabelByCode[livekitEdits.language] || livekitEdits.language}</strong>
          </MetaText>
          <div className="flex-row gap-2 flex-wrap mb-3">
            <Button size="sm" variant="ghost" onClick={() => void applyLanguagePreset("de_safe")} disabled={saving}>
              Apply German Safe
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void applyLanguagePreset("en_safe")} disabled={saving}>
              Apply English Safe
            </Button>
          </div>
          <label className="flex-row items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={applyLanguageToAllChannels}
              onChange={(e) => setApplyLanguageToAllChannels(e.target.checked)}
            />
            Also apply selected language to all existing channels when applying a preset
          </label>
        </Card>

        <Tabs
          defaultValue="general"
          tabs={[
            {
              value: "general",
              label: "General",
              content: (
                <GeneralTab
                  settings={settings}
                  apiKeys={apiKeys}
                  setApiKeys={setApiKeys}
                  livekitKeys={livekitKeys}
                  setLivekitKeys={setLivekitKeys}
                />
              ),
            },
            {
              value: "crm",
              label: "CRM",
              content: <CrmTab />,
            },
            {
              value: "voice",
              label: "Voice",
              content: (
                <VoiceTab
                  settings={settings}
                  livekitKeys={livekitKeys}
                  setLivekitKeys={setLivekitKeys}
                  livekitEdits={livekitEdits}
                  setLivekitEdits={setLivekitEdits}
                />
              ),
            },
            {
              value: "models",
              label: "Models",
              content: (
                <ModelsTab
                  settings={settings}
                  routes={routes}
                  models={models}
                  ollama={ollama}
                  pullingModel={pullingModel}
                  pullingLlmModel={pullingLlmModel}
                  updateRoute={updateRoute}
                  pullOllamaModel={pullOllamaModel}
                  pullOllamaLlmModel={pullOllamaLlmModel}
                />
              ),
            },
            {
              value: "memory",
              label: "Memory",
              content: (
                <MemoryTab
                  settings={settings}
                  setSettings={setSettings}
                  memoryStats={memoryStats}
                />
              ),
            },
            {
              value: "autodev",
              label: "AutoDev",
              content: (
                <AutodevTab
                  settings={settings}
                  setSettings={setSettings}
                />
              ),
            },
            {
              value: "integrations",
              label: "Integrations",
              content: (
                <IntegrationsTab
                  settings={settings}
                  setSettings={setSettings}
                  coderConfig={coderConfig}
                  setCoderConfig={setCoderConfig}
                  models={models}
                  telegramBotToken={telegramBotToken}
                  setTelegramBotToken={setTelegramBotToken}
                />
              ),
            },
            {
              value: "humanizer",
              label: "Humanizer",
              content: <HumanizerTab />,
            },
          ]}
        />
      </PageBody>
    </>
  );
}
