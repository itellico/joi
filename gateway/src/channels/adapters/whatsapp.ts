// WhatsApp adapter using @whiskeysockets/baileys
// QR code auth, message send/receive, auto-reconnect

import type { ChannelAdapter, ChannelMessage, ChannelAttachment, ChannelStatusInfo, ChannelStatus } from "../types.js";
import { linkMessageToContact } from "../router.js";

let baileys: typeof import("@whiskeysockets/baileys") | null = null;
let qrcode: typeof import("qrcode") | null = null;

async function loadBaileys() {
  if (!baileys) {
    baileys = await import("@whiskeysockets/baileys");
  }
  return baileys;
}

async function loadQrcode() {
  if (!qrcode) {
    qrcode = await import("qrcode");
  }
  return qrcode;
}

export function createWhatsAppAdapter(channelId: string): ChannelAdapter {
  let sock: ReturnType<typeof import("@whiskeysockets/baileys").default> | null = null;
  let status: ChannelStatus = "disconnected";
  let errorMsg: string | undefined;
  let connectedAt: Date | undefined;
  let displayName: string | undefined;

  const adapter: ChannelAdapter = {
    channelType: "whatsapp",
    channelId,

    onMessage: null,
    onStatusChange: null,
    onQrCode: null,

    async connect(config) {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } =
        await loadBaileys();
      const QRCode = await loadQrcode();

      status = "connecting";
      adapter.onStatusChange?.(adapter.getStatus());

      // Auth state stored per channel
      const authDir = config.authDir as string || `./wa-auth-${channelId}`;
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["JOI", "Chrome", "1.0.0"],
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const dataUrl = await QRCode.toDataURL(qr, { width: 256 });
            adapter.onQrCode?.(dataUrl);
          } catch (err) {
            console.error("[WhatsApp] QR generation failed:", err);
          }
        }

        if (connection === "open") {
          status = "connected";
          errorMsg = undefined;
          connectedAt = new Date();
          displayName = sock?.user?.name || sock?.user?.id?.split(":")[0];
          adapter.onStatusChange?.(adapter.getStatus());
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            status = "connecting";
            errorMsg = "Reconnecting...";
            adapter.onStatusChange?.(adapter.getStatus());
            // Retry after delay
            setTimeout(() => {
              adapter.connect(config).catch((err) => {
                status = "error";
                errorMsg = err instanceof Error ? err.message : String(err);
                adapter.onStatusChange?.(adapter.getStatus());
              });
            }, 3000);
          } else {
            status = "disconnected";
            errorMsg = "Logged out";
            adapter.onStatusChange?.(adapter.getStatus());
          }
        }
      });

      sock.ev.on("messages.upsert", ({ messages: msgs, type }) => {
        if (type !== "notify") return;

        for (const msg of msgs) {
          if (!msg.message) continue;

          const m = msg.message;

          // Detect attachments
          const attachments: ChannelAttachment[] = [];
          if (m.imageMessage) {
            attachments.push({ type: "photo", mimeType: m.imageMessage.mimetype || undefined, size: m.imageMessage.fileLength ? Number(m.imageMessage.fileLength) : undefined, _waMessage: msg });
          } else if (m.videoMessage) {
            attachments.push({ type: "video", mimeType: m.videoMessage.mimetype || undefined, size: m.videoMessage.fileLength ? Number(m.videoMessage.fileLength) : undefined, _waMessage: msg });
          } else if (m.audioMessage) {
            attachments.push({ type: m.audioMessage.ptt ? "voice" : "audio", mimeType: m.audioMessage.mimetype || undefined, _waMessage: msg });
          } else if (m.documentMessage) {
            attachments.push({ type: "document", filename: m.documentMessage.fileName || undefined, mimeType: m.documentMessage.mimetype || undefined, size: m.documentMessage.fileLength ? Number(m.documentMessage.fileLength) : undefined, _waMessage: msg });
          } else if (m.stickerMessage) {
            attachments.push({ type: "sticker", _waMessage: msg });
          }

          const text =
            m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            m.videoMessage?.caption ||
            m.documentMessage?.caption ||
            "";

          // Skip messages with no text and no media
          if (!text && attachments.length === 0) continue;

          // For status broadcasts and groups, participant has the actual sender's JID
          const senderId = msg.key.participant || msg.key.remoteJid || "";
          const senderName = msg.pushName || senderId.split("@")[0];
          const externalId = msg.key.id ? `wa:${msg.key.id}` : undefined;

          const channelMessage: ChannelMessage = {
            channelId,
            channelType: "whatsapp",
            senderId,
            senderName,
            content: text,
            timestamp: new Date((msg.messageTimestamp as number) * 1000),
            metadata: { messageId: msg.key.id },
            attachments: attachments.length > 0 ? attachments : undefined,
          };

          if (msg.key.fromMe) {
            // Outbound: log to contact_interactions directly (don't route through agent)
            linkMessageToContact(channelMessage, "outbound", {
              externalId,
              isFromMe: true,
            });
          } else {
            // Inbound: route through normal message handler
            adapter.onMessage?.(channelMessage);
          }
        }
      });
    },

    async disconnect() {
      if (sock) {
        sock.end(undefined);
        sock = null;
      }
      status = "disconnected";
      errorMsg = undefined;
    },

    async send(to, content) {
      if (!sock) throw new Error("WhatsApp not connected");
      // Ensure JID format: WhatsApp needs digits-only (no +, spaces, dashes)
      let jid: string;
      if (to.includes("@")) {
        jid = to;
      } else {
        const digits = to.replace(/[^0-9]/g, "");
        if (!digits) throw new Error(`Invalid phone number: ${to}`);
        jid = `${digits}@s.whatsapp.net`;
      }
      await sock.sendMessage(jid, { text: content });
    },

    getStatus(): ChannelStatusInfo {
      return {
        channelId,
        channelType: "whatsapp",
        status,
        displayName,
        error: errorMsg,
        connectedAt,
      };
    },
  };

  return adapter;
}
