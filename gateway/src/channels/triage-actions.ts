// Triage action executor: runs proposed actions when a triage review is approved.

import { query } from "../db/client.js";
import { getAdapter } from "./manager.js";
import { linkMessageToContact } from "./router.js";
import { sendEmail, markAsProcessed } from "../google/gmail.js";
import {
  createTask as createThingsTask,
  updateTask,
  completeTask,
} from "../things/client.js";
import { getReviewsProjectHeadings } from "./triage.js";
import type { TriageAction } from "./triage.js";
import type { ChannelMessage } from "./types.js";
import { utilityCall } from "../agent/model-router.js";
import { loadConfig } from "../config/loader.js";

type BroadcastFn = (type: string, data: unknown) => void;

export async function executeTriageActions(
  reviewId: string,
  conversationId: string,
  actions: TriageAction[],
  broadcast?: BroadcastFn,
): Promise<void> {
  if (!actions || actions.length === 0) return;

  // Look up conversation to get channel info for replies
  const convResult = await query<{
    session_key: string;
    channel_id: string;
    metadata: Record<string, unknown>;
  }>(
    "SELECT session_key, channel_id, metadata FROM conversations WHERE id = $1",
    [conversationId],
  );

  const conv = convResult.rows[0];
  if (!conv) {
    console.error(`[TriageActions] Conversation ${conversationId} not found`);
    return;
  }

  for (const action of actions) {
    try {
      switch (action.type) {
        case "reply": {
          if (!action.draft) break;

          if (conv.session_key.startsWith("email:")) {
            // Email reply via Gmail API
            const meta = conv.metadata as {
              messageId?: string;
              threadId?: string;
              subject?: string;
              accountId?: string;
            };
            const recipientEmail = conv.session_key.split(":").slice(2).join(":");

            await sendEmail({
              to: recipientEmail,
              subject: `Re: ${meta.subject || ""}`,
              body: action.draft,
              replyToMessageId: meta.messageId,
              threadId: meta.threadId,
              accountId: meta.accountId,
            });

            // Store outbound message
            await query(
              `INSERT INTO messages (conversation_id, role, content, channel_id)
               VALUES ($1, 'assistant', $2, $3)`,
              [conversationId, action.draft, conv.channel_id],
            );

            // Track in CRM
            const emailOutMsg: ChannelMessage = {
              channelId: conv.channel_id || meta.accountId || "",
              channelType: "email",
              senderId: recipientEmail,
              content: action.draft,
              timestamp: new Date(),
            };
            linkMessageToContact(emailOutMsg, "outbound");

            // Mark original email as processed (archive from inbox)
            if (meta.messageId) {
              await markAsProcessed(meta.messageId, meta.accountId).catch((err) =>
                console.error("[TriageActions] markAsProcessed failed:", err),
              );
            }
          } else {
            // Channel adapter reply (WhatsApp, Telegram, iMessage)
            if (!conv.channel_id) break;

            const adapter = getAdapter(conv.channel_id);
            if (!adapter || adapter.getStatus().status !== "connected") {
              console.warn(`[TriageActions] Channel ${conv.channel_id} not available for reply`);
              break;
            }

            // Parse senderId from session_key: "channelType:channelId:senderId"
            const parts = conv.session_key.split(":");
            const senderId = parts.slice(2).join(":"); // rejoin in case senderId has colons

            await adapter.send(senderId, action.draft);

            // Store outbound message
            await query(
              `INSERT INTO messages (conversation_id, role, content, channel_id)
               VALUES ($1, 'assistant', $2, $3)`,
              [conversationId, action.draft, conv.channel_id],
            );

            // Track in CRM
            const outMsg: ChannelMessage = {
              channelId: conv.channel_id,
              channelType: adapter.channelType,
              senderId,
              content: action.draft,
              timestamp: new Date(),
            };
            linkMessageToContact(outMsg, "outbound");
          }
          break;
        }

        case "create_task": {
          if (!action.title) break;
          await createThingsTask(action.title, {
            notes: action.notes,
            when: action.when || "anytime",
          });
          break;
        }

        case "extract": {
          if (!action.extract_collection || !action.extract_fields?.length) break;
          try {
            const config = loadConfig();
            const extractPrompt = `Extract the following fields from this message as JSON: ${action.extract_fields.join(", ")}.\nRespond with ONLY valid JSON object.`;
            const lastMsg = await query<{ content: string }>(
              "SELECT content FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1",
              [conversationId],
            );
            if (!lastMsg.rows[0]) break;
            const extracted = await utilityCall(config, extractPrompt, lastMsg.rows[0].content, {
              maxTokens: 512,
              temperature: 0,
              task: "triage",
            });
            const data = JSON.parse(extracted.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || extracted.trim());
            // Create store object in target collection
            await query(
              `INSERT INTO store_objects (collection_id, title, data, tags, created_by)
               SELECT c.id, $2, $3::jsonb, $4, 'agent:triage'
               FROM store_collections c WHERE c.name = $1`,
              [action.extract_collection, action.title || "Extracted data", JSON.stringify(data), ["extracted", "triage"]],
            );
          } catch (err) {
            console.error("[TriageActions] Extract action failed:", err);
          }
          break;
        }

        case "label": {
          if (!action.labels?.length) break;
          // Add tags to conversation metadata
          await query(
            `UPDATE conversations
             SET metadata = jsonb_set(
               COALESCE(metadata, '{}'),
               '{labels}',
               (COALESCE(metadata->'labels', '[]'::jsonb) || $1::jsonb)
             ),
             updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(action.labels), conversationId],
          );
          break;
        }

        case "archive": {
          // Already handled by conversation status update below
          break;
        }

        case "no_action":
          break;
      }
    } catch (err) {
      console.error(`[TriageActions] Failed to execute ${action.type}:`, err);
    }
  }

  // Update conversation status
  await query(
    "UPDATE conversations SET inbox_status = 'handled', updated_at = NOW() WHERE id = $1",
    [conversationId],
  );

  // Move Things3 review task to Processed heading
  const headings = getReviewsProjectHeadings();
  if (headings?.processed) {
    const reviewResult = await query<{ things3_task_id: string | null }>(
      "SELECT things3_task_id FROM review_queue WHERE id = $1",
      [reviewId],
    );
    const things3Id = reviewResult.rows[0]?.things3_task_id;
    if (things3Id && !things3Id.startsWith("pending:")) {
      try {
        await updateTask(things3Id, { headingId: headings.processed });
        await completeTask(things3Id);
      } catch (err) {
        console.error("[TriageActions] Things3 task update failed:", err);
      }
    }
  }

  broadcast?.("triage.executed", {
    reviewId,
    conversationId,
    actionsCount: actions.length,
  });
}

/** Handle review rejection: update conversation status and move Things3 task. */
export async function handleTriageRejection(
  reviewId: string,
  conversationId: string,
): Promise<void> {
  // Update conversation status
  await query(
    "UPDATE conversations SET inbox_status = 'handled', updated_at = NOW() WHERE id = $1",
    [conversationId],
  );

  // Move Things3 review task to Rejected heading
  const headings = getReviewsProjectHeadings();
  if (headings?.rejected) {
    const reviewResult = await query<{ things3_task_id: string | null }>(
      "SELECT things3_task_id FROM review_queue WHERE id = $1",
      [reviewId],
    );
    const things3Id = reviewResult.rows[0]?.things3_task_id;
    if (things3Id && !things3Id.startsWith("pending:")) {
      try {
        await updateTask(things3Id, { headingId: headings.rejected });
        await completeTask(things3Id);
      } catch (err) {
        console.error("[TriageActions] Things3 rejection update failed:", err);
      }
    }
  }
}
