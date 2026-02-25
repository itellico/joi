// ChannelManager — singleton that loads configs from DB, manages adapter lifecycle
// Broadcasts status updates and QR codes via WS

import { query } from "../db/client.js";
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelStatusInfo,
  ChannelType,
} from "./types.js";
import { routeInboundMessage } from "./router.js";
import { createWhatsAppAdapter } from "./adapters/whatsapp.js";
import { createTelegramAdapter } from "./adapters/telegram.js";
import { createIMessageAdapter } from "./adapters/imessage.js";
import { createSlackAdapter } from "./adapters/slack.js";
import { createDiscordAdapter } from "./adapters/discord.js";
import { createEmbyAdapter } from "./adapters/emby.js";
import { createJellyseerrAdapter } from "./adapters/jellyseerr.js";
import { createWebhookAdapter } from "./adapters/webhook.js";
import type { JoiConfig } from "../config/schema.js";

type BroadcastFn = (type: string, data: unknown) => void;

const adapters = new Map<string, ChannelAdapter>();
let broadcastFn: BroadcastFn | null = null;
let appConfig: JoiConfig | null = null;

function createAdapter(channelId: string, type: ChannelType): ChannelAdapter {
  switch (type) {
    case "whatsapp":
      return createWhatsAppAdapter(channelId);
    case "telegram":
      return createTelegramAdapter(channelId);
    case "imessage":
      return createIMessageAdapter(channelId);
    case "slack":
      return createSlackAdapter(channelId);
    case "discord":
      return createDiscordAdapter(channelId);
    case "emby":
      return createEmbyAdapter(channelId);
    case "jellyseerr":
      return createJellyseerrAdapter(channelId);
    case "webhook":
      return createWebhookAdapter(channelId);
    default:
      throw new Error(`Unknown channel type: ${type}`);
  }
}

function wireAdapter(adapter: ChannelAdapter): void {
  adapter.onMessage = (msg: ChannelMessage) => {
    if (!appConfig) return;
    routeInboundMessage(msg, appConfig, broadcastFn || undefined).catch((err) => {
      console.error(`[Channels] Failed to route message from ${msg.channelId}:`, err);
    });
  };

  adapter.onStatusChange = (status: ChannelStatusInfo) => {
    // Persist status to DB
    query(
      `UPDATE channel_configs SET status = $1, error_message = $2, updated_at = NOW()
       ${status.status === "connected" ? ", last_connected_at = NOW()" : ""}
       WHERE id = $3`,
      [status.status, status.error || null, status.channelId],
    ).catch(() => {});

    broadcastFn?.("channel.status", status);
  };

  adapter.onQrCode = (qrDataUrl: string) => {
    broadcastFn?.("channel.qr", {
      channelId: adapter.channelId,
      channelType: adapter.channelType,
      qrDataUrl,
    });
  };
}

export async function initChannelManager(
  config: JoiConfig,
  broadcast: BroadcastFn,
): Promise<void> {
  appConfig = config;
  broadcastFn = broadcast;

  // Load enabled channels from DB and auto-connect
  const result = await query<ChannelConfig>(
    "SELECT * FROM channel_configs WHERE enabled = true",
  );

  for (const row of result.rows) {
    try {
      const adapter = createAdapter(row.id, row.channel_type);
      wireAdapter(adapter);
      adapters.set(row.id, adapter);
      await adapter.connect(row.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Channels] Failed to connect ${row.id} (${row.channel_type}):`, msg);
    }
  }

  console.log(`[Channels] Initialized ${adapters.size} channel(s)`);
}

export async function connectChannel(channelId: string): Promise<ChannelStatusInfo> {
  const result = await query<ChannelConfig>(
    "SELECT * FROM channel_configs WHERE id = $1",
    [channelId],
  );
  if (result.rows.length === 0) throw new Error(`Channel ${channelId} not found`);
  const row = result.rows[0];

  // Disconnect existing adapter if any
  const existing = adapters.get(channelId);
  if (existing) {
    await existing.disconnect().catch(() => {});
    adapters.delete(channelId);
  }

  const adapter = createAdapter(row.id, row.channel_type);
  wireAdapter(adapter);
  adapters.set(row.id, adapter);
  await adapter.connect(row.config);

  return adapter.getStatus();
}

export async function disconnectChannel(channelId: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter) return;

  await adapter.disconnect();
  adapters.delete(channelId);

  await query(
    "UPDATE channel_configs SET status = 'disconnected', updated_at = NOW() WHERE id = $1",
    [channelId],
  ).catch(() => {});

  broadcastFn?.("channel.status", {
    channelId,
    channelType: adapter.channelType,
    status: "disconnected",
  });
}

export function getAdapter(channelId: string): ChannelAdapter | undefined {
  return adapters.get(channelId);
}

export function getAllStatuses(): ChannelStatusInfo[] {
  return Array.from(adapters.values()).map((a) => a.getStatus());
}

export async function shutdownAllChannels(): Promise<void> {
  const promises = Array.from(adapters.values()).map((a) =>
    a.disconnect().catch(() => {}),
  );
  await Promise.all(promises);
  adapters.clear();
}
