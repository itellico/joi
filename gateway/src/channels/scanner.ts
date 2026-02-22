// Channel scanner — periodically scans all connected channels for historical messages
// Captures both sent and received messages for relationship intelligence

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "../db/client.js";
import { matchContact } from "../contacts/match.js";
import { linkMessageToContact } from "./router.js";
import { getAdapter } from "./manager.js";
import type { ChannelMessage, ChannelAttachment, ChannelConfig } from "./types.js";
import type { JoiConfig } from "../config/schema.js";

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), "Library/Messages/chat.db");
const COCOA_EPOCH_OFFSET = 978307200;

export async function scanAllChannels(_config: JoiConfig): Promise<void> {
  console.log("[Scanner] Starting channel scan...");

  // Determine scan window: from last cron run, or 24h ago
  const cronResult = await query<{ last_run_at: string | null }>(
    "SELECT last_run_at FROM cron_jobs WHERE name = 'scan_channels' LIMIT 1",
  );
  const lastRun = cronResult.rows[0]?.last_run_at;
  const since = lastRun ? new Date(lastRun) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  console.log(`[Scanner] Scan window: since ${since.toISOString()}`);

  // Load enabled + connected channels
  const channels = await query<ChannelConfig>(
    "SELECT * FROM channel_configs WHERE enabled = true AND status = 'connected'",
  );

  let totalInserted = 0;

  for (const ch of channels.rows) {
    try {
      let count = 0;
      switch (ch.channel_type) {
        case "imessage":
          count = await scanIMessage(ch.id, since);
          break;
        case "telegram":
          count = await scanTelegram(ch.id, since);
          break;
        case "whatsapp":
          // WhatsApp: no historical backfill — real-time capture only
          // (Baileys doesn't expose history query for existing sessions)
          break;
      }
      if (count > 0) {
        console.log(`[Scanner] ${ch.channel_type}:${ch.id} — ${count} message(s) matched to contacts`);
      }
      totalInserted += count;
    } catch (err) {
      console.error(`[Scanner] Error scanning ${ch.channel_type}:${ch.id}:`, err);
    }
  }

  console.log(`[Scanner] Done — ${totalInserted} total new interaction(s)`);
}

// ─── iMessage Scanner ───

function mimeToAttachmentType(mime: string | null): ChannelAttachment["type"] {
  if (!mime) return "unknown";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function scanIMessage(channelId: string, since: Date): Promise<number> {
  // Convert JS timestamp to Cocoa nanoseconds for the query
  const sinceCocoaSeconds = Math.floor(since.getTime() / 1000) - COCOA_EPOCH_OFFSET;
  // Modern macOS stores date as nanoseconds since Cocoa epoch
  const sinceCocoaNano = Math.floor(sinceCocoaSeconds * 1e9);
  if (!Number.isFinite(sinceCocoaNano)) throw new Error("Invalid scan timestamp");

  const sql = `SELECT m.ROWID, m.text, m.date, m.is_from_me,
           h.id AS sender_id, h.uncanonicalized_id AS sender_name,
           GROUP_CONCAT(a.mime_type, '||') AS att_mimes,
           GROUP_CONCAT(a.transfer_name, '||') AS att_names
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN message_attachment_join maj ON maj.message_id = m.ROWID
    LEFT JOIN attachment a ON a.ROWID = maj.attachment_id
    WHERE m.date > ${sinceCocoaNano}
      AND (m.text IS NOT NULL AND m.text != '' OR a.ROWID IS NOT NULL)
    GROUP BY m.ROWID
    ORDER BY m.ROWID ASC
    LIMIT 500;`;

  let stdout: string;
  try {
    const result = await execFileAsync("sqlite3", ["-readonly", "-json", CHAT_DB, sql]);
    stdout = result.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("database is locked")) {
      console.warn("[Scanner] iMessage DB locked, will retry next cycle");
      return 0;
    }
    throw err;
  }

  if (!stdout.trim()) return 0;

  const rows = JSON.parse(stdout) as Array<{
    ROWID: number;
    text: string | null;
    date: number;
    is_from_me: number;
    sender_id: string | null;
    sender_name: string | null;
    att_mimes: string | null;
    att_names: string | null;
  }>;

  let matched = 0;
  for (const row of rows) {
    const timestamp =
      row.date > 1e15
        ? new Date((row.date / 1e9 + COCOA_EPOCH_OFFSET) * 1000)
        : new Date((row.date + COCOA_EPOCH_OFFSET) * 1000);

    const attachments: ChannelAttachment[] = [];
    if (row.att_mimes) {
      const mimes = row.att_mimes.split("||");
      const names = row.att_names?.split("||") || [];
      for (let i = 0; i < mimes.length; i++) {
        attachments.push({
          type: mimeToAttachmentType(mimes[i]),
          mimeType: mimes[i] || undefined,
          filename: names[i] || undefined,
        });
      }
    }

    const senderId = row.sender_id || "unknown";
    const isFromMe = row.is_from_me === 1;
    const externalId = `im:${row.ROWID}`;

    const msg: ChannelMessage = {
      channelId,
      channelType: "imessage",
      senderId,
      senderName: row.sender_name || senderId,
      content: row.text || "",
      timestamp,
      metadata: { rowId: row.ROWID },
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Match to contact and log interaction (dedup via ON CONFLICT DO NOTHING)
    const contactId = await matchContact(msg).catch(() => null);
    if (contactId) {
      linkMessageToContact(msg, isFromMe ? "outbound" : "inbound", {
        externalId,
        isFromMe,
      });
      matched++;
    }
  }

  return matched;
}

// ─── Telegram Scanner ───

async function scanTelegram(channelId: string, since: Date): Promise<number> {
  const adapter = getAdapter(channelId);
  if (!adapter || !adapter.scanHistory) return 0;

  const messages = await adapter.scanHistory(since);
  let matched = 0;

  for (const msg of messages) {
    const contactId = await matchContact(msg).catch(() => null);
    if (!contactId) continue;

    const isFromMe = !!msg.metadata?.isFromMe;
    const chatId = msg.metadata?.chatId || "";
    const messageId = msg.metadata?.messageId;
    const externalId = messageId ? `tg:${chatId}:${messageId}` : null;

    linkMessageToContact(msg, isFromMe ? "outbound" : "inbound", {
      externalId: externalId ?? undefined,
      isFromMe,
    });
    matched++;
  }

  return matched;
}
