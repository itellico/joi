// Quotes / Angebote — agent tool definitions and handlers

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

// ─── Helpers ───

async function nextQuoteNumber(prefix?: string): Promise<string> {
  const result = await query<{ nextval: string }>("SELECT nextval('quote_number_seq')");
  const seq = result.rows[0].nextval;
  return prefix ? `${prefix}-${seq}` : `ANG-${seq}`;
}

async function recalculateTotals(quoteId: string): Promise<void> {
  // Sum line items
  const itemsResult = await query<{ total: string }>(
    "SELECT COALESCE(SUM(line_total), 0) AS total FROM quote_items WHERE quote_id = $1",
    [quoteId],
  );
  const subtotal = parseFloat(itemsResult.rows[0].total);

  // Get quote discount + VAT
  const quoteResult = await query<{ discount_percent: string; vat_percent: string }>(
    "SELECT discount_percent, vat_percent FROM quotes WHERE id = $1",
    [quoteId],
  );
  if (quoteResult.rows.length === 0) return;
  const discountPct = parseFloat(quoteResult.rows[0].discount_percent);
  const vatPct = parseFloat(quoteResult.rows[0].vat_percent);

  const discountAmount = subtotal * (discountPct / 100);
  const netTotal = subtotal - discountAmount;
  const vatAmount = netTotal * (vatPct / 100);
  const grossTotal = netTotal + vatAmount;

  await query(
    `UPDATE quotes SET
       subtotal = $2, discount_amount = $3, net_total = $4,
       vat_amount = $5, gross_total = $6, updated_at = NOW()
     WHERE id = $1`,
    [quoteId, subtotal, discountAmount, netTotal, vatAmount, grossTotal],
  );
}

// ─── Tool handlers ───

