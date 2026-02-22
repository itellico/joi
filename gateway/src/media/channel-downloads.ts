// Per-channel download functions: given source metadata, download the raw file bytes

import { readFile } from "node:fs/promises";
import type { ChannelAttachment } from "../channels/types.js";

/** Download media from any channel based on source metadata */
export async function downloadFromChannel(
  channelType: string,
  source: ChannelAttachment,
): Promise<Buffer | null> {
  switch (channelType) {
    case "whatsapp":
      return downloadWhatsApp(source);
    case "telegram":
      return downloadTelegram(source);
    case "imessage":
      return downloadIMessage(source);
    case "slack":
      return downloadSlack(source);
    case "discord":
      return downloadDiscord(source);
    case "email":
      return downloadEmail(source);
    default:
      console.warn(`[Media] No download handler for channel type: ${channelType}`);
      return null;
  }
}

async function downloadWhatsApp(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._waMessage) return null;
  try {
    const baileys = await import("@whiskeysockets/baileys");
    const stream = await baileys.downloadMediaMessage(
      source._waMessage as any,
      "buffer",
      {},
    );
    return stream as Buffer;
  } catch (err) {
    console.error("[Media] WhatsApp download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadTelegram(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._tgMessage) return null;
  try {
    // Access the telegram client from the adapter's exported getter
    const { getTelegramClient } = await import("../channels/adapters/telegram.js");
    const client = getTelegramClient(source._tgChannelId || "");
    if (!client) {
      console.warn("[Media] No Telegram client available for download");
      return null;
    }
    const message = source._tgMessage as any;
    const buffer = await client.downloadMedia(message.media || message, {});
    if (buffer instanceof Buffer) return buffer;
    if (buffer) return Buffer.from(buffer as any);
    return null;
  } catch (err) {
    console.error("[Media] Telegram download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadIMessage(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._imessagePath) return null;
  try {
    // iMessage attachment paths are sometimes prefixed with ~ or contain relative paths
    let filePath = source._imessagePath;
    if (filePath.startsWith("~")) {
      const { homedir } = await import("node:os");
      filePath = filePath.replace("~", homedir());
    }
    return await readFile(filePath);
  } catch (err) {
    console.error("[Media] iMessage file read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadSlack(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._slackUrl || !source._slackToken) return null;
  try {
    const resp = await fetch(source._slackUrl, {
      headers: { Authorization: `Bearer ${source._slackToken}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.error("[Media] Slack download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadDiscord(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._discordUrl) return null;
  try {
    const resp = await fetch(source._discordUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.error("[Media] Discord download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function downloadEmail(source: ChannelAttachment): Promise<Buffer | null> {
  if (!source._emailMessageId || !source._emailAttachmentId) return null;
  try {
    const { downloadAttachment } = await import("../google/gmail.js");
    return await downloadAttachment(
      source._emailMessageId,
      source._emailAttachmentId,
      source._emailAccountId,
    );
  } catch (err) {
    console.error("[Media] Email download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
