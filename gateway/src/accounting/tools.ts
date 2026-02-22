// Accounting-specific tools for invoice collection, processing, and reconciliation
// Registered into the main tool registry

import type Anthropic from "@anthropic-ai/sdk";
import { query } from "../db/client.js";
import type { ToolContext } from "../agent/tools.js";
import {
  scanForInvoices,
  downloadAttachment,
  markAsProcessed,
  getMessageHtml,
} from "../google/gmail.js";
import {
  uploadFile,
  listFiles,
  fileExists,
  ensureFolder,
} from "../google/drive.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

// ─── Tool handlers ───

const handlers = new Map<string, ToolHandler>();

// ─── gmail_scan: Scan Gmail for unprocessed invoice emails ───

handlers.set("gmail_scan", async (input) => {
  const { query: customQuery, max_results, account } = input as {
    query?: string;
    max_results?: number;
    account?: string;
  };

  const emails = await scanForInvoices({
    query: customQuery,
    maxResults: max_results,
    accountId: account,
  });

  return {
    count: emails.length,
    emails: emails.map((e) => ({
      messageId: e.messageId,
      from: e.from,
      subject: e.subject,
      date: e.date,
      hasAttachments: e.hasAttachments,
      attachments: e.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      hasHtmlBody: !!e.bodyHtml,
    })),
  };
});

// ─── gmail_download: Download an attachment from Gmail ───

handlers.set("gmail_download", async (input) => {
  const { message_id, attachment_id, filename, account } = input as {
    message_id: string;
    attachment_id: string;
    filename: string;
    account?: string;
  };

  const data = await downloadAttachment(message_id, attachment_id, account);

  // Upload to Drive staging folder
  const month = new Date().toISOString().slice(0, 7); // 2026-02
  const folderPath = `JOI/Accounting/${month}/inbox`;
  const result = await uploadFile(filename, data, "application/pdf", folderPath, account);

  return {
    uploaded: true,
    driveFileId: result.fileId,
    drivePath: `${folderPath}/${filename}`,
    webViewLink: result.webViewLink,
    size: data.length,
  };
});

// ─── gmail_get_html: Get HTML body of an email (for HTML-to-PDF) ───

handlers.set("gmail_get_html", async (input) => {
  const { message_id, account } = input as { message_id: string; account?: string };
  const html = await getMessageHtml(message_id, account);
  if (!html) return { error: "No HTML body found in this email." };
  return { html, length: html.length };
});

// ─── gmail_mark_processed: Mark email as processed ───

handlers.set("gmail_mark_processed", async (input) => {
  const { message_id, account } = input as { message_id: string; account?: string };
  await markAsProcessed(message_id, account);
  return { processed: true, messageId: message_id };
});

// ─── drive_upload: Upload a file to Google Drive ───

handlers.set("drive_upload", async (input) => {
  const { filename, content_base64, mime_type, folder_path, account } = input as {
    filename: string;
    content_base64: string;
    mime_type: string;
    folder_path: string;
    account?: string;
  };

  const data = Buffer.from(content_base64, "base64");
  const result = await uploadFile(filename, data, mime_type, folder_path, account);

  return {
    uploaded: true,
    fileId: result.fileId,
    name: result.name,
    webViewLink: result.webViewLink,
  };
});

// ─── drive_list: List files in a Drive folder ───

handlers.set("drive_list", async (input) => {
  const { folder_path, mime_type, limit, account } = input as {
    folder_path: string;
    mime_type?: string;
    limit?: number;
    account?: string;
  };

  const files = await listFiles(folder_path, { mimeType: mime_type, limit }, account);
  return { files, count: files.length };
});

// ─── invoice_save: Save extracted invoice data to DB ───

