// Discord adapter using discord.js
// Bot token auth — each Discord server can be a separate channel instance

import type { ChannelAdapter, ChannelMessage, ChannelAttachment, ChannelStatusInfo, ChannelStatus } from "../types.js";

// Lazy-loaded discord.js
let Client: any = null;
let GatewayIntentBits: any = null;
let Events: any = null;

async function loadDiscordJS() {
  if (!Client) {
    const djs = await import("discord.js");
    Client = djs.Client;
    GatewayIntentBits = djs.GatewayIntentBits;
    Events = djs.Events;
  }
  return { Client: Client!, GatewayIntentBits: GatewayIntentBits!, Events: Events! };
}

export function createDiscordAdapter(channelId: string): ChannelAdapter {
  let client: any = null;
  let status: ChannelStatus = "disconnected";
  let errorMsg: string | undefined;
  let connectedAt: Date | undefined;
  let displayName: string | undefined;

  function setStatus(newStatus: ChannelStatus, error?: string) {
    status = newStatus;
    errorMsg = error;
    if (newStatus === "connected") connectedAt = new Date();
    adapter.onStatusChange?.(adapter.getStatus());
  }

  function mapAttachments(attachments: any[]): ChannelAttachment[] {
    if (!attachments?.length) return [];
    return attachments.map((a: any) => {
      let type: ChannelAttachment["type"] = "document";
      const ct = a.contentType || "";
      if (ct.startsWith("image/")) type = "photo";
      else if (ct.startsWith("video/")) type = "video";
      else if (ct.startsWith("audio/")) type = "audio";
      return { type, filename: a.name, mimeType: ct, size: a.size };
    });
  }

  const adapter: ChannelAdapter = {
    channelType: "discord",
    channelId,

    async connect(config) {
      const { Client: DClient, GatewayIntentBits: GIB, Events: Ev } = await loadDiscordJS();

      const botToken = config.botToken as string;
      if (!botToken) {
        setStatus("error", "botToken is required");
        return;
      }

      const guildIds = (config.guildIds as string[] | undefined) || [];
      const channelIds = (config.channelIds as string[] | undefined) || [];
      const monitorDMs = config.monitorDMs === true; // default false

      setStatus("connecting");

      try {
        client = new DClient({
          intents: [
            GIB.Guilds,
            GIB.GuildMessages,
            GIB.MessageContent,
            ...(monitorDMs ? [GIB.DirectMessages] : []),
          ],
        });

        client.once(Ev.ClientReady, (readyClient: any) => {
          displayName = readyClient.user?.username || channelId;
          setStatus("connected");
        });

        client.on(Ev.MessageCreate, async (message: any) => {
          // Skip bot messages
          if (message.author.bot) return;

          // Filter by guild
          if (message.guild) {
            if (guildIds.length > 0 && !guildIds.includes(message.guild.id)) return;
          } else {
            // DM
            if (!monitorDMs) return;
          }

          // Filter by channel
          if (channelIds.length > 0 && !channelIds.includes(message.channel.id)) return;

          const attachments = mapAttachments(Array.from(message.attachments.values()));
          const text = message.content || "";

          if (!text && attachments.length === 0) return;

          const guildId = message.guild?.id || "dm";
          const senderName = message.member?.displayName || message.author.displayName || message.author.username;

          const msg: ChannelMessage = {
            channelId,
            channelType: "discord",
            senderId: message.author.id,
            senderName,
            content: text,
            timestamp: message.createdAt,
            metadata: {
              messageId: message.id,
              guildId,
              guildName: message.guild?.name,
              discordChannelId: message.channel.id,
              discordChannelName: (message.channel as any).name,
              username: message.author.username,
            },
            attachments: attachments.length > 0 ? attachments : undefined,
          };

          adapter.onMessage?.(msg);
        });

        client.on(Ev.Error, (err: Error) => {
          console.error(`[Discord:${channelId}] Client error:`, err.message);
        });

        await client.login(botToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error", msg);
      }
    },

    async disconnect() {
      try {
        await client?.destroy();
      } catch { /* ignore */ }
      client = null;
      setStatus("disconnected");
    },

    async send(to, content) {
      if (!client) throw new Error("Discord client not connected");
      const channel = await client.channels.fetch(to);
      if (!channel?.isTextBased()) throw new Error(`Channel ${to} is not a text channel`);
      await channel.send(content);
    },

    getStatus() {
      return {
        channelId,
        channelType: "discord" as const,
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
