// Gmail API wrapper for invoice collection + general-purpose email
// Multi-account: all functions accept optional accountId

import { google, type gmail_v1 } from "googleapis";
import { getAuthClient } from "./auth.js";

const PROCESSED_LABEL = "JOI/Processed";
const TRIAGED_LABEL = "JOI/Triaged";

// Per-account Gmail client + label caches
const gmailCache = new Map<string, gmail_v1.Gmail>();
const labelCache = new Map<string, string>(); // key: "{accountKey}:{labelName}"

async function getGmail(accountId?: string): Promise<gmail_v1.Gmail> {
  const key = accountId || "_default";
  if (gmailCache.has(key)) return gmailCache.get(key)!;
  const auth = await getAuthClient(accountId);
  const gmail = google.gmail({ version: "v1", auth });
  gmailCache.set(key, gmail);
  return gmail;
}

async function getOrCreateLabelByName(
  gmail: gmail_v1.Gmail,
  labelName: string,
  accountId?: string,
): Promise<string> {
  const cacheKey = `${accountId || "_default"}:${labelName}`;
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey)!;

  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === labelName);

  if (existing?.id) {
    labelCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Create nested label
  const { data: created } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  labelCache.set(cacheKey, created.id!);
  return created.id!;
}

async function getOrCreateLabel(gmail: gmail_v1.Gmail, accountId?: string): Promise<string> {
  return getOrCreateLabelByName(gmail, PROCESSED_LABEL, accountId);
}

export interface InvoiceEmail {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  hasAttachments: boolean;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }>;
  bodyHtml: string | null;
  bodyText: string | null;
}

/**
 * Scan inbox for unprocessed invoice-like emails.
 * Looks for emails with PDF attachments or from known invoice senders.
 */
export async function scanForInvoices(options?: {
  maxResults?: number;
  query?: string;
  accountId?: string;
}): Promise<InvoiceEmail[]> {
  const gmail = await getGmail(options?.accountId);
  await getOrCreateLabel(gmail, options?.accountId);

  // Search for emails that might be invoices, excluding already processed
  const defaultQuery = "has:attachment (filename:pdf OR filename:invoice) -label:JOI/Processed";
  const q = options?.query || defaultQuery;

  const { data } = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: options?.maxResults || 20,
  });

  if (!data.messages || data.messages.length === 0) {
    return [];
  }

  const results: InvoiceEmail[] = [];

  for (const msg of data.messages) {
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });

      const headers = full.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      const attachments: InvoiceEmail["attachments"] = [];
      const parts = full.payload?.parts || [];

      // Recursively find attachments
      const findAttachments = (parts: gmail_v1.Schema$MessagePart[]) => {
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType || "application/octet-stream",
              size: part.body.size || 0,
              attachmentId: part.body.attachmentId,
            });
          }
          if (part.parts) findAttachments(part.parts);
        }
      };
      findAttachments(parts);

      // Extract body
      let bodyHtml: string | null = null;
      let bodyText: string | null = null;

      const findBody = (parts: gmail_v1.Schema$MessagePart[]) => {
        for (const part of parts) {
          if (part.mimeType === "text/html" && part.body?.data) {
            bodyHtml = Buffer.from(part.body.data, "base64url").toString("utf-8");
          }
          if (part.mimeType === "text/plain" && part.body?.data) {
            bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
          }
          if (part.parts) findBody(part.parts);
        }
      };

      if (full.payload?.body?.data) {
        const mime = full.payload.mimeType;
        const decoded = Buffer.from(full.payload.body.data, "base64url").toString("utf-8");
        if (mime === "text/html") bodyHtml = decoded;
        else bodyText = decoded;
      }
      findBody(parts);

      results.push({
        messageId: msg.id!,
        threadId: msg.threadId || "",
        from: getHeader("From"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        hasAttachments: attachments.length > 0,
        attachments,
        bodyHtml,
        bodyText,
      });
    } catch (err) {
      console.error(`Failed to process message ${msg.id}:`, err);
    }
  }

  return results;
}

/**
 * Download a specific attachment from a message.
 */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string,
  accountId?: string,
): Promise<Buffer> {
  const gmail = await getGmail(accountId);

  const { data } = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  if (!data.data) throw new Error("Empty attachment data");
  return Buffer.from(data.data, "base64url");
}

/**
 * Mark a message as processed (add label + archive).
 */
export async function markAsProcessed(messageId: string, accountId?: string): Promise<void> {
  const gmail = await getGmail(accountId);
  const labelId = await getOrCreateLabel(gmail, accountId);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds: ["INBOX"],
    },
  });
}

