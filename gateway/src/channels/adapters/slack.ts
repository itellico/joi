// Slack adapter using Socket Mode (WebSocket) + Web API
// Each workspace = one channel instance with its own bot + app tokens

import type { ChannelAdapter, ChannelMessage, ChannelAttachment, ChannelStatusInfo, ChannelStatus } from "../types.js";

// Lazy-loaded Slack modules
let WebClient: any = null;
let SocketModeClient: any = null;

async function loadSlackSDK() {
  if (!WebClient) {
    const webApi = await import("@slack/web-api");
    const socketMode = await import("@slack/socket-mode");
    WebClient = webApi.WebClient;
    SocketModeClient = socketMode.SocketModeClient;
  }
  return { WebClient: WebClient!, SocketModeClient: SocketModeClient! };
}

// User profile cache (Slack user ID → display name)
const profileCache = new Map<string, { name: string; email?: string; expiresAt: number }>();
const PROFILE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function createSlackAdapter(channelId: string): ChannelAdapter {
  let webClient: any = null;
  let socketClient: any = null;
  let status: ChannelStatus = "disconnected";
  let errorMsg: string | undefined;
  let connectedAt: Date | undefined;
  let displayName: string | undefined;
  let teamId: string | undefined;

  function setStatus(newStatus: ChannelStatus, error?: string) {
    status = newStatus;
    errorMsg = error;
    if (newStatus === "connected") connectedAt = new Date();
    adapter.onStatusChange?.(adapter.getStatus());
  }

  async function getUserProfile(userId: string): Promise<{ name: string; email?: string }> {
    const cached = profileCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return { name: cached.name, email: cached.email };

    try {
      const result = await webClient.users.info({ user: userId });
      const profile = result.user?.profile;
      const name = profile?.display_name || profile?.real_name || result.user?.name || userId;
      const email = profile?.email;
      profileCache.set(userId, { name, email, expiresAt: Date.now() + PROFILE_CACHE_TTL });
      return { name, email };
    } catch {
      return { name: userId };
    }
  }

  function mapAttachments(files?: any[]): ChannelAttachment[] {
    if (!files?.length) return [];
    return files.map((f: any) => {
      let type: ChannelAttachment["type"] = "document";
      const mime = f.mimetype || "";
      if (mime.startsWith("image/")) type = "photo";
      else if (mime.startsWith("video/")) type = "video";
      else if (mime.startsWith("audio/")) type = "audio";
      return { type, filename: f.name, mimeType: mime, size: f.size };
    });
  }

  const adapter: ChannelAdapter = {
    channelType: "slack",
    channelId,

    async connect(config) {
      const { WebClient: WC, SocketModeClient: SMC } = await loadSlackSDK();

      const botToken = config.botToken as string;
      const appToken = config.appToken as string;
      if (!botToken || !appToken) {
        setStatus("error", "Both botToken and appToken are required");
        return;
      }

      const monitorChannels = (config.channels as string[] | undefined) || [];
      const monitorDMs = config.monitorDMs !== false; // default true
      teamId = config.teamId as string | undefined;
      displayName = config.teamName as string | undefined;

      setStatus("connecting");

      try {
        webClient = new WC(botToken);
        socketClient = new SMC({ appToken, logLevel: "error" });

        // Get team info if not provided
        if (!teamId) {
          try {
            const authResult = await webClient.auth.test();
            teamId = authResult.team_id;
            if (!displayName) displayName = authResult.team;
          } catch { /* non-critical */ }
        }

        socketClient.on("message", async ({ event, ack }: any) => {
          await ack();

          // Skip bot messages and message_changed subtypes
          if (event.bot_id || event.subtype) return;

          // Filter by configured channels (empty = all)
          if (monitorChannels.length > 0 && !monitorChannels.includes(event.channel)) {
            // Check if it's a DM
            const isDM = event.channel_type === "im";
            if (!isDM || !monitorDMs) return;
          }

          // Skip DMs if not monitoring them
          if (event.channel_type === "im" && !monitorDMs) return;

          const userId = event.user;
          if (!userId) return;

          const { name, email } = await getUserProfile(userId);
          const attachments = mapAttachments(event.files);
          const text = event.text || "";

          if (!text && attachments.length === 0) return;

          const msg: ChannelMessage = {
            channelId,
            channelType: "slack",
            senderId: userId,
            senderName: name,
            content: text,
            timestamp: new Date(parseFloat(event.ts) * 1000),
            metadata: {
              messageTs: event.ts,
              channelSlackId: event.channel,
              channelType: event.channel_type,
              teamId,
              email,
              threadTs: event.thread_ts,
            },
            attachments: attachments.length > 0 ? attachments : undefined,
          };

          adapter.onMessage?.(msg);
        });

        await socketClient.start();
        setStatus("connected");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error", msg);
      }
    },

    async disconnect() {
      try {
        await socketClient?.disconnect();
      } catch { /* ignore */ }
      socketClient = null;
      webClient = null;
      setStatus("disconnected");
    },

    async send(to, content) {
      if (!webClient) throw new Error("Slack client not connected");
      await webClient.chat.postMessage({ channel: to, text: content });
    },

    getStatus() {
      return {
        channelId,
        channelType: "slack" as const,
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
