// Inbound message router
// Receives messages from channel adapters, stores them in the conversation,
// broadcasts to the web UI, and fires async triage (LLM classification → review queue).
// Does NOT auto-reply — channels are read-only inboxes until a triage review is approved.

import { query } from "../db/client.js";
import type { ChannelMessage } from "./types.js";
import type { JoiConfig } from "../config/schema.js";
import { matchContact } from "../contacts/match.js";
import { triageInboundMessage } from "./triage.js";

export async function routeInboundMessage(
  msg: ChannelMessage,
  config: JoiConfig,
  broadcast?: (type: string, data: unknown) => void,
): Promise<void> {
  // Build a unique session key for this sender on this channel
  const sessionKey = `${msg.channelType}:${msg.channelId}:${msg.senderId}`;

  // Find or create conversation
  let conversationId: string;

  const existing = await query<{ id: string }>(
    "SELECT id FROM conversations WHERE session_key = $1",
    [sessionKey],
  );

  if (existing.rows.length > 0) {
    conversationId = existing.rows[0].id;
  } else {
    const created = await query<{ id: string }>(
      `INSERT INTO conversations (agent_id, channel_id, session_key, title, metadata, type, inbox_status)
       VALUES ('personal', $1, $2, $3, $4, 'inbox', 'new')
       RETURNING id`,
      [
        msg.channelId,
        sessionKey,
        `${msg.channelType} — ${msg.senderName || msg.senderId}`,
        JSON.stringify({ channelType: msg.channelType, senderId: msg.senderId, senderName: msg.senderName }),
      ],
    );
    conversationId = created.rows[0].id;
  }

  // Store the inbound message
  await query(
    `INSERT INTO messages (conversation_id, role, content, channel_id, sender_id, attachments)
     VALUES ($1, 'user', $2, $3, $4, $5)`,
    [conversationId, msg.content, msg.channelId, msg.senderId, msg.attachments ? JSON.stringify(msg.attachments) : null],
  );

  // Broadcast inbound message to web UI
  broadcast?.("channel.message", {
    direction: "inbound",
    conversationId,
    channelId: msg.channelId,
    channelType: msg.channelType,
    senderId: msg.senderId,
    from: msg.senderName || msg.senderId,
    text: msg.content,
    attachments: msg.attachments,
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget: link message to CRM contact
  linkMessageToContact(msg, "inbound");

  // Load scope from channel_configs for triage context
  let scope: string | undefined;
  try {
    const scopeResult = await query<{ scope: string | null }>(
      "SELECT scope FROM channel_configs WHERE id = $1",
      [msg.channelId],
    );
    scope = scopeResult.rows[0]?.scope ?? undefined;
  } catch { /* non-critical */ }

  // Fire-and-forget: triage the inbound message
  triageInboundMessage(conversationId, msg, config, broadcast, scope)
    .catch((err) => console.error("[Router] Triage failed:", err));
}

/** Build a human-readable summary from message content + attachments. */
function buildSummary(content: string, attachments?: import("./types.js").ChannelAttachment[]): string {
  const labels: Record<string, string> = {
    photo: "Photo", video: "Video", audio: "Audio", voice: "Voice message",
    document: "Document", sticker: "Sticker", unknown: "Attachment",
  };
  const parts: string[] = [];
  if (attachments?.length) {
    for (const a of attachments) {
      const label = labels[a.type] || "Attachment";
      parts.push(a.filename ? `[${label}: ${a.filename}]` : `[${label}]`);
    }
  }
  if (content) parts.push(content);
  const full = parts.join(" ");
  return full.length > 200 ? full.slice(0, 200) + "..." : full;
}

/** Build an external_id for dedup from message metadata. */
function buildExternalId(msg: ChannelMessage): string | null {
  const meta = msg.metadata;
  if (!meta) return null;
  switch (msg.channelType) {
    case "whatsapp":
      return meta.messageId ? `wa:${meta.messageId}` : null;
    case "telegram":
      return meta.messageId ? `tg:${meta.chatId || ""}:${meta.messageId}` : null;
    case "imessage":
      return meta.rowId ? `im:${meta.rowId}` : null;
    case "email":
      return meta.messageId ? `em:${meta.messageId}` : null;
    case "slack":
      return meta.messageTs ? `sl:${meta.teamId || ""}:${meta.messageTs}` : null;
    case "discord":
      return meta.messageId ? `dc:${meta.guildId || ""}:${meta.messageId}` : null;
    default:
      return null;
  }
}

/** Fire-and-forget: match sender to a contact and log the interaction. */
export function linkMessageToContact(
  msg: ChannelMessage,
  direction: "inbound" | "outbound",
  opts?: { externalId?: string; isFromMe?: boolean },
): void {
  matchContact(msg)
    .then(async (contactId) => {
      if (!contactId) return;
      const ts = msg.timestamp.toISOString();
      const summary = buildSummary(msg.content, msg.attachments);
      const meta: Record<string, unknown> = { senderId: msg.senderId, channelId: msg.channelId };
      if (msg.attachments?.length) meta.attachments = msg.attachments;
      const externalId = opts?.externalId ?? buildExternalId(msg);
      const isFromMe = opts?.isFromMe ?? (direction === "outbound");
      await query(
        `INSERT INTO contact_interactions (contact_id, platform, direction, summary, metadata, occurred_at, external_id, is_from_me)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
        [contactId, msg.channelType, direction, summary, JSON.stringify(meta), ts, externalId, isFromMe],
      );
      await query(
        `UPDATE contacts SET last_contacted_at = GREATEST(last_contacted_at, $1), updated_at = NOW() WHERE id = $2`,
        [ts, contactId],
      );
    })
    .catch((err) => {
      console.error("[Router] Contact match failed:", err);
    });
}