/**
 * Mark a message as triaged (add JOI/Triaged label, keep in INBOX).
 * Used by the email inbox scanner to prevent reprocessing.
 */
export async function markAsTriaged(messageId: string, accountId?: string): Promise<void> {
  const gmail = await getGmail(accountId);
  const labelId = await getOrCreateLabelByName(gmail, TRIAGED_LABEL, accountId);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
    },
  });
}

// ─── General-purpose Gmail functions ───

export interface EmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
  bodyText: string | null;
  bodyHtml: string | null;
}

/**
 * Search Gmail with any query. Returns message metadata + body.
 */
export async function searchEmails(options: {
  query: string;
  maxResults?: number;
  accountId?: string;
}): Promise<EmailMessage[]> {
  const gmail = await getGmail(options.accountId);

  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: options.query,
    maxResults: options.maxResults || 10,
  });

  if (!data.messages || data.messages.length === 0) return [];

  const results: EmailMessage[] = [];

  for (const msg of data.messages) {
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });

      const headers = full.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      let bodyHtml: string | null = null;
      let bodyText: string | null = null;

      const findBody = (parts: gmail_v1.Schema$MessagePart[]) => {
        for (const part of parts) {
          if (part.mimeType === "text/html" && part.body?.data) {
            bodyHtml = Buffer.from(part.body.data, "base64url").toString("utf-8");
          }
          if (part.mimeType === "text/plain" && part.body?.data) {
            bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
          }
          if (part.parts) findBody(part.parts);
        }
      };

      if (full.payload?.body?.data) {
        const mime = full.payload.mimeType;
        const decoded = Buffer.from(full.payload.body.data, "base64url").toString("utf-8");
        if (mime === "text/html") bodyHtml = decoded;
        else bodyText = decoded;
      }
      findBody(full.payload?.parts || []);

      results.push({
        messageId: msg.id!,
        threadId: msg.threadId || "",
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        snippet: full.snippet || "",
        labels: full.labelIds || [],
        bodyText,
        bodyHtml,
      });
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err);
    }
  }

  return results;
}

/**
 * Read a single email by message ID.
 */
export async function readEmail(messageId: string, accountId?: string): Promise<EmailMessage> {
  const gmail = await getGmail(accountId);

  const { data: full } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = full.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  let bodyHtml: string | null = null;
  let bodyText: string | null = null;

  const findBody = (parts: gmail_v1.Schema$MessagePart[]) => {
    for (const part of parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.mimeType === "text/plain" && part.body?.data) {
        bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) findBody(part.parts);
    }
  };

  if (full.payload?.body?.data) {
    const mime = full.payload.mimeType;
    const decoded = Buffer.from(full.payload.body.data, "base64url").toString("utf-8");
    if (mime === "text/html") bodyHtml = decoded;
    else bodyText = decoded;
  }
  findBody(full.payload?.parts || []);

  return {
    messageId: full.id!,
    threadId: full.threadId || "",
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    snippet: full.snippet || "",
    labels: full.labelIds || [],
    bodyText,
    bodyHtml,
  };
}

/**
 * Send an email (plain text or reply).
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToMessageId?: string;
  threadId?: string;
  accountId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = await getGmail(opts.accountId);

  const headers = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ];

  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  if (opts.replyToMessageId) {
    // Fetch original to get Message-ID and References headers for threading
    const { data: original } = await gmail.users.messages.get({
      userId: "me",
      id: opts.replyToMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References"],
    });
    const origHeaders = original.payload?.headers || [];
    const messageIdHeader = origHeaders.find((h) => h.name === "Message-ID")?.value;
    const referencesHeader = origHeaders.find((h) => h.name === "References")?.value;

    if (messageIdHeader) {
      headers.push(`In-Reply-To: ${messageIdHeader}`);
      headers.push(`References: ${referencesHeader ? referencesHeader + " " : ""}${messageIdHeader}`);
    }
  }

  const raw = Buffer.from(
    headers.join("\r\n") + "\r\n\r\n" + opts.body,
  ).toString("base64url");

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: opts.threadId,
    },
  });

  return {
    messageId: data.id!,
    threadId: data.threadId || "",
  };
}

export async function getMessageHtml(messageId: string, accountId?: string): Promise<string | null> {
  const gmail = await getGmail(accountId);

  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const findHtml = (parts: gmail_v1.Schema$MessagePart[]): string | null => {
    for (const part of parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        const found = findHtml(part.parts);
        if (found) return found;
      }
    }
    return null;
  };

  if (data.payload?.body?.data && data.payload.mimeType === "text/html") {
    return Buffer.from(data.payload.body.data, "base64url").toString("utf-8");
  }

  return findHtml(data.payload?.parts || []);
}
