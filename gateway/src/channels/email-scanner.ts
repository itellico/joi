// Email inbox scanner — polls all connected Gmail accounts for new emails
// and feeds them through the same triage pipeline as other channel adapters.
// Dedup: Gmail query excludes JOI/Triaged label; each email is labeled after processing.

import { query } from "../db/client.js";
import { listGoogleAccounts } from "../google/auth.js";
import { searchEmails, markAsTriaged, type EmailMessage } from "../google/gmail.js";
import { linkMessageToContact } from "./router.js";
import { triageInboundMessage } from "./triage.js";
import type { ChannelMessage } from "./types.js";
import type { JoiConfig } from "../config/schema.js";

type BroadcastFn = (type: string, data: unknown) => void;

/** Parse "Name <email>" or plain email into { name, email }. */
function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, "").trim(), email: match[2].toLowerCase() };
  }
  return { name: from, email: from.toLowerCase() };
}

/** Truncate email body to a reasonable length for triage. */
function truncateBody(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n\n[truncated]";
}

export async function scanEmailInboxes(
  config: JoiConfig,
  broadcast?: BroadcastFn,
): Promise<void> {
  const accounts = await listGoogleAccounts();
  const connected = accounts.filter((a) => a.status === "connected");

  if (connected.length === 0) {
    console.log("[EmailScanner] No connected Google accounts, skipping");
    return;
  }

  let totalProcessed = 0;

  for (const account of connected) {
    try {
      const emails = await searchEmails({
        query: "is:inbox -label:JOI/Triaged",
        maxResults: 20,
        accountId: account.id,
      });

      if (emails.length === 0) continue;

      console.log(`[EmailScanner] ${account.email || account.id}: ${emails.length} new email(s)`);

      for (const email of emails) {
        try {
          await processEmail(email, account.id, config, broadcast);
          totalProcessed++;
        } catch (err) {
          console.error(`[EmailScanner] Failed to process email ${email.messageId}:`, err);
        }
      }
    } catch (err) {
      console.error(`[EmailScanner] Failed to scan account ${account.id}:`, err);
    }
  }

  if (totalProcessed > 0) {
    console.log(`[EmailScanner] Processed ${totalProcessed} email(s)`);
  }
}

async function processEmail(
  email: EmailMessage,
  accountId: string,
  config: JoiConfig,
  broadcast?: BroadcastFn,
): Promise<void> {
  const { name: fromName, email: fromEmail } = parseFrom(email.from);
  const sessionKey = `email:${accountId}:${fromEmail}`;
  const bodyText = email.bodyText || email.snippet || "";

  // Find or create conversation
  let conversationId: string;
  const existing = await query<{ id: string }>(
    "SELECT id FROM conversations WHERE session_key = $1",
    [sessionKey],
  );

  if (existing.rows.length > 0) {
    conversationId = existing.rows[0].id;
  } else {
    const metadata = {
      channelType: "email",
      senderId: fromEmail,
      senderName: fromName,
      accountId,
      subject: email.subject,
      messageId: email.messageId,
      threadId: email.threadId,
    };
    const created = await query<{ id: string }>(
      `INSERT INTO conversations (agent_id, channel_id, session_key, title, metadata, type, inbox_status)
       VALUES ('personal', $1, $2, $3, $4, 'inbox', 'new')
       RETURNING id`,
      [
        accountId,
        sessionKey,
        `email — ${fromName || fromEmail}`,
        JSON.stringify(metadata),
      ],
    );
    conversationId = created.rows[0].id;
  }

  // Update conversation metadata with latest email info
  await query(
    `UPDATE conversations SET metadata = metadata || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [
      JSON.stringify({
        messageId: email.messageId,
        threadId: email.threadId,
        subject: email.subject,
        accountId,
        to: email.to,
      }),
      conversationId,
    ],
  );

  // Store inbound message — include subject in content for context
  const messageContent = email.subject
    ? `Subject: ${email.subject}\n\n${truncateBody(bodyText)}`
    : truncateBody(bodyText);

  await query(
    `INSERT INTO messages (conversation_id, role, content, channel_id, sender_id)
     VALUES ($1, 'user', $2, $3, $4)`,
    [conversationId, messageContent, accountId, fromEmail],
  );

  // Broadcast inbound message to web UI
  broadcast?.("channel.message", {
    direction: "inbound",
    conversationId,
    channelId: accountId,
    channelType: "email",
    senderId: fromEmail,
    from: fromName || fromEmail,
    text: messageContent,
    timestamp: new Date().toISOString(),
  });

  // Build ChannelMessage for triage + contact matching
  const channelMsg: ChannelMessage = {
    channelId: accountId,
    channelType: "email",
    senderId: fromEmail,
    senderName: fromName,
    content: messageContent,
    timestamp: email.date ? new Date(email.date) : new Date(),
    metadata: {
      messageId: email.messageId,
      threadId: email.threadId,
      subject: email.subject,
      accountId,
      to: email.to,
    },
  };

  // Link to CRM contact (fire-and-forget)
  linkMessageToContact(channelMsg, "inbound");

  // Label email as triaged in Gmail BEFORE running triage pipeline.
  // This prevents reprocessing if triage fails transiently.
  await markAsTriaged(email.messageId, accountId);

  // Run triage pipeline (failure here won't cause infinite reprocessing)
  await triageInboundMessage(conversationId, channelMsg, config, broadcast);
}