handlers.set("invoice_save", async (input) => {
  const {
    vendor,
    amount,
    currency,
    invoice_date,
    invoice_number,
    source_file,
    source_email_id,
    payment_method,
    metadata,
  } = input as {
    vendor: string;
    amount?: number;
    currency?: string;
    invoice_date?: string;
    invoice_number?: string;
    source_file?: string;
    source_email_id?: string;
    payment_method?: string;
    metadata?: Record<string, unknown>;
  };

  const result = await query<{ id: string }>(
    `INSERT INTO invoices (vendor, amount, currency, invoice_date, invoice_number,
       source_file, source_email_id, payment_method, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      vendor,
      amount || null,
      currency || "EUR",
      invoice_date || null,
      invoice_number || null,
      source_file || null,
      source_email_id || null,
      payment_method || null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );

  return { saved: true, id: result.rows[0].id };
});

// ─── invoice_classify: Set BMD folder classification for an invoice ───

handlers.set("invoice_classify", async (input) => {
  const { invoice_id, bmd_folder, payment_method } = input as {
    invoice_id: string;
    bmd_folder: string;
    payment_method?: string;
  };

  const updates: string[] = ["bmd_folder = $1", "status = 'classified'", "updated_at = NOW()"];
  const params: unknown[] = [bmd_folder];
  let idx = 2;

  if (payment_method) {
    updates.push(`payment_method = $${idx++}`);
    params.push(payment_method);
  }

  params.push(invoice_id);

  await query(
    `UPDATE invoices SET ${updates.join(", ")} WHERE id = $${idx}`,
    params,
  );

  return { classified: true, invoiceId: invoice_id, bmdFolder: bmd_folder };
});

// ─── invoice_list: List invoices with optional filters ───

handlers.set("invoice_list", async (input) => {
  const { status, vendor, month, limit } = input as {
    status?: string;
    vendor?: string;
    month?: string;
    limit?: number;
  };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (vendor) {
    conditions.push(`vendor ILIKE $${idx++}`);
    params.push(`%${vendor}%`);
  }
  if (month) {
    conditions.push(`to_char(invoice_date, 'YYYY-MM') = $${idx++}`);
    params.push(month);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit || 50);

  const result = await query(
    `SELECT id, vendor, amount, currency, invoice_date, invoice_number,
            bmd_folder, payment_method, status, source_file, created_at
     FROM invoices
     ${where}
     ORDER BY invoice_date DESC NULLS LAST, created_at DESC
     LIMIT $${idx}`,
    params,
  );

  return { invoices: result.rows, count: result.rows.length };
});

// ─── transaction_import: Import transactions from George CSV data ───

handlers.set("transaction_import", async (input) => {
  const { transactions, source_file } = input as {
    transactions: Array<{
      account: string;
      account_type?: string;
      booking_date: string;
      value_date?: string;
      amount: number;
      currency?: string;
      description: string;
      counterparty?: string;
      reference?: string;
    }>;
    source_file?: string;
  };

  let imported = 0;
  let skipped = 0;

  for (const tx of transactions) {
    // Dedup by account + booking_date + amount + description
    const existing = await query(
      `SELECT id FROM transactions
       WHERE account = $1 AND booking_date = $2 AND amount = $3 AND description = $4`,
      [tx.account, tx.booking_date, tx.amount, tx.description],
    );

    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    await query(
      `INSERT INTO transactions (account, account_type, booking_date, value_date,
         amount, currency, description, counterparty, reference, source_file)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tx.account,
        tx.account_type || null,
        tx.booking_date,
        tx.value_date || null,
        tx.amount,
        tx.currency || "EUR",
        tx.description,
        tx.counterparty || null,
        tx.reference || null,
        source_file || null,
      ],
    );
    imported++;
  }

  return { imported, skipped, total: transactions.length };
});

// ─── transaction_match: Match a transaction to an invoice ───

handlers.set("transaction_match", async (input) => {
  const { transaction_id, invoice_id, confidence } = input as {
    transaction_id: string;
    invoice_id: string;
    confidence: number;
  };

  await query(
    `UPDATE transactions SET matched_invoice_id = $1, match_confidence = $2 WHERE id = $3`,
    [invoice_id, confidence, transaction_id],
  );

  await query(
    `UPDATE invoices SET matched_transaction_id = $1, status = 'matched', updated_at = NOW() WHERE id = $2`,
    [transaction_id, invoice_id],
  );

  return { matched: true, transactionId: transaction_id, invoiceId: invoice_id, confidence };
});

// ─── transaction_list: List transactions with optional filters ───

