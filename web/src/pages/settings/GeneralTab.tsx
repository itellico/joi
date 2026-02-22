import { useEffect, useState } from "react";
import { Badge, Button, Card, FormField, FormGrid, MetaText } from "../../components/ui";
import type { SettingsData, LiveKitKeys } from "./types";

interface GeneralTabProps {
  settings: SettingsData;
  apiKeys: { anthropicApiKey: string; openrouterApiKey: string; openaiApiKey: string; elevenlabsApiKey: string };
  setApiKeys: React.Dispatch<React.SetStateAction<GeneralTabProps["apiKeys"]>>;
  livekitKeys: LiveKitKeys;
  setLivekitKeys: React.Dispatch<React.SetStateAction<LiveKitKeys>>;
}

type ServiceStatus = "green" | "orange" | "red";
type ServiceHealth = Record<string, { status: ServiceStatus; detail?: string }>;
type StartableService = "watchdog" | "autodev" | "livekit";

function badgeFor(status: ServiceStatus): "success" | "warning" | "error" {
  if (status === "green") return "success";
  if (status === "orange") return "warning";
  return "error";
}

export default function GeneralTab({ settings, apiKeys, setApiKeys, livekitKeys, setLivekitKeys }: GeneralTabProps) {
  const [services, setServices] = useState<ServiceHealth>({});
  const [loadingServices, setLoadingServices] = useState(false);
  const [starting, setStarting] = useState<StartableService | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string>("");

  const fetchServices = async () => {
    setLoadingServices(true);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices((data.services || {}) as ServiceHealth);
    } catch (err) {
      console.error("Failed to fetch service health:", err);
    } finally {
      setLoadingServices(false);
    }
  };

  const startService = async (service: StartableService) => {
    setStarting(service);
    setServiceMessage("");
    try {
      const res = await fetch(`/api/services/${service}/start`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = typeof data?.detail === "string" ? data.detail : `Failed to start ${service}`;
        setServiceMessage(error);
      } else if (data?.alreadyRunning) {
        setServiceMessage(`${service} already running.`);
      } else {
        setServiceMessage(`${service} start requested.`);
      }
      await fetchServices();
    } catch (err) {
      console.error(`Failed to start ${service}:`, err);
      setServiceMessage(`Failed to start ${service}.`);
    } finally {
      setStarting(null);
    }
  };

  useEffect(() => {
    void fetchServices();
    const id = window.setInterval(() => {
      void fetchServices();
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex-col gap-6">
      <Card>
        <h3 className="mb-4">API Keys</h3>
        <FormGrid>
          <FormField label="Anthropic API Key" hint="Required for Claude direct API. Get from console.anthropic.com">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.auth.anthropicApiKey || "sk-ant-..."}
                value={apiKeys.anthropicApiKey}
                onChange={(e) => setApiKeys((p) => ({ ...p, anthropicApiKey: e.target.value }))}
              />
              {settings.auth.anthropicApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="OpenRouter API Key" hint="Multi-model access. Cheap models for utility tasks. Get from openrouter.ai">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.auth.openrouterApiKey || "sk-or-..."}
                value={apiKeys.openrouterApiKey}
                onChange={(e) => setApiKeys((p) => ({ ...p, openrouterApiKey: e.target.value }))}
              />
              {settings.auth.openrouterApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="OpenAI API Key" hint="For Whisper STT and OpenAI TTS (alternative provider)">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.auth.openaiApiKey || "sk-..."}
                value={apiKeys.openaiApiKey}
                onChange={(e) => setApiKeys((p) => ({ ...p, openaiApiKey: e.target.value }))}
              />
              {settings.auth.openaiApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="ElevenLabs API Key" hint="For ElevenLabs text-to-speech (alternative provider)">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.auth.elevenlabsApiKey || "..."}
                value={apiKeys.elevenlabsApiKey}
                onChange={(e) => setApiKeys((p) => ({ ...p, elevenlabsApiKey: e.target.value }))}
              />
              {settings.auth.elevenlabsApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="Deepgram API Key" hint="Speech-to-text for LiveKit voice pipeline. Get from deepgram.com">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.livekit.deepgramApiKey || "..."}
                value={livekitKeys.deepgramApiKey}
                onChange={(e) => setLivekitKeys((p) => ({ ...p, deepgramApiKey: e.target.value }))}
              />
              {settings.livekit.deepgramApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="Cartesia API Key" hint="Text-to-speech for LiveKit voice pipeline. Get from cartesia.ai">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.livekit.cartesiaApiKey || "sk_car_..."}
                value={livekitKeys.cartesiaApiKey}
                onChange={(e) => setLivekitKeys((p) => ({ ...p, cartesiaApiKey: e.target.value }))}
              />
              {settings.livekit.cartesiaApiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
        </FormGrid>
      </Card>

      <Card>
        <h3 className="mb-1">System Services</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Start core background services from UI when they are down.
        </MetaText>

        <div className="flex-col gap-3">
          <div className="flex-row gap-2 items-center">
            <Badge status={badgeFor(services.watchdog?.status || "red")}>Watchdog</Badge>
            <MetaText size="xs">{services.watchdog?.detail || "No status"}</MetaText>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startService("watchdog")}
                disabled={starting === "watchdog" || services.watchdog?.status === "green"}
              >
                {starting === "watchdog" ? "Starting..." : "Start"}
              </Button>
            </div>
          </div>
          <div className="flex-row gap-2 items-center">
            <Badge status={badgeFor(services.database?.status || "red")}>Database</Badge>
            <MetaText size="xs">{services.database?.detail || "No status"}</MetaText>
          </div>
          <div className="flex-row gap-2 items-center">
            <Badge status={badgeFor(services.autodev?.status || "red")}>AutoDev</Badge>
            <MetaText size="xs">{services.autodev?.detail || "No status"}</MetaText>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startService("autodev")}
                disabled={starting === "autodev" || services.autodev?.status === "green"}
              >
                {starting === "autodev" ? "Starting..." : "Start"}
              </Button>
            </div>
          </div>
          <div className="flex-row gap-2 items-center">
            <Badge status={badgeFor(services.livekit?.status || "orange")}>LiveKit Worker</Badge>
            <MetaText size="xs">{services.livekit?.detail || "No status"}</MetaText>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startService("livekit")}
                disabled={starting === "livekit" || services.livekit?.status === "green"}
              >
                {starting === "livekit" ? "Starting..." : "Start"}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex-row gap-2 mt-4">
          <Button size="sm" variant="ghost" onClick={fetchServices} disabled={loadingServices || starting !== null}>
            {loadingServices ? "Refreshing..." : "Refresh Status"}
          </Button>
          {serviceMessage && <MetaText size="sm">{serviceMessage}</MetaText>}
        </div>
      </Card>
    </div>
  );
}
