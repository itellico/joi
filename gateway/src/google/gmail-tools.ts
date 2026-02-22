// General-purpose Gmail agent tools
// Registered into the main tool registry (same pattern as calendar-tools.ts)

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { searchEmails, readEmail, sendEmail } from "./gmail.js";
import { listGoogleAccounts } from "./auth.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// ─── google_accounts_list: List connected Google accounts ───

handlers.set("google_accounts_list", async () => {
  const accounts = await listGoogleAccounts();
  return {
    count: accounts.length,
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      displayName: a.display_name,
      isDefault: a.is_default,
      status: a.status,
    })),
  };
});

// ─── gmail_search: Search emails with any Gmail query ───

handlers.set("gmail_search", async (input) => {
  const { query, max_results, account } = input as {
    query: string;
    max_results?: number;
    account?: string;
  };

  const emails = await searchEmails({ query, maxResults: max_results, accountId: account });

  return {
    count: emails.length,
    emails: emails.map((e) => ({
      messageId: e.messageId,
      threadId: e.threadId,
      from: e.from,
      to: e.to,
      subject: e.subject,
      date: e.date,
      snippet: e.snippet,
      labels: e.labels,
      bodyText: e.bodyText,
    })),
  };
});

// ─── gmail_read: Read a single email by ID ───

handlers.set("gmail_read", async (input) => {
  const { message_id, account } = input as { message_id: string; account?: string };

  const email = await readEmail(message_id, account);

  return {
    messageId: email.messageId,
    threadId: email.threadId,
    from: email.from,
    to: email.to,
    subject: email.subject,
    date: email.date,
    labels: email.labels,
    bodyText: email.bodyText,
  };
});

// ─── gmail_send: Send an email or reply ───

handlers.set("gmail_send", async (input) => {
  const { to, subject, body, cc, bcc, reply_to_message_id, thread_id, account } = input as {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    reply_to_message_id?: string;
    thread_id?: string;
    account?: string;
  };

  const result = await sendEmail({
    to,
    subject,
    body,
    cc,
    bcc,
    replyToMessageId: reply_to_message_id,
    threadId: thread_id,
    accountId: account,
  });

  return { sent: true, messageId: result.messageId, threadId: result.threadId };
});

// ─── Exports ───

export function getGmailToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

const accountParam = {
  type: "string",
  description: "Google account ID to use (default: primary account)",
} as const;

export function getGmailToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "google_accounts_list",
      description:
        "List all connected Google accounts. Use this to discover which accounts are available before searching Gmail, Calendar, or Drive. Each account has an ID you can pass as the 'account' parameter to other Google tools.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "gmail_search",
      description:
        "Search Gmail with any query. Uses Gmail search syntax (e.g. 'from:amazon subject:order', 'is:unread', 'newer_than:2d'). Returns message metadata and plain text body.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Gmail search query (same syntax as Gmail search bar)" },
          max_results: { type: "number", description: "Max emails to return (default: 10)" },
          account: accountParam,
        },
        required: ["query"],
      },
    },
    {
      name: "gmail_read",
      description:
        "Read a single email by message ID. Returns full message content including headers and body text.",
      input_schema: {
        type: "object" as const,
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: accountParam,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_send",
      description:
        "Send an email or reply to an existing thread. For replies, provide reply_to_message_id and thread_id to maintain threading.",
      input_schema: {
        type: "object" as const,
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (plain text)" },
          cc: { type: "string", description: "CC recipients (comma-separated)" },
          bcc: { type: "string", description: "BCC recipients (comma-separated)" },
          reply_to_message_id: { type: "string", description: "Message ID to reply to (for threading)" },
          thread_id: { type: "string", description: "Thread ID to add this reply to" },
          account: accountParam,
        },
        required: ["to", "subject", "body"],
      },
    },
  ];
}
