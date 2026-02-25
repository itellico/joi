// Emby integration adapter (non-messaging)
// Validates server URL + API key and reports status in channel_configs.

import type { ChannelAdapter, ChannelStatus, ChannelStatusInfo } from "../types.js";

const CONNECT_TIMEOUT_MS = 15_000;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createEmbyAdapter(channelId: string): ChannelAdapter {
  let status: ChannelStatus = "disconnected";
  let errorMsg: string | undefined;
  let connectedAt: Date | undefined;
  let displayName: string | undefined;

  function setStatus(next: ChannelStatus, error?: string) {
    status = next;
    errorMsg = error;
    if (next === "connected") connectedAt = new Date();
    adapter.onStatusChange?.(adapter.getStatus());
  }

  const adapter: ChannelAdapter = {
    channelType: "emby",
    channelId,

    async connect(config) {
      const serverUrl = asString(config.serverUrl ?? config.url);
      const apiKey = asString(config.apiKey ?? config.token);
      displayName = asString(config.displayName) || channelId;

      if (!serverUrl || !apiKey) {
        setStatus("error", "serverUrl and apiKey are required");
        return;
      }

      setStatus("connecting");

      try {
        const base = normalizeUrl(serverUrl);
        await fetchJson(`${base}/emby/System/Info?api_key=${encodeURIComponent(apiKey)}`);
        setStatus("connected");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus("error", message);
      }
    },

    async disconnect() {
      setStatus("disconnected");
    },

    async send() {
      throw new Error("Emby is a browsing integration and does not support send()");
    },

    getStatus(): ChannelStatusInfo {
      return {
        channelId,
        channelType: "emby",
        status,
        displayName,
        error: errorMsg,
        connectedAt,
      };
    },

    onMessage: null,
    onStatusChange: null,
    onQrCode: null,
  };

  return adapter;
}
