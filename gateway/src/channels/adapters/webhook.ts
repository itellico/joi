// Generic webhook integration adapter (inbound-only)
// Validates webhook secret presence and reports connected status.

import type { ChannelAdapter, ChannelStatus, ChannelStatusInfo } from "../types.js";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createWebhookAdapter(channelId: string): ChannelAdapter {
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
    channelType: "webhook",
    channelId,

    async connect(config) {
      displayName = asString(config.displayName) || channelId;
      const webhookSecret = asString(config.webhookSecret ?? config.webhookToken ?? config.secret);

      if (!webhookSecret) {
        setStatus("error", "webhookSecret is required");
        return;
      }

      setStatus("connecting");
      setStatus("connected");
    },

    async disconnect() {
      setStatus("disconnected");
    },

    async send() {
      throw new Error("Webhook channels are inbound-only and do not support send()");
    },

    getStatus(): ChannelStatusInfo {
      return {
        channelId,
        channelType: "webhook",
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
