// Telegram adapter using GramJS (MTProto user-client)
// Multi-step interactive auth via deferred Promise pattern

import type { ChannelAdapter, ChannelMessage, ChannelAttachment, ChannelStatusInfo, ChannelStatus } from "../types.js";
import { query } from "../../db/client.js";

// Lazy-loaded GramJS modules (subpaths lack TS declarations, so we use `any`)
let TelegramClient: typeof import("telegram").TelegramClient | null = null;
let StringSession: any = null;
let NewMessage: any = null;

async function loadGramJS() {
  if (!TelegramClient) {
    const tg = await import("telegram");
    const sessions = await import("telegram/sessions/index.js");
    const events = await import("telegram/events/index.js");
    TelegramClient = tg.TelegramClient;
    StringSession = sessions.StringSession;
    NewMessage = events.NewMessage;
  }
  return { TelegramClient: TelegramClient!, StringSession: StringSession!, NewMessage: NewMessage! };
}

// ── Pending auth resolvers (module-level, keyed by channelId) ──

interface PendingAuth {
  codeResolve?: (code: string) => void;
  passwordResolve?: (password: string) => void;
  rejectAll?: (err: Error) => void;
}

const pendingAuth = new Map<string, PendingAuth>();

export function submitTelegramCode(channelId: string, code: string): boolean {
  const pending = pendingAuth.get(channelId);
  if (pending?.codeResolve) {
    pending.codeResolve(code);
    pending.codeResolve = undefined;
    return true;
  }
  return false;
}

export function submitTelegramPassword(channelId: string, password: string): boolean {
  const pending = pendingAuth.get(channelId);
  if (pending?.passwordResolve) {
    pending.passwordResolve(password);
    pending.passwordResolve = undefined;
    return true;
  }
  return false;
}

// ── Client access for media downloads ──

const activeClients = new Map<string, InstanceType<typeof import("telegram").TelegramClient>>();

export function getTelegramClient(channelId: string): InstanceType<typeof import("telegram").TelegramClient> | null {
  return activeClients.get(channelId) || null;
}

// ── Adapter factory ──