export function getQuotesToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // ─── quotes_create ───
  handlers.set("quotes_create", async (input, ctx) => {
    const {
      title, contact_id, company_id, prefix, valid_days,
      intro_text, closing_text, terms, notes, tags,
      sender_name, sender_email, vat_percent,
    } = input as {
      title: string;
      contact_id?: string;
      company_id?: string;
      prefix?: string;
      valid_days?: number;
      intro_text?: string;
      closing_text?: string;
      terms?: Record<string, string>;
      notes?: string;
      tags?: string[];
      sender_name?: string;
      sender_email?: string;
      vat_percent?: number;
    };

    const quoteNumber = await nextQuoteNumber(prefix);
    const validUntil = valid_days
      ? new Date(Date.now() + valid_days * 86400000).toISOString().slice(0, 10)
      : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const result = await query<{ id: string; quote_number: string; issued_date: string }>(
      `INSERT INTO quotes (
        quote_number, title, contact_id, company_id, valid_until,
        intro_text, closing_text, terms, notes, tags,
        sender_name, sender_email, vat_percent, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id, quote_number, issued_date`,
      [
        quoteNumber, title, contact_id || null, company_id || null, validUntil,
        intro_text || null, closing_text || null,
        terms ? JSON.stringify(terms) : "{}",
        notes || null, tags || [],
        sender_name || null, sender_email || null,
        vat_percent ?? 20,
        `agent:${ctx.agentId}`,
      ],
    );

    return {
      id: result.rows[0].id,
      quote_number: result.rows[0].quote_number,
      issued_date: result.rows[0].issued_date,
      valid_until: validUntil,
      message: `Quote ${quoteNumber} created. Add line items with quotes_add_item.`,
    };
  });

  // ─── quotes_get ───
  handlers.set("quotes_get", async (input) => {
    const { id } = input as { id: string };
    const quoteResult = await query(
      `SELECT q.*,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.emails AS contact_emails, c.job_title AS contact_job_title,
              comp.name AS company_name, comp.domain AS company_domain
       FROM quotes q
       LEFT JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN companies comp ON comp.id = q.company_id
       WHERE q.id = $1`,
      [id],
    );
    if (quoteResult.rows.length === 0) return { error: "Quote not found" };

    const itemsResult = await query(
      "SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, created_at",
      [id],
    );

    return { quote: quoteResult.rows[0], items: itemsResult.rows };
  });

  // ─── quotes_list ───
  handlers.set("quotes_list", async (input) => {
    const { status, contact_id, limit, offset } = input as {
      status?: string; contact_id?: string; limit?: number; offset?: number;
    };

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) { conditions.push(`q.status = $${idx++}`); params.push(status); }
    if (contact_id) { conditions.push(`q.contact_id = $${idx++}`); params.push(contact_id); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(limit || 50, 200);
    const off = offset || 0;
    params.push(lim, off);

    const result = await query(
      `SELECT q.id, q.quote_number, q.title, q.status, q.net_total, q.gross_total,
              q.currency, q.issued_date, q.valid_until, q.tags, q.created_at,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              comp.name AS company_name
       FROM quotes q
       LEFT JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN companies comp ON comp.id = q.company_id
       ${where}
       ORDER BY q.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    const countResult = await query(
      `SELECT count(*)::int AS total FROM quotes q ${where}`,
      params.slice(0, -2),
    );

    return { quotes: result.rows, total: countResult.rows[0]?.total || 0 };
  });

  // ─── quotes_update ───
  handlers.set("quotes_update", async (input) => {
    const {
      id, title, status, contact_id, company_id, valid_until,
      intro_text, closing_text, terms, notes, tags,
      discount_percent, vat_percent,
    } = input as {
      id: string;
      title?: string; status?: string; contact_id?: string; company_id?: string;
      valid_until?: string; intro_text?: string; closing_text?: string;
      terms?: Record<string, string>; notes?: string; tags?: string[];
      discount_percent?: number; vat_percent?: number;
    };

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    const fields: Record<string, unknown> = {
      title, status, contact_id, company_id, valid_until,
      intro_text, closing_text, notes, discount_percent, vat_percent,
    };
    for (const [field, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(value);
      }
    }
    if (terms !== undefined) {
      updates.push(`terms = $${idx++}`);
      params.push(JSON.stringify(terms));
    }
    if (tags !== undefined) {
      updates.push(`tags = $${idx++}`);
      params.push(tags);
    }

    params.push(id);
    await query(`UPDATE quotes SET ${updates.join(", ")} WHERE id = $${idx}`, params);

    // Recalculate if discount/vat changed
    if (discount_percent !== undefined || vat_percent !== undefined) {
      await recalculateTotals(id);
    }

    return { id, updated: true };
  });

  // ─── quotes_add_item ───
  handlers.set("quotes_add_item", async (input) => {
    const {
      quote_id, section, article, description, detail, cycle,
      quantity, unit, unit_price, discount_percent,
    } = input as {
      quote_id: string;
      section?: string; article?: string; description: string; detail?: string;
      cycle?: string; quantity?: number; unit?: string; unit_price: number;
      discount_percent?: number;
    };

    const qty = quantity ?? 1;
    const disc = discount_percent ?? 0;
    const lineTotal = qty * unit_price * (1 - disc / 100);

    // Get next sort order
    const orderResult = await query<{ max: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS max FROM quote_items WHERE quote_id = $1",
      [quote_id],
    );

    const result = await query<{ id: string }>(
      `INSERT INTO quote_items (
        quote_id, sort_order, section, article, description, detail, cycle,
        quantity, unit, unit_price, discount_percent, line_total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        quote_id, orderResult.rows[0].max,
        section || null, article || null, description, detail || null, cycle || null,
        qty, unit || "Stück", unit_price, disc, lineTotal,
      ],
    );

    await recalculateTotals(quote_id);

    return { id: result.rows[0].id, line_total: lineTotal };
  });

  // ─── quotes_update_item ───
  handlers.set("quotes_update_item", async (input) => {
    const { id, ...fields } = input as {
      id: string;
      section?: string; article?: string; description?: string; detail?: string;
      cycle?: string; quantity?: number; unit?: string; unit_price?: number;
      discount_percent?: number; sort_order?: number;
    };

    // Fetch current to merge
    const existing = await query<Record<string, unknown>>(
      "SELECT * FROM quote_items WHERE id = $1", [id],
    );
    if (existing.rows.length === 0) return { error: "Item not found" };
    const item = existing.rows[0];

    const qty = fields.quantity ?? Number(item.quantity);
    const price = fields.unit_price ?? Number(item.unit_price);
    const disc = fields.discount_percent ?? Number(item.discount_percent);
    const lineTotal = qty * price * (1 - disc / 100);

    const updates: string[] = ["line_total = $2"];
    const params: unknown[] = [id, lineTotal];
    let idx = 3;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    await query(`UPDATE quote_items SET ${updates.join(", ")} WHERE id = $1`, params);
    await recalculateTotals(item.quote_id as string);

    return { id, line_total: lineTotal, updated: true };
  });

  // ─── quotes_remove_item ───
  handlers.set("quotes_remove_item", async (input) => {
    const { id } = input as { id: string };
    const existing = await query<{ quote_id: string }>(
      "SELECT quote_id FROM quote_items WHERE id = $1", [id],
    );
    if (existing.rows.length === 0) return { error: "Item not found" };

    await query("DELETE FROM quote_items WHERE id = $1", [id]);
    await recalculateTotals(existing.rows[0].quote_id);

    return { id, deleted: true };
  });

  // ─── quotes_recalculate ───
  handlers.set("quotes_recalculate", async (input) => {
    const { id } = input as { id: string };
    await recalculateTotals(id);
    const result = await query<Record<string, unknown>>(
      "SELECT subtotal, discount_amount, net_total, vat_amount, gross_total FROM quotes WHERE id = $1",
      [id],
    );
    return result.rows[0] || { error: "Quote not found" };
  });

  // ─── quotes_generate_pdf ───
  handlers.set("quotes_generate_pdf", async (input) => {
    const { id } = input as { id: string };
    // Generates HTML and returns URL — actual PDF rendering handled by the API route
    return {
      html_url: `/api/quotes/${id}/html`,
      pdf_url: `/api/quotes/${id}/pdf`,
      message: "Use the HTML URL for preview or PDF URL for download.",
    };
  });

  return handlers;
}