handlers.set("transaction_list", async (input) => {
  const { month, unmatched_only, account, limit } = input as {
    month?: string;
    unmatched_only?: boolean;
    account?: string;
    limit?: number;
  };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (month) {
    conditions.push(`to_char(booking_date, 'YYYY-MM') = $${idx++}`);
    params.push(month);
  }
  if (unmatched_only) {
    conditions.push("matched_invoice_id IS NULL");
  }
  if (account) {
    conditions.push(`account ILIKE $${idx++}`);
    params.push(`%${account}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit || 100);

  const result = await query(
    `SELECT id, account, account_type, booking_date, value_date,
            amount, currency, description, counterparty, vendor_normalized,
            matched_invoice_id, match_confidence, source_file, created_at
     FROM transactions
     ${where}
     ORDER BY booking_date DESC
     LIMIT $${idx}`,
    params,
  );

  return { transactions: result.rows, count: result.rows.length };
});

// ─── reconciliation_run: Create/update a reconciliation run ───

handlers.set("reconciliation_run", async (input) => {
  const { month, action, stats, report } = input as {
    month: string;
    action: "start" | "update" | "complete";
    stats?: {
      total_transactions?: number;
      matched?: number;
      unmatched?: number;
      missing_invoices?: number;
      orphan_invoices?: number;
    };
    report?: unknown;
  };

  if (action === "start") {
    const result = await query<{ id: string }>(
      `INSERT INTO reconciliation_runs (month) VALUES ($1) RETURNING id`,
      [month],
    );
    return { started: true, id: result.rows[0].id, month };
  }

  if (action === "update" || action === "complete") {
    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (action === "complete") {
      updates.push(`status = 'completed'`);
      updates.push(`completed_at = NOW()`);
    }
    if (stats?.total_transactions !== undefined) {
      updates.push(`total_transactions = $${idx++}`);
      params.push(stats.total_transactions);
    }
    if (stats?.matched !== undefined) {
      updates.push(`matched = $${idx++}`);
      params.push(stats.matched);
    }
    if (stats?.unmatched !== undefined) {
      updates.push(`unmatched = $${idx++}`);
      params.push(stats.unmatched);
    }
    if (stats?.missing_invoices !== undefined) {
      updates.push(`missing_invoices = $${idx++}`);
      params.push(stats.missing_invoices);
    }
    if (stats?.orphan_invoices !== undefined) {
      updates.push(`orphan_invoices = $${idx++}`);
      params.push(stats.orphan_invoices);
    }
    if (report) {
      updates.push(`report = $${idx++}`);
      params.push(JSON.stringify(report));
    }

    params.push(month);

    if (updates.length > 0) {
      await query(
        `UPDATE reconciliation_runs SET ${updates.join(", ")} WHERE month = $${idx}`,
        params,
      );
    }

    return { updated: true, month, status: action === "complete" ? "completed" : "running" };
  }

  return { error: "Invalid action" };
});

// ─── Export tool handlers and definitions ───

export function getAccountingToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

const accountParam = {
  type: "string",
  description: "Google account ID to use (default: primary account)",
} as const;

export function getAccountingToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "gmail_scan",
      description:
        "Scan Gmail for unprocessed invoice emails. Returns a list of emails with attachment info. Use the default query to find PDFs, or provide a custom Gmail search query.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Custom Gmail search query (optional). Default: finds emails with PDF attachments not yet processed." },
          max_results: { type: "number", description: "Max emails to return (default: 20)" },
          account: accountParam,
        },
        required: [],
      },
    },
    {
      name: "gmail_download",
      description:
        "Download an email attachment and upload it to Google Drive staging folder (JOI/Accounting/YYYY-MM/inbox).",
      input_schema: {
        type: "object" as const,
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          attachment_id: { type: "string", description: "Attachment ID from gmail_scan results" },
          filename: { type: "string", description: "Filename to save as" },
          account: accountParam,
        },
        required: ["message_id", "attachment_id", "filename"],
      },
    },
    {
      name: "gmail_get_html",
      description:
        "Get the HTML body of an email. Use for emails that ARE invoices (like Apple receipts) where the email body itself is the invoice. The HTML can then be converted to PDF.",
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
      name: "gmail_mark_processed",
      description: "Mark a Gmail message as processed (adds JOI/Processed label, removes from INBOX).",
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
      name: "drive_upload",
      description: "Upload a file to Google Drive at a specific folder path.",
      input_schema: {
        type: "object" as const,
        properties: {
          filename: { type: "string", description: "File name" },
          content_base64: { type: "string", description: "File content as base64" },
          mime_type: { type: "string", description: "MIME type (e.g. application/pdf)" },
          folder_path: { type: "string", description: "Drive folder path (e.g. JOI/Accounting/2026-02/classified)" },
          account: accountParam,
        },
        required: ["filename", "content_base64", "mime_type", "folder_path"],
      },
    },
    {
      name: "drive_list",
      description: "List files in a Google Drive folder.",
      input_schema: {
        type: "object" as const,
        properties: {
          folder_path: { type: "string", description: "Drive folder path" },
          mime_type: { type: "string", description: "Filter by MIME type (optional)" },
          limit: { type: "number", description: "Max files to return (default: 100)" },
          account: accountParam,
        },
        required: ["folder_path"],
      },
    },
    {
      name: "invoice_save",
      description:
        "Save extracted invoice data to the database. Call after parsing a PDF/document to store vendor, amount, date, etc.",
      input_schema: {
        type: "object" as const,
        properties: {
          vendor: { type: "string", description: "Vendor/company name" },
          amount: { type: "number", description: "Invoice amount" },
          currency: { type: "string", description: "Currency (default: EUR)" },
          invoice_date: { type: "string", description: "Invoice date (YYYY-MM-DD)" },
          invoice_number: { type: "string", description: "Invoice number" },
          source_file: { type: "string", description: "Google Drive file ID or path" },
          source_email_id: { type: "string", description: "Gmail message ID (if from email)" },
          payment_method: { type: "string", enum: ["bar", "bank", "cc", "paypal", "stripe"], description: "Payment method" },
          metadata: { type: "object", description: "Additional metadata" },
        },
        required: ["vendor"],
      },
    },
    {
      name: "invoice_classify",
      description:
        "Classify an invoice into a BMD folder. Sets the target folder for BMD upload and optionally the payment method.",
      input_schema: {
        type: "object" as const,
        properties: {
          invoice_id: { type: "string", description: "Invoice UUID" },
          bmd_folder: { type: "string", description: "BMD target folder name" },
          payment_method: { type: "string", enum: ["bar", "bank", "cc", "paypal", "stripe"], description: "Payment method (optional update)" },
        },
        required: ["invoice_id", "bmd_folder"],
      },
    },
    {
      name: "invoice_list",
      description: "List invoices from the database with optional filters.",
      input_schema: {
        type: "object" as const,
        properties: {
          status: { type: "string", enum: ["pending", "classified", "matched", "uploaded", "error"], description: "Filter by status" },
          vendor: { type: "string", description: "Filter by vendor name (partial match)" },
          month: { type: "string", description: "Filter by month (YYYY-MM)" },
          limit: { type: "number", description: "Max results (default: 50)" },
        },
        required: [],
      },
    },
    {
      name: "transaction_import",
      description:
        "Import bank/credit card transactions from parsed George CSV export data. Deduplicates automatically.",
      input_schema: {
        type: "object" as const,
        properties: {
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                account: { type: "string", description: "IBAN or masked CC number" },
                account_type: { type: "string", enum: ["giro", "creditcard", "bankcard"] },
                booking_date: { type: "string", description: "Booking date (YYYY-MM-DD)" },
                value_date: { type: "string", description: "Value date (YYYY-MM-DD)" },
                amount: { type: "number", description: "Amount (negative for debits)" },
                currency: { type: "string", description: "Currency (default: EUR)" },
                description: { type: "string", description: "Raw bank description" },
                counterparty: { type: "string", description: "Auftraggeber/Empfänger" },
                reference: { type: "string", description: "Bank reference" },
              },
              required: ["account", "booking_date", "amount", "description"],
            },
            description: "Array of transactions to import",
          },
          source_file: { type: "string", description: "CSV file path for reference" },
        },
        required: ["transactions"],
      },
    },
    {
      name: "transaction_match",
      description:
        "Match a bank transaction to an invoice. Links them in the database for reconciliation.",
      input_schema: {
        type: "object" as const,
        properties: {
          transaction_id: { type: "string", description: "Transaction UUID" },
          invoice_id: { type: "string", description: "Invoice UUID" },
          confidence: { type: "number", description: "Match confidence 0.0-1.0" },
        },
        required: ["transaction_id", "invoice_id", "confidence"],
      },
    },
    {
      name: "transaction_list",
      description: "List bank transactions with optional filters.",
      input_schema: {
        type: "object" as const,
        properties: {
          month: { type: "string", description: "Filter by month (YYYY-MM)" },
          unmatched_only: { type: "boolean", description: "Only show unmatched transactions" },
          account: { type: "string", description: "Filter by account (partial match)" },
          limit: { type: "number", description: "Max results (default: 100)" },
        },
        required: [],
      },
    },
    {
      name: "reconciliation_run",
      description:
        "Manage reconciliation runs. Start a new run, update stats, or mark as complete.",
      input_schema: {
        type: "object" as const,
        properties: {
          month: { type: "string", description: "Month to reconcile (YYYY-MM)" },
          action: { type: "string", enum: ["start", "update", "complete"], description: "Action to take" },
          stats: {
            type: "object",
            properties: {
              total_transactions: { type: "number" },
              matched: { type: "number" },
              unmatched: { type: "number" },
              missing_invoices: { type: "number" },
              orphan_invoices: { type: "number" },
            },
            description: "Stats to update (for 'update' and 'complete' actions)",
          },
          report: { type: "object", description: "Final report data (for 'complete' action)" },
        },
        required: ["month", "action"],
      },
    },
  ];
}
