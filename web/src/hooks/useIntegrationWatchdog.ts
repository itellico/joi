import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Frame } from "./useWebSocket";
import {
  storeIntegrationWatchdogAlert,
  storeIntegrationWatchdogQr,
  type IntegrationWatchdogAlert,
} from "../lib/integrationWatchdog";

type WatchdogChannel = {
  id: string;
  channel_type: string;
  enabled: boolean;
  status: string;
  last_connected_at: string | null;
  error_message: string | null;
};

interface WsHandle {
  status: "connecting" | "connected" | "disconnected";
  on: (type: string, handler: (frame: Frame) => void) => () => void;
}

const HEARTBEAT_MS = 20_000;
const RECONNECT_COOLDOWN_MS = 60_000;

function needsAttention(status: string): boolean {
  return status === "disconnected" || status === "error" || status === "awaiting_code" || status === "awaiting_2fa";
}

function buildAlert(params: {
  channelId: string;
  channelType: string;
  status: string;
  source: IntegrationWatchdogAlert["source"];
}): IntegrationWatchdogAlert {
  const label = params.channelType || "integration";
  return {
    channelId: params.channelId,
    channelType: params.channelType,
    status: params.status,
    source: params.source,
    message: `${label} is ${params.status}. Open Integrations and reconnect now.`,
    detectedAt: new Date().toISOString(),
  };
}

export function useIntegrationWatchdog(ws: WsHandle): void {
  const navigate = useNavigate();
  const location = useLocation();
  const lastAlertKeyRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef<Record<string, number>>({});

  const redirectToIntegrations = useCallback(() => {
    if (location.pathname === "/integrations") return;
    navigate("/integrations?watchdog=1");
  }, [location.pathname, navigate]);

  const triggerAlert = useCallback((alert: IntegrationWatchdogAlert) => {
    const dedupeKey = `${alert.channelId}:${alert.status}:${alert.source}`;
    if (lastAlertKeyRef.current === dedupeKey) return;
    lastAlertKeyRef.current = dedupeKey;
    storeIntegrationWatchdogAlert(alert);
    redirectToIntegrations();
  }, [redirectToIntegrations]);

  useEffect(() => {
    const unsubStatus = ws.on("channel.status", (frame) => {
      const data = frame.data as { channelId?: string; channelType?: string; status?: string } | undefined;
      if (!data?.channelId || !data?.status) return;
      if (!needsAttention(data.status)) return;
      triggerAlert(
        buildAlert({
          channelId: data.channelId,
          channelType: data.channelType || "integration",
          status: data.status,
          source: "ws.status",
        }),
      );
    });

    const unsubQr = ws.on("channel.qr", (frame) => {
      const data = frame.data as { channelId?: string; channelType?: string; qrDataUrl?: string } | undefined;
      if (!data?.channelId || !data?.qrDataUrl) return;
      storeIntegrationWatchdogQr({
        channelId: data.channelId,
        channelType: data.channelType || "whatsapp",
        qrDataUrl: data.qrDataUrl,
        receivedAt: new Date().toISOString(),
      });
      triggerAlert(
        buildAlert({
          channelId: data.channelId,
          channelType: data.channelType || "whatsapp",
          status: "awaiting_qr",
          source: "ws.qr",
        }),
      );
    });

    return () => {
      unsubStatus();
      unsubQr();
    };
  }, [triggerAlert, ws]);

  useEffect(() => {
    if (ws.status !== "connected") return;

    let stopped = false;

    const runHeartbeat = async () => {
      try {
        const res = await fetch("/api/channels");
        const data = await res.json() as { channels?: WatchdogChannel[] };
        const channels = (data.channels || []).filter((ch) => ch.enabled && !!ch.last_connected_at);
        const unhealthy = channels.find((ch) => needsAttention(ch.status));
        if (!unhealthy || stopped) return;

        // For channels that were previously connected but now dropped, trigger a reconnect attempt.
        if (unhealthy.status === "disconnected" || unhealthy.status === "error") {
          const now = Date.now();
          const lastTry = reconnectAttemptRef.current[unhealthy.id] || 0;
          if (now - lastTry > RECONNECT_COOLDOWN_MS) {
            reconnectAttemptRef.current[unhealthy.id] = now;
            fetch(`/api/channels/${unhealthy.id}/connect`, { method: "POST" }).catch(() => {});
          }
        }

        triggerAlert(
          buildAlert({
            channelId: unhealthy.id,
            channelType: unhealthy.channel_type,
            status: unhealthy.status,
            source: "heartbeat",
          }),
        );
      } catch {
        // Heartbeat is best-effort.
      }
    };

    void runHeartbeat();
    const id = window.setInterval(() => {
      void runHeartbeat();
    }, HEARTBEAT_MS);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [triggerAlert, ws.status]);
}
