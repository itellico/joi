// Quotes / Angebote — agent tool definitions and handlers
// Includes organization + template management tools

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
  const itemsResult = await query<{ total: string }>(
    "SELECT COALESCE(SUM(line_total), 0) AS total FROM quote_items WHERE quote_id = $1",
    [quoteId],
  );
  const subtotal = parseFloat(itemsResult.rows[0].total);

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

interface DefaultItem {
  section?: string; article?: string; description: string; detail?: string;
  cycle?: string; quantity?: number; unit?: string; unit_price: number;
  discount_percent?: number;
}

// ─── Tool handlers ───

export function getQuotesToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // ─── org_list ───
  handlers.set("org_list", async () => {
    const result = await query(
      `SELECT id, name, short_name, is_default, phone, email, website, uid_number,
              address, logo_url, created_at
       FROM organizations ORDER BY is_default DESC, name`,
    );
    return { organizations: result.rows };
  });

  // ─── org_get ───
  handlers.set("org_get", async (input) => {
    const { id } = input as { id: string };
    const result = await query("SELECT * FROM organizations WHERE id = $1", [id]);
    if (result.rows.length === 0) return { error: "Organization not found" };
    return { organization: result.rows[0] };
  });

  // ─── template_list ───
  handlers.set("template_list", async (input) => {
    const { organization_id } = input as { organization_id?: string };
    const conditions = ["is_active = true"];
    const params: unknown[] = [];
    let idx = 1;
    if (organization_id) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(organization_id);
    }
    const result = await query(
      `SELECT t.*, o.name AS org_name
       FROM quote_templates t
       JOIN organizations o ON o.id = t.organization_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.sort_order, t.name`,
      params,
    );
    return { templates: result.rows };
  });

  // ─── template_get ───
  handlers.set("template_get", async (input) => {
    const { id } = input as { id: string };
    const result = await query(
      `SELECT t.*, o.name AS org_name, o.short_name AS org_short_name
       FROM quote_templates t
       JOIN organizations o ON o.id = t.organization_id
       WHERE t.id = $1`,
      [id],
    );
    if (result.rows.length === 0) return { error: "Template not found" };
    return { template: result.rows[0] };
  });

  // ─── quotes_create ───
  handlers.set("quotes_create", async (input, ctx) => {
    const {
      title, contact_id, company_id, organization_id, template_id,
      prefix, valid_days, intro_text, closing_text, terms, notes, tags,
      vat_percent,
    } = input as {
      title: string;
      contact_id?: string; company_id?: string;
      organization_id?: string; template_id?: string;
      prefix?: string; valid_days?: number;
      intro_text?: string; closing_text?: string;
      terms?: Record<string, string>; notes?: string; tags?: string[];
      vat_percent?: number;
    };

    // Resolve organization
    let orgId = organization_id || null;
    if (!orgId) {
      const defaultOrg = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE is_default = true LIMIT 1",
      );
      if (defaultOrg.rows.length > 0) orgId = defaultOrg.rows[0].id;
    }

    // Load template defaults if provided
    let tplIntro = intro_text;
    let tplClosing = closing_text;
    let tplTerms = terms;
    let tplVat = vat_percent;
    let tplValidDays = valid_days;
    let defaultItems: DefaultItem[] = [];

    if (template_id) {
      const tpl = await query<Record<string, unknown>>(
        `SELECT t.*, o.default_intro_text, o.default_closing_text
         FROM quote_templates t
         LEFT JOIN organizations o ON o.id = t.organization_id
         WHERE t.id = $1`,
        [template_id],
      );
      if (tpl.rows.length > 0) {
        const t = tpl.rows[0];
        // Template fields override org defaults; explicit params override template
        if (!tplIntro) tplIntro = (t.intro_text as string) || (t.default_intro_text as string) || undefined;
        if (!tplClosing) tplClosing = (t.closing_text as string) || (t.default_closing_text as string) || undefined;
        if (!tplTerms) tplTerms = t.terms as Record<string, string>;
        if (tplVat === undefined) tplVat = Number(t.default_vat_percent) || 20;
        if (tplValidDays === undefined) tplValidDays = (t.default_valid_days as number) || 14;
        if (Array.isArray(t.default_items) && (t.default_items as unknown[]).length > 0) {
          defaultItems = t.default_items as DefaultItem[];
        }
        // Use template's org if not explicitly set
        if (!orgId) orgId = t.organization_id as string;
      }
    }

    // Resolve org short_name for prefix
    let resolvedPrefix = prefix;
    if (!resolvedPrefix && orgId) {
      const org = await query<{ short_name: string }>(
        "SELECT short_name FROM organizations WHERE id = $1", [orgId],
      );
      if (org.rows.length > 0 && org.rows[0].short_name) {
        resolvedPrefix = org.rows[0].short_name.toUpperCase();
      }
    }

    const quoteNumber = await nextQuoteNumber(resolvedPrefix);
    const finalValidDays = tplValidDays ?? 14;
    const validUntil = new Date(Date.now() + finalValidDays * 86400000).toISOString().slice(0, 10);

    const result = await query<{ id: string; quote_number: string; issued_date: string }>(
      `INSERT INTO quotes (
        quote_number, title, contact_id, company_id, organization_id, template_id,
        valid_until, intro_text, closing_text, terms, notes, tags,
        vat_percent, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id, quote_number, issued_date`,
      [
        quoteNumber, title, contact_id || null, company_id || null,
        orgId, template_id || null, validUntil,
        tplIntro || null, tplClosing || null,
        tplTerms ? JSON.stringify(tplTerms) : "{}",
        notes || null, tags || [],
        tplVat ?? 20,
        `agent:${ctx.agentId}`,
      ],
    );

    const quoteId = result.rows[0].id;

    // Insert default items from template
    for (let i = 0; i < defaultItems.length; i++) {
      const item = defaultItems[i];
      const qty = item.quantity ?? 1;
      const disc = item.discount_percent ?? 0;
      const lineTotal = qty * item.unit_price * (1 - disc / 100);

      await query(
        `INSERT INTO quote_items (
          quote_id, sort_order, section, article, description, detail, cycle,
          quantity, unit, unit_price, discount_percent, line_total
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          quoteId, i,
          item.section || null, item.article || null, item.description,
          item.detail || null, item.cycle || null,
          qty, item.unit || "Stück", item.unit_price, disc, lineTotal,
        ],
      );
    }

    // Recalculate totals if items were added
    if (defaultItems.length > 0) {
      await recalculateTotals(quoteId);
    }

    return {
      id: quoteId,
      quote_number: result.rows[0].quote_number,
      issued_date: result.rows[0].issued_date,
      valid_until: validUntil,
      items_added: defaultItems.length,
      message: `Quote ${quoteNumber} created${defaultItems.length > 0 ? ` with ${defaultItems.length} items from template` : ""}. ${defaultItems.length === 0 ? "Add line items with quotes_add_item." : "Review items and adjust as needed."}`,
    };
  });

  // ─── quotes_get ───
  handlers.set("quotes_get", async (input) => {
    const { id } = input as { id: string };
    const quoteResult = await query(
      `SELECT q.*,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.emails AS contact_emails, c.job_title AS contact_job_title,
              comp.name AS company_name, comp.domain AS company_domain,
              o.name AS org_name, o.logo_url AS org_logo_url, o.address AS org_address,
              o.phone AS org_phone, o.email AS org_email, o.uid_number AS org_uid,
              o.bank_name AS org_bank, o.iban AS org_iban, o.bic AS org_bic,
              o.legal_urls AS org_legal_urls,
              o.default_signature_name AS org_signature_name,
              o.default_signature_role AS org_signature_role
       FROM quotes q
       LEFT JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN companies comp ON comp.id = q.company_id
       LEFT JOIN organizations o ON o.id = q.organization_id
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
    const { status, contact_id, organization_id, limit, offset } = input as {
      status?: string; contact_id?: string; organization_id?: string;
      limit?: number; offset?: number;
    };

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) { conditions.push(`q.status = $${idx++}`); params.push(status); }
    if (contact_id) { conditions.push(`q.contact_id = $${idx++}`); params.push(contact_id); }
    if (organization_id) { conditions.push(`q.organization_id = $${idx++}`); params.push(organization_id); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(limit || 50, 200);
    const off = offset || 0;
    params.push(lim, off);

    const result = await query(
      `SELECT q.id, q.quote_number, q.title, q.status, q.net_total, q.gross_total,
              q.currency, q.issued_date, q.valid_until, q.tags, q.created_at,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              comp.name AS company_name, o.name AS org_name
       FROM quotes q
       LEFT JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN companies comp ON comp.id = q.company_id
       LEFT JOIN organizations o ON o.id = q.organization_id
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
      id, title, status, contact_id, company_id, organization_id,
      valid_until, intro_text, closing_text, terms, notes, tags,
      discount_percent, vat_percent,
    } = input as {
      id: string;
      title?: string; status?: string; contact_id?: string; company_id?: string;
      organization_id?: string; valid_until?: string;
      intro_text?: string; closing_text?: string;
      terms?: Record<string, string>; notes?: string; tags?: string[];
      discount_percent?: number; vat_percent?: number;
    };

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    const fields: Record<string, unknown> = {
      title, status, contact_id, company_id, organization_id,
      valid_until, intro_text, closing_text, notes, discount_percent, vat_percent,
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
      name: "org_list",
      description: "List all organizations (your own companies) with branding, address, and bank details.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "org_get",
      description: "Get full organization details including logo, bank info, legal URLs, and default texts.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Organization UUID" } },
        required: ["id"],
      },
    },
    {
      name: "template_list",
      description: "List available quote templates, optionally filtered by organization.",
      input_schema: {
        type: "object" as const,
        properties: {
          organization_id: { type: "string", description: "Filter by organization" },
        },
        required: [],
      },
    },
    {
      name: "template_get",
      description: "Get full template details including default items, terms, and display settings.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Template UUID" } },
        required: ["id"],
      },
    },
    {
      name: "quotes_create",
      description:
        "Create a new quote/offer (Angebot). Use template_id to auto-populate texts, terms, and line items. " +
        "Links to organization (sender), contact (recipient), and optionally a company.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Quote title (e.g. 'Sprach-KI Agent Cloud Service')" },
          contact_id: { type: "string", description: "Contact UUID (recipient)" },
          company_id: { type: "string", description: "Company UUID (recipient company)" },
          organization_id: { type: "string", description: "Organization UUID (sender, defaults to default org)" },
          template_id: { type: "string", description: "Template UUID — auto-fills texts, terms, and default items" },
          prefix: { type: "string", description: "Quote number prefix (auto-resolved from org short_name)" },
          valid_days: { type: "number", description: "Days until expiry (from template or default 14)" },
          intro_text: { type: "string", description: "Override intro text" },
          closing_text: { type: "string", description: "Override closing text" },
          terms: { type: "object", description: "Override terms: {payment, delivery, contract_duration, acceptance}" },
          notes: { type: "string", description: "Internal notes (not on quote)" },
          tags: { type: "array", items: { type: "string" } },
          vat_percent: { type: "number", description: "Override VAT % (from template or default 20)" },
        },
        required: ["title"],
      },
    },
    {
      name: "quotes_get",
      description: "Get full quote with items, contact, organization branding, and totals.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Quote UUID" } },
        required: ["id"],
      },
    },
    {
      name: "quotes_list",
      description: "List quotes with optional filters by status, contact, and organization.",
      input_schema: {
        type: "object" as const,
        properties: {
          status: { type: "string", enum: ["draft", "sent", "accepted", "declined", "expired"] },
          contact_id: { type: "string" },
          organization_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: [],
      },
    },
    {
      name: "quotes_update",
      description: "Update quote fields: title, status, dates, texts, terms, discount, VAT, organization.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Quote UUID" },
          title: { type: "string" },
          status: { type: "string", enum: ["draft", "sent", "accepted", "declined", "expired"] },
          contact_id: { type: "string" },
          company_id: { type: "string" },
          organization_id: { type: "string" },
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
      description: "Add a line item to a quote. Auto-recalculates totals.",
      input_schema: {
        type: "object" as const,
        properties: {
          quote_id: { type: "string", description: "Quote UUID" },
          section: { type: "string", description: "Section heading (e.g. 'Betrieb (laufend)')" },
          article: { type: "string", description: "Article code (e.g. 'KI-CLOUD')" },
          description: { type: "string", description: "Product/service name" },
          detail: { type: "string", description: "Longer description" },
          cycle: { type: "string", description: "Billing cycle (e.g. 'p.m.', 'einmalig')" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unit_price: { type: "number", description: "Netto price per unit" },
          discount_percent: { type: "number" },
        },
        required: ["quote_id", "description", "unit_price"],
      },
    },
    {
      name: "quotes_update_item",
      description: "Update a line item. Auto-recalculates totals.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string" },
          section: { type: "string" }, article: { type: "string" },
          description: { type: "string" }, detail: { type: "string" },
          cycle: { type: "string" }, quantity: { type: "number" },
          unit: { type: "string" }, unit_price: { type: "number" },
          discount_percent: { type: "number" }, sort_order: { type: "number" },
        },
        required: ["id"],
      },
    },
    {
      name: "quotes_remove_item",
      description: "Remove a line item. Auto-recalculates totals.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "quotes_recalculate",
      description: "Recalculate totals. Returns subtotal, discount, net, VAT, gross.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "quotes_generate_pdf",
      description: "Get HTML preview + PDF download URLs for a quote.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];
}
