// iMessage adapter — native macOS AppleScript + Messages.db polling
// No external dependencies — uses osascript for sending and sqlite3 for reading

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChannelAdapter,
  ChannelMessage,
  ChannelAttachment,
  ChannelStatusInfo,
  ChannelStatus,
} from "../types.js";

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), "Library/Messages/chat.db");
const POLL_INTERVAL = 3000;

// JOIGateway.app binary with "query" subcommand — opens chat.db via sqlite3
// C API directly. macOS TCC checks the process that calls open(), so granting
// FDA to JOIGateway.app is sufficient. No FDA needed for node/sqlite3.
const GATEWAY_BIN = join(
  import.meta.dirname,
  "../../../../JOIGateway.app/Contents/MacOS/JOIGateway",
);
// Seconds between Unix epoch (1970-01-01) and Apple Cocoa epoch (2001-01-01)
const COCOA_EPOCH_OFFSET = 978307200;

function formatMessagesDbReadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.trim();
  const lower = msg.toLowerCase();

  const likelyTccDenied =
    lower.includes("authorization denied") ||
    lower.includes("operation not permitted") ||
    lower.includes("not authorized") ||
    lower.includes("permission denied");

  const base = `Cannot read Messages database (${CHAT_DB}): ${msg}`;
  if (!likelyTccDenied) return base;

  return [
    base,
    `Grant Full Disk Access to JOI Gateway in System Settings > Privacy & Security > Full Disk Access.`,
    `App location: JOIGateway.app (in the JOI project root).`,
  ].join(" ");
}

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
    });
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

export function createIMessageAdapter(channelId: string): ChannelAdapter {
  let status: ChannelStatus = "disconnected";
  let errorMsg: string | undefined;
  let connectedAt: Date | undefined;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastRowId = 0;

  async function initLastRowId(): Promise<void> {
    try {
      const { stdout } = await execFileAsync(GATEWAY_BIN, [
        "query", "-readonly",
        CHAT_DB,
        "SELECT COALESCE(MAX(ROWID), 0) FROM message;",
      ]);
      const maxId = parseInt(stdout.trim(), 10);
      if (!isNaN(maxId)) lastRowId = maxId;
    } catch {
      // Start from 0 — may get some old messages on first poll
    }
  }

  function mimeToAttachmentType(mime: string | null): ChannelAttachment["type"] {
    if (!mime) return "unknown";
    if (mime.startsWith("image/")) return "photo";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }

  async function pollNewMessages(): Promise<void> {
    try {
      // Include messages with text OR attachments (not just text-only)
      const sql = `SELECT m.ROWID, m.text, m.date, m.is_from_me,
               h.id AS sender_id, h.uncanonicalized_id AS sender_name,
               GROUP_CONCAT(a.mime_type, '||') AS att_mimes,
               GROUP_CONCAT(a.transfer_name, '||') AS att_names,
               GROUP_CONCAT(a.filename, '||') AS att_paths
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN message_attachment_join maj ON maj.message_id = m.ROWID
        LEFT JOIN attachment a ON a.ROWID = maj.attachment_id
        WHERE m.ROWID > ${lastRowId}
          AND m.is_from_me = 0
          AND (m.text IS NOT NULL AND m.text != '' OR a.ROWID IS NOT NULL)
        GROUP BY m.ROWID
        ORDER BY m.ROWID ASC
        LIMIT 50;`;

      const { stdout } = await execFileAsync(GATEWAY_BIN, [
        "query", "-readonly", "-json",
        CHAT_DB,
        sql,
      ]);

      if (!stdout.trim()) return;

      const rows = JSON.parse(stdout) as Array<{
        ROWID: number;
        text: string | null;
        date: number;
        is_from_me: number;
        sender_id: string | null;
        sender_name: string | null;
        att_mimes: string | null;
        att_names: string | null;
        att_paths: string | null;
      }>;

      for (const row of rows) {
        lastRowId = Math.max(lastRowId, row.ROWID);

        // Apple Cocoa timestamps: nanoseconds since 2001-01-01 (modern macOS)
        // or seconds since 2001-01-01 (older macOS)
        const timestamp =
          row.date > 1e15
            ? new Date((row.date / 1e9 + COCOA_EPOCH_OFFSET) * 1000)
            : new Date((row.date + COCOA_EPOCH_OFFSET) * 1000);

        // Parse attachments from GROUP_CONCAT results
        const attachments: ChannelAttachment[] = [];
        if (row.att_mimes) {
          const mimes = row.att_mimes.split("||");
          const names = row.att_names?.split("||") || [];
          const paths = row.att_paths?.split("||") || [];
          for (let i = 0; i < mimes.length; i++) {
            attachments.push({
              type: mimeToAttachmentType(mimes[i]),
              mimeType: mimes[i] || undefined,
              filename: names[i] || undefined,
              _imessagePath: paths[i] || undefined,
            });
          }
        }

        const msg: ChannelMessage = {
          channelId,
          channelType: "imessage",
          senderId: row.sender_id || "unknown",
          senderName: row.sender_name || row.sender_id || "Unknown",
          content: row.text || "",
          timestamp,
          metadata: { rowId: row.ROWID },
          attachments: attachments.length > 0 ? attachments : undefined,
        };

        adapter.onMessage?.(msg);
      }
    } catch (err) {
      // Transient DB lock is normal — Messages.app holds it briefly during writes
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("database is locked")) {
        console.error("[iMessage] Poll error:", msg);
      }
    }
  }

  const adapter: ChannelAdapter = {
    channelType: "imessage",
    channelId,

    onMessage: null,
    onStatusChange: null,
    onQrCode: null,

    async connect(_config) {
      status = "connecting";
      adapter.onStatusChange?.(adapter.getStatus());

      // Verify we can read the Messages database (via JOIGateway.app binary
      // which has FDA — no node/osascript permission popups)
      try {
        await execFileAsync(GATEWAY_BIN, [
          "query", "-readonly",
          CHAT_DB,
          "SELECT COUNT(*) FROM message LIMIT 1;",
        ]);
      } catch (err) {
        status = "error";
        errorMsg = formatMessagesDbReadError(err);
        adapter.onStatusChange?.(adapter.getStatus());
        throw new Error(errorMsg);
      }

      // Verify osascript can talk to Messages
      try {
        await runAppleScript('tell application "Messages" to name');
      } catch (err) {
        status = "error";
        errorMsg = `Cannot control Messages app: ${err instanceof Error ? err.message : String(err)}. Allow Automation in System Settings > Privacy & Security.`;
        adapter.onStatusChange?.(adapter.getStatus());
        throw new Error(errorMsg);
      }

      await initLastRowId();

      pollTimer = setInterval(() => {
        pollNewMessages().catch(() => {});
      }, POLL_INTERVAL);

      status = "connected";
      errorMsg = undefined;
      connectedAt = new Date();
      adapter.onStatusChange?.(adapter.getStatus());
    },

    async disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      status = "disconnected";
      errorMsg = undefined;
    },

    async send(to, content) {
      if (status !== "connected") throw new Error("iMessage not connected");

      // Escape for AppleScript string literal (only \ and " need escaping)
      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      const script = `tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${esc(to)}" of targetService
  send "${esc(content)}" to targetBuddy
end tell`;

      try {
        await runAppleScript(script);
      } catch (err) {
        throw new Error(
          `Failed to send iMessage to ${to}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    getStatus(): ChannelStatusInfo {
      return {
        channelId,
        channelType: "imessage",
        status,
        displayName: "iMessage",
        error: errorMsg,
        connectedAt,
      };
    },
  };

  return adapter;
}