export function createTelegramAdapter(channelId: string): ChannelAdapter {
  let client: InstanceType<typeof import("telegram").TelegramClient> | null = null;
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

  async function setupEventHandlers() {
    if (!client || !NewMessage) return;

    client.addEventHandler(async (event: any) => {
      const message = event.message;
      if (!message) return;

      // Skip outgoing messages
      if (message.out) return;

      // Detect attachments
      const attachments: ChannelAttachment[] = [];
      const mediaClass = message.media?.className as string | undefined;
      if (mediaClass === "MessageMediaPhoto") {
        attachments.push({ type: "photo", _tgMessage: message, _tgChannelId: channelId });
      } else if (mediaClass === "MessageMediaDocument") {
        const doc = message.media.document;
        const attrs = doc?.attributes || [];
        const fileAttr = attrs.find((a: any) => a.className === "DocumentAttributeFilename");
        const audioAttr = attrs.find((a: any) => a.className === "DocumentAttributeAudio");
        const videoAttr = attrs.find((a: any) => a.className === "DocumentAttributeVideo");
        const stickerAttr = attrs.find((a: any) => a.className === "DocumentAttributeSticker");
        const type = stickerAttr ? "sticker" : audioAttr?.voice ? "voice" : audioAttr ? "audio" : videoAttr ? "video" : "document";
        attachments.push({
          type,
          filename: fileAttr?.fileName,
          mimeType: doc?.mimeType,
          size: doc?.size ? Number(doc.size) : undefined,
          _tgMessage: message,
          _tgChannelId: channelId,
        });
      }

      // Skip messages with no text and no media
      if (!message.text && attachments.length === 0) return;

      const sender = await message.getSender();
      const senderId = String(message.senderId || sender?.id || "unknown");
      let senderName = "Unknown";

      if (sender) {
        if ("firstName" in sender) {
          senderName = sender.firstName || "";
          if (sender.lastName) senderName += ` ${sender.lastName}`;
          senderName = senderName.trim() || (sender as any).username || senderId;
        } else if ("title" in sender) {
          senderName = (sender as any).title;
        }
      }

      const msg: ChannelMessage = {
        channelId,
        channelType: "telegram",
        senderId,
        senderName,
        content: message.text || "",
        timestamp: new Date(message.date * 1000),
        metadata: {
          chatId: message.chatId?.toString(),
          messageId: message.id,
          username: sender && "username" in sender ? sender.username : undefined,
        },
        attachments: attachments.length > 0 ? attachments : undefined,
      };

      adapter.onMessage?.(msg);
    }, new NewMessage({ incoming: true }));
  }

  async function saveSession(session: string) {
    await query(
      `UPDATE channel_configs SET config = config || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ session }), channelId],
    ).catch((err) => console.error("[Telegram] Failed to save session:", err));
  }

  async function doInteractiveAuth(
    phoneNumber: string,
    apiId: number,
    apiHash: string,
  ) {
    const { TelegramClient: TC, StringSession: SS } = await loadGramJS();
    const session = new SS("");
    client = new TC(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();
    setStatus("connecting");

    const auth: PendingAuth = {};
    pendingAuth.set(channelId, auth);

    try {
      await client.start({
        phoneNumber: () => Promise.resolve(phoneNumber),
        phoneCode: () => {
          setStatus("awaiting_code");
          return new Promise<string>((resolve, reject) => {
            auth.codeResolve = resolve;
            auth.rejectAll = reject;
          });
        },
        password: () => {
          setStatus("awaiting_2fa");
          return new Promise<string>((resolve, reject) => {
            auth.passwordResolve = resolve;
            auth.rejectAll = reject;
          });
        },
        onError: (err) => {
          console.error("[Telegram] Auth error:", err);
        },
      });

      // Auth succeeded — save session and finish
      const savedSession = client.session.save() as unknown as string;
      await saveSession(savedSession);

      const me = await client.getMe();
      displayName = (me as any).firstName || (me as any).username || "Telegram";

      await setupEventHandlers();
      activeClients.set(channelId, client!);
      setStatus("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Telegram] Auth failed:", msg);
      setStatus("error", msg);
      client?.disconnect().catch(() => {});
      client = null;
    } finally {
      pendingAuth.delete(channelId);
    }
  }

  async function doSessionAuth(
    sessionStr: string,
    apiId: number,
    apiHash: string,
  ) {
    const { TelegramClient: TC, StringSession: SS } = await loadGramJS();
    const session = new SS(sessionStr);
    client = new TC(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    const me = await client.getMe();
    displayName = (me as any).firstName || (me as any).username || "Telegram";

    await setupEventHandlers();
    activeClients.set(channelId, client!);
    setStatus("connected");
  }

  const adapter: ChannelAdapter = {
    channelType: "telegram",
    channelId,

    onMessage: null,
    onStatusChange: null,
    onQrCode: null,

    async connect(config) {
      const apiId = Number(process.env.TELEGRAM_API_ID);
      const apiHash = process.env.TELEGRAM_API_HASH || "";

      if (!apiId || !apiHash) {
        throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env");
      }

      const savedSession = config.session as string | undefined;
      const phoneNumber = config.phoneNumber as string | undefined;

      status = "connecting";
      adapter.onStatusChange?.(adapter.getStatus());

      if (savedSession) {
        // Auto-reconnect with saved session
        try {
          await doSessionAuth(savedSession, apiId, apiHash);
        } catch (err) {
          // Session expired — fall through to interactive auth if phone available
          console.warn("[Telegram] Saved session failed, need re-auth:", err);
          if (phoneNumber) {
            // Run interactive auth in background (non-blocking)
            doInteractiveAuth(phoneNumber, apiId, apiHash).catch(() => {});
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            setStatus("error", `Session expired: ${msg}`);
          }
        }
      } else if (phoneNumber) {
        // First-time interactive auth — run in background so connect() returns immediately
        doInteractiveAuth(phoneNumber, apiId, apiHash).catch(() => {});
      } else {
        throw new Error("Phone number is required for first-time Telegram auth");
      }
    },

    async disconnect() {
      // Reject any pending auth
      const pending = pendingAuth.get(channelId);
      if (pending?.rejectAll) {
        pending.rejectAll(new Error("Disconnected"));
      }
      pendingAuth.delete(channelId);

      activeClients.delete(channelId);
      if (client) {
        await client.disconnect().catch(() => {});
        client = null;
      }
      status = "disconnected";
      errorMsg = undefined;
    },

    async send(to, content) {
      if (!client) throw new Error("Telegram not connected");
      // `to` can be a user ID (numeric string) or username
      const peer: any = /^\d+$/.test(to) ? BigInt(to) : to;
      await client.sendMessage(peer, { message: content });
    },

    async scanHistory(since: Date): Promise<ChannelMessage[]> {
      if (!client) throw new Error("Telegram not connected");
      const messages: ChannelMessage[] = [];
      const sinceUnix = Math.floor(since.getTime() / 1000);

      try {
        // Get recent dialogs
        const dialogs: any[] = [];
        for await (const dialog of client.iterDialogs({ limit: 30 })) {
          dialogs.push(dialog);
        }

        for (const dialog of dialogs) {
          try {
            for await (const message of client.iterMessages(dialog.entity, {
              limit: 100,
              reverse: true,
              offsetDate: sinceUnix,
            })) {
              if (!message.text && !message.media) continue;

              const sender = message.out ? null : await message.getSender?.().catch(() => null);
              const senderId = String(message.senderId || dialog.entity?.id || "unknown");
              let senderName = "Unknown";

              if (message.out) {
                senderName = displayName || "Me";
              } else if (sender) {
                if ("firstName" in sender) {
                  senderName = sender.firstName || "";
                  if (sender.lastName) senderName += ` ${sender.lastName}`;
                  senderName = senderName.trim() || (sender as any).username || senderId;
                } else if ("title" in sender) {
                  senderName = (sender as any).title;
                }
              }

              // Detect attachments
              const attachments: ChannelAttachment[] = [];
              const mediaClass = message.media?.className as string | undefined;
              if (mediaClass === "MessageMediaPhoto") {
                attachments.push({ type: "photo" });
              } else if (mediaClass === "MessageMediaDocument") {
                const doc = (message.media as any).document;
                const attrs = doc?.attributes || [];
                const stickerAttr = attrs.find((a: any) => a.className === "DocumentAttributeSticker");
                const audioAttr = attrs.find((a: any) => a.className === "DocumentAttributeAudio");
                const videoAttr = attrs.find((a: any) => a.className === "DocumentAttributeVideo");
                const type = stickerAttr ? "sticker" : audioAttr?.voice ? "voice" : audioAttr ? "audio" : videoAttr ? "video" : "document";
                attachments.push({ type });
              }

              const chatId = String(message.chatId ?? dialog.entity?.id ?? "");

              messages.push({
                channelId,
                channelType: "telegram",
                senderId,
                senderName,
                content: message.text || "",
                timestamp: new Date(message.date * 1000),
                metadata: {
                  chatId,
                  messageId: message.id,
                  isFromMe: message.out,
                  username: sender && "username" in sender ? sender.username : undefined,
                },
                attachments: attachments.length > 0 ? attachments : undefined,
              });
            }
          } catch (err) {
            // Skip dialogs we can't read (restricted channels, etc.)
            console.warn(`[Telegram] Skipped dialog scan:`, err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.error("[Telegram] scanHistory error:", err);
      }

      return messages;
    },

    getStatus(): ChannelStatusInfo {
      return {
        channelId,
        channelType: "telegram",
        status,
        displayName,
        error: errorMsg,
        connectedAt,
      };
    },
  };

  return adapter;
}
