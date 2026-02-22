import { useEffect, useState, useCallback } from "react";
import { PageHeader, PageBody, Card, Button, Tabs } from "../components/ui";
import type {
  SettingsData, ModelRoute, AvailableModels, OllamaStatus, CoderConfig, LiveKitKeys, LiveKitEdits,
} from "./settings/types";
import GeneralTab from "./settings/GeneralTab";
import VoiceTab from "./settings/VoiceTab";
import ModelsTab from "./settings/ModelsTab";
import MemoryTab from "./settings/MemoryTab";
import IntegrationsTab from "./settings/IntegrationsTab";

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

  const [apiKeys, setApiKeys] = useState({
    anthropicApiKey: "",
    openrouterApiKey: "",
    openaiApiKey: "",
    elevenlabsApiKey: "",
  });
  const [telegramBotToken, setTelegramBotToken] = useState("");

  const [livekitKeys, setLivekitKeys] = useState<LiveKitKeys>({
    deepgramApiKey: "",
    cartesiaApiKey: "",
    apiKey: "",
    apiSecret: "",
  });
  const [livekitEdits, setLivekitEdits] = useState<LiveKitEdits>({
    url: "",
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
  });

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
      };
      setSettings(normalized);

      if (s.livekit) {
        setLivekitEdits({
          url: s.livekit.url || "",
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
        });
      }

      const r = await routesRes.json();
      setRoutes(r.routes || []);

      const m = await modelsRes.json();
      setModels(m);

      const o = await ollamaRes.json();
      setOllama(o);

      const st = await statsRes.json();
      setMemoryStats(st.stats || []);

      const agentsRes = await fetch("/api/agents");
      const agentsData = await agentsRes.json();
      const coder = agentsData.agents?.find((a: { id: string }) => a.id === "coder");
      if (coder) {
        setCoderConfig({
          model: coder.model || "claude-sonnet-4-20250514",
          claudeCodeModel: coder.config?.claudeCodeModel || "",
          defaultCwd: coder.config?.defaultCwd || "~/dev_mm/joi",
        });
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);

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
      url: livekitEdits.url,
      sttProvider: livekitEdits.sttProvider,
      sttModel: livekitEdits.sttModel,
      ttsProvider: livekitEdits.ttsProvider,
      ttsModel: livekitEdits.ttsModel,
      ttsVoice: livekitEdits.ttsVoice,
      pronunciations: livekitEdits.pronunciations.filter((p) => p.word.trim() && p.replacement.trim()),
      voicePrompt: livekitEdits.voicePrompt,
      voiceModel: livekitEdits.voiceModel,
      voiceHistoryLimit: livekitEdits.voiceHistoryLimit,
      voiceEnableTools: livekitEdits.voiceEnableTools,
      voiceIncludeMemory: livekitEdits.voiceIncludeMemory,
      voiceMinEndpointSec: livekitEdits.voiceMinEndpointSec,
      voiceMaxEndpointSec: livekitEdits.voiceMaxEndpointSec,
      ttsCacheEnabled: livekitEdits.ttsCacheEnabled,
      ttsCacheLocalMaxItems: livekitEdits.ttsCacheLocalMaxItems,
      ttsCacheLocalMaxBytes: livekitEdits.ttsCacheLocalMaxBytes,
      ttsCacheMaxTextChars: livekitEdits.ttsCacheMaxTextChars,
      ttsCacheMaxAudioBytes: livekitEdits.ttsCacheMaxAudioBytes,
      ttsCacheRedisTtlSec: livekitEdits.ttsCacheRedisTtlSec,
      ttsCachePrefix: livekitEdits.ttsCachePrefix,
      ttsCacheRedisUrl: livekitEdits.ttsCacheRedisUrl,
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
          telegram: Object.keys(telegramUpdates).length > 0 ? telegramUpdates : undefined,
          livekit: livekitUpdates,
        }),
      });

      if (routes.length > 0) {
        await fetch("/api/settings/model-routes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes }),
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

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
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
            <Button variant="primary" size="sm" onClick={saveSettings} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </>
        }
      />

      <PageBody>
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
          ]}
        />
      </PageBody>
    </>
  );
}