// ─── Tool definitions ───

export function getQuotesToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "quotes_create",
      description:
        "Create a new quote/offer (Angebot). Links to a contact and/or company. " +
        "Returns quote ID and number. Add line items separately with quotes_add_item.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Quote title (e.g. 'Sprach-KI Agent Cloud Service')" },
          contact_id: { type: "string", description: "Contact UUID to link the quote to" },
          company_id: { type: "string", description: "Company UUID (optional, auto-resolved from contact)" },
          prefix: { type: "string", description: "Quote number prefix (default: 'ANG')" },
          valid_days: { type: "number", description: "Days until quote expires (default: 14)" },
          intro_text: { type: "string", description: "Opening text paragraph" },
          closing_text: { type: "string", description: "Closing text paragraph" },
          terms: { type: "object", description: "Contract terms: {payment, delivery, contract_duration, acceptance}" },
          notes: { type: "string", description: "Internal notes (not shown on quote)" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for filtering" },
          sender_name: { type: "string", description: "Override sender name" },
          sender_email: { type: "string", description: "Override sender email" },
          vat_percent: { type: "number", description: "VAT percentage (default: 20)" },
        },
        required: ["title"],
      },
    },
    {
      name: "quotes_get",
      description: "Get full quote details including all line items, contact info, and totals.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Quote UUID" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_list",
      description: "List quotes with optional filters by status and contact.",
      input_schema: {
        type: "object" as const,
        properties: {
          status: { type: "string", enum: ["draft", "sent", "accepted", "declined", "expired"], description: "Filter by status" },
          contact_id: { type: "string", description: "Filter by contact" },
          limit: { type: "number", description: "Max results (default: 50)" },
          offset: { type: "number", description: "Pagination offset" },
        },
        required: [],
      },
    },
    {
      name: "quotes_update",
      description: "Update quote fields: title, status, dates, texts, terms, discount, VAT.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Quote UUID" },
          title: { type: "string" },
          status: { type: "string", enum: ["draft", "sent", "accepted", "declined", "expired"] },
          contact_id: { type: "string" },
          company_id: { type: "string" },
          valid_until: { type: "string", description: "YYYY-MM-DD" },
          intro_text: { type: "string" },
          closing_text: { type: "string" },
          terms: { type: "object" },
          notes: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          discount_percent: { type: "number" },
          vat_percent: { type: "number" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_add_item",
      description:
        "Add a line item to a quote. Specify section for grouping (e.g. 'Betrieb (laufend)', 'Setup (einmalig)'). " +
        "Totals are auto-recalculated.",
      input_schema: {
        type: "object" as const,
        properties: {
          quote_id: { type: "string", description: "Quote UUID" },
          section: { type: "string", description: "Section heading for grouping items" },
          article: { type: "string", description: "Article code (e.g. 'KI-CLOUD')" },
          description: { type: "string", description: "Product/service name" },
          detail: { type: "string", description: "Longer description text" },
          cycle: { type: "string", description: "Billing cycle (e.g. 'p.m.', 'einmalig')" },
          quantity: { type: "number", description: "Quantity (default: 1)" },
          unit: { type: "string", description: "Unit label (default: 'Stück')" },
          unit_price: { type: "number", description: "Price per unit (Netto EUR)" },
          discount_percent: { type: "number", description: "Line item discount %" },
        },
        required: ["quote_id", "description", "unit_price"],
      },
    },
    {
      name: "quotes_update_item",
      description: "Update an existing line item. Totals are auto-recalculated.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Line item UUID" },
          section: { type: "string" },
          article: { type: "string" },
          description: { type: "string" },
          detail: { type: "string" },
          cycle: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unit_price: { type: "number" },
          discount_percent: { type: "number" },
          sort_order: { type: "number" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_remove_item",
      description: "Remove a line item from a quote. Totals are auto-recalculated.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Line item UUID" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_recalculate",
      description: "Recalculate quote totals from line items. Returns subtotal, discount, net, VAT, gross.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Quote UUID" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_generate_pdf",
      description: "Generate a professional PDF quote. Returns HTML preview URL and PDF download URL.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Quote UUID" },
        },
        required: ["id"],
      },
    },
  ];
}
