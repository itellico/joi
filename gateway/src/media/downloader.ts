// Media download orchestrator: insert pending record → download → store → update ready

import { query } from "../db/client.js";
import type { ChannelMessage, ChannelAttachment } from "../channels/types.js";
import type { MediaConfig } from "../config/schema.js";
import { storeMedia } from "./storage.js";
import { downloadFromChannel } from "./channel-downloads.js";

/** Resolve a sender_id + channel_type to a contact_id (best-effort, returns null if no match) */
async function resolveContactId(channelType: string, senderId: string): Promise<string | null> {
  if (!senderId) return null;

  try {
    let result;
    switch (channelType) {
      case "telegram":
        result = await query<{ id: string }>(
          `SELECT id FROM contacts WHERE telegram_id = $1 OR LOWER(telegram_username) = LOWER($1) LIMIT 1`,
          [senderId],
        );
        break;
      case "slack":
        result = await query<{ id: string }>(
          `SELECT id FROM contacts WHERE slack_handle = $1 LIMIT 1`,
          [senderId],
        );
        break;
      case "email":
        result = await query<{ id: string }>(
          `SELECT id FROM contacts WHERE LOWER($1) = ANY(SELECT LOWER(unnest(emails))) LIMIT 1`,
          [senderId],
        );
        break;
      case "imessage": {
        // iMessage sender_id can be a phone or email
        const digits = senderId.replace(/\D/g, "");
        result = await query<{ id: string }>(
          `SELECT id FROM contacts
           WHERE LOWER($1) = ANY(SELECT LOWER(unnest(emails)))
              OR EXISTS (
                SELECT 1 FROM unnest(phones) AS p
                WHERE regexp_replace(p, '[^0-9]', '', 'g') = $2
              )
           LIMIT 1`,
          [senderId, digits],
        );
        break;
      }
      case "whatsapp": {
        // WhatsApp sender_id is typically phone@s.whatsapp.net — normalize to digits only
        // Skip non-phone sender_ids like status@broadcast
        if (!senderId.includes("@s.whatsapp.net") && !senderId.includes("@lid")) return null;
        const phone = senderId.split("@")[0].replace(/\D/g, "");
        if (!phone) return null;
        result = await query<{ id: string }>(
          `SELECT id FROM contacts
           WHERE EXISTS (
             SELECT 1 FROM unnest(phones) AS p
             WHERE regexp_replace(p, '[^0-9]', '', 'g') = $1
           )
           LIMIT 1`,
          [phone],
        );
        break;
      }
      default:
        return null;
    }
    return result?.rows[0]?.id || null;
  } catch (err) {
    console.error("[Media] Contact resolution failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Process all attachments in a message — fire-and-forget from router */
export async function downloadMessageMedia(
  messageId: string,
  conversationId: string,
  msg: ChannelMessage,
  mediaConfig: MediaConfig,
): Promise<void> {
  const attachments = msg.attachments as ChannelAttachment[] | undefined;
  if (!attachments?.length) return;

  for (const att of attachments) {
    try {
      await downloadSingleAttachment({
        messageId,
        conversationId,
        channelType: msg.channelType,
        channelId: msg.channelId,
        senderId: msg.senderId,
        senderName: msg.senderName || null,
        attachment: att,
        caption: msg.content || null,
        mediaConfig,
      });
    } catch (err) {
      console.error("[Media] Download failed for attachment:", err instanceof Error ? err.message : err);
    }
  }
}

async function downloadSingleAttachment(opts: {
  messageId: string;
  conversationId: string;
  channelType: string;
  channelId: string;
  senderId: string;
  senderName: string | null;
  attachment: ChannelAttachment;
  caption: string | null;
  mediaConfig: MediaConfig;
}): Promise<void> {
  const { messageId, conversationId, channelType, channelId, senderId, senderName, attachment, caption, mediaConfig } = opts;

  // 0. Resolve contact from sender
  const contactId = await resolveContactId(channelType, senderId);

  // 1. Insert pending media record
  const insertResult = await query<{ id: string }>(
    `INSERT INTO media (message_id, conversation_id, channel_type, channel_id, sender_id, sender_name, contact_id,
       media_type, filename, mime_type, size_bytes, storage_path, status, caption)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending-' || gen_random_uuid(), 'pending', $12)
     RETURNING id`,
    [
      messageId, conversationId, channelType, channelId, senderId, senderName, contactId,
      attachment.type, attachment.filename || null, attachment.mimeType || null,
      attachment.size || null, caption,
    ],
  );
  const mediaId = insertResult.rows[0].id;

  // 2. Update to downloading
  await query(
    "UPDATE media SET status = 'downloading', updated_at = NOW() WHERE id = $1",
    [mediaId],
  );

  try {
    // 3. Download from channel
    const buffer = await downloadFromChannel(channelType, attachment);
    if (!buffer) {
      await query(
        "UPDATE media SET status = 'error', error_message = 'Download returned null', updated_at = NOW() WHERE id = $1",
        [mediaId],
      );
      return;
    }

    // Check file size limit
    const maxBytes = mediaConfig.maxFileSizeMB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      await query(
        "UPDATE media SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1",
        [mediaId, `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds ${mediaConfig.maxFileSizeMB}MB limit`],
      );
      return;
    }

    // 4. Store file + generate thumbnail
    const stored = await storeMedia({
      mediaId,
      buffer,
      rootPath: mediaConfig.storagePath,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      mediaConfig,
    });

    // 5. Update to ready
    await query(
      `UPDATE media SET
         status = 'ready',
         storage_path = $2,
         thumbnail_path = $3,
         width = $4,
         height = $5,
         size_bytes = $6,
         updated_at = NOW()
       WHERE id = $1`,
      [
        mediaId,
        stored.storagePath,
        stored.thumbnailPath,
        stored.width,
        stored.height,
        buffer.length,
      ],
    );

    console.log(`[Media] Downloaded ${attachment.type} from ${channelType}: ${stored.storagePath} (${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await query(
      "UPDATE media SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1",
      [mediaId, errMsg],
    ).catch(() => {});
    console.error(`[Media] Failed to process ${attachment.type} from ${channelType}:`, errMsg);
  }
}
