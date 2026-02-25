// Quote HTML template — matches itellico Angebot.docx corporate design
// Renders from content JSONB for full editability

interface QuoteContent {
  salutation?: string;
  intro?: string;
  service_description?: string;
  closing?: string;
  greeting?: string;
  items_summary_label?: string;
  terms_conditions?: string;
  terms_delivery?: string;
  terms_payment?: string;
  terms_contract_duration?: string;
  terms_acceptance?: string;
  show_acceptance_signature?: boolean;
  show_customer_form?: boolean;
  show_sepa?: boolean;
  sepa_text?: string;
}

interface QuoteData {
  quote_number: string;
  title: string;
  issued_date: string;
  valid_until: string | null;
  status: string;
  content: QuoteContent;
  // Legacy fields (fallback)
  intro_text: string | null;
  closing_text: string | null;
  terms: Record<string, string>;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  net_total: number;
  vat_percent: number;
  vat_amount: number;
  gross_total: number;
  currency: string;

  // Organization (sender)
  org_name?: string | null;
  org_logo_url?: string | null;
  org_address?: { street?: string; zip?: string; city?: string; country?: string } | null;
  org_phone?: string | null;
  org_email?: string | null;
  org_uid?: string | null;
  org_bank?: string | null;
  org_iban?: string | null;
  org_bic?: string | null;
  org_legal_urls?: Record<string, string> | null;
  org_signature_name?: string | null;
  org_signature_role?: string | null;

  // Legacy sender
  sender_name?: string;
  sender_company?: string;
  sender_address?: { street?: string; zip?: string; city?: string; country?: string };
  sender_phone?: string;
  sender_email?: string | null;

  // Contact (recipient)
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_emails?: string[];
  contact_job_title?: string | null;
  company_name?: string | null;
}

interface QuoteItem {
  section: string | null;
  article: string | null;
  description: string;
  detail: string | null;
  cycle: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  line_total: number;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmt(n: number): string {
  return n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number): string {
  if (n === Math.floor(n)) return n.toFixed(0);
  return fmt(n);
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}

function groupItemsBySection(items: QuoteItem[]): Map<string, QuoteItem[]> {
  const groups = new Map<string, QuoteItem[]>();
  for (const item of items) {
    const key = item.section || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return groups;
}

export function renderQuoteHtml(quote: QuoteData, items: QuoteItem[]): string {
  const c: QuoteContent = (quote.content && typeof quote.content === "object") ? quote.content : {};

  // Resolve sender from organization or legacy fields
  const senderName = quote.org_name || quote.sender_company || "";
  const senderAddr = quote.org_address || quote.sender_address || {};
  const senderPhone = quote.org_phone || quote.sender_phone || "";
  const senderEmail = quote.org_email || quote.sender_email || "";
  const sigName = quote.org_signature_name || quote.sender_name || "";
  const sigRole = quote.org_signature_role || "Geschäftsführer";
  const logoUrl = quote.org_logo_url || "";
  const uid = quote.org_uid || "";
  const legalUrls = quote.org_legal_urls || {};

  const contactName = [quote.contact_first_name, quote.contact_last_name].filter(Boolean).join(" ");
  const contactEmail = quote.contact_emails?.[0] || "";
  const sections = groupItemsBySection(items);

  // Resolve content — prefer content JSONB, fall back to legacy fields
  const salutation = c.salutation || "Sehr geehrte Damen und Herren!";
  const intro = c.intro || quote.intro_text || "";
  const serviceDesc = c.service_description || "";
  const closing = c.closing || quote.closing_text || "";
  const greeting = c.greeting || "Mit freundlichen Grüßen,";
  const summaryLabel = c.items_summary_label || "SUMME NETTO";
  const termsConditions = c.terms_conditions || quote.terms?.conditions || "";
  const termsDelivery = c.terms_delivery || quote.terms?.delivery || "";
  const termsPayment = c.terms_payment || quote.terms?.payment || "";
  const termsContractDuration = c.terms_contract_duration || quote.terms?.contract_duration || "";
  const termsAcceptance = c.terms_acceptance || quote.terms?.acceptance || "";
  const showAcceptance = c.show_acceptance_signature !== false;
  const showCustomerForm = c.show_customer_form === true;
  const showSepa = c.show_sepa === true;
  const sepaText = c.sepa_text || "";

  // Build items table
  let itemsHtml = "";
  for (const [section, sectionItems] of sections) {
    if (section) {
      itemsHtml += `
        <tr class="section-header">
          <td colspan="8">${esc(section)}</td>
        </tr>`;
    }
    for (const item of sectionItems) {
      itemsHtml += `
        <tr>
          <td class="col-article">${esc(item.article)}</td>
          <td class="col-desc">
            <strong>${esc(item.description)}</strong>
            ${item.detail ? `<br><span class="detail">${nl2br(item.detail)}</span>` : ""}
          </td>
          <td class="col-center">${esc(item.cycle)}</td>
          <td class="col-right">${fmtInt(item.quantity)}</td>
          <td class="col-center">${esc(item.unit)}</td>
          <td class="col-right">${fmt(item.unit_price)}.-</td>
          <td class="col-center">${item.discount_percent > 0 ? `${fmt(item.discount_percent)}%` : "-"}</td>
          <td class="col-right">${fmt(item.line_total)}.-</td>
        </tr>`;
    }
  }

  // Terms sections
  const termsList: [string, string, string][] = [
    ["conditions", "Vertragsbedingungen", termsConditions],
    ["delivery", "Zeitplan & Herstellungszeit", termsDelivery],
    ["payment", "Zahlungsbedingungen", termsPayment],
    ["contract_duration", "Vertragsdauer", termsContractDuration],
    ["acceptance", "Angebotsannahme", termsAcceptance],
  ];

  let termsHtml = "";
  for (const [key, label, text] of termsList) {
    if (!text) continue;
    let content = nl2br(text);
    // Append legal URL references in acceptance section
    if (key === "acceptance") {
      if (legalUrls.agb) content += `<br>AGB: <a href="${esc(legalUrls.agb)}">${esc(legalUrls.agb)}</a>`;
      if (legalUrls.verrechnungssaetze) content += `<br>Verrechnungssätze: <a href="${esc(legalUrls.verrechnungssaetze)}">${esc(legalUrls.verrechnungssaetze)}</a>`;
      if (legalUrls.avv) content += `<br>AVV: <a href="${esc(legalUrls.avv)}">${esc(legalUrls.avv)}</a>`;
    }
    termsHtml += `
      <div class="terms-section">
        <h3>${esc(label)}</h3>
        <p>${content}</p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Angebot ${esc(quote.quote_number)}</title>
  <style>
    @page { size: A4; margin: 18mm 22mm 20mm 22mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 9.5pt;
      line-height: 1.55;
      color: #222;
      background: #fff;
      max-width: 210mm;
      margin: 0 auto;
      padding: 36px 40px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .sender { font-size: 9pt; color: #444; line-height: 1.7; }
    .sender .org-name { font-size: 13pt; font-weight: 700; color: #222; letter-spacing: -0.2px; }
    .sender-logo { max-height: 44px; max-width: 180px; margin-bottom: 6px; display: block; }
    .recipient { text-align: right; font-size: 9pt; color: #444; line-height: 1.7; }
    .recipient strong { color: #222; }

    /* ── Quote meta ── */
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }
    .quote-title { font-size: 14pt; font-weight: 700; color: #222; }
    .meta-details { text-align: right; font-size: 8.5pt; color: #555; line-height: 1.9; }
    .meta-details strong { color: #222; }
    .phone-label { font-size: 8.5pt; color: #555; margin-bottom: 2px; }

    /* ── Divider ── */
    .divider { border: none; border-top: 1.5px solid #222; margin: 12px 0 18px 0; }

    /* ── Content blocks ── */
    .salutation { font-weight: 600; margin-bottom: 10px; }
    .intro-block { margin-bottom: 16px; line-height: 1.65; }
    .intro-block p { margin-bottom: 8px; }

    .closing-block { margin-bottom: 6px; line-height: 1.65; }
    .signature { margin-top: 14px; margin-bottom: 28px; }
    .sig-name { font-weight: 600; }
    .sig-role { font-size: 9pt; color: #555; }

    /* ── Items table ── */
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 9pt; }
    table.items th {
      border-bottom: 1.5px solid #222;
      padding: 7px 5px;
      text-align: left;
      font-weight: 700;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #222;
    }
    table.items td { padding: 7px 5px; border-bottom: 1px solid #ddd; vertical-align: top; }
    table.items .section-header td {
      padding: 14px 5px 6px 0;
      font-weight: 700;
      font-size: 9.5pt;
      border-bottom: 1px solid #bbb;
      color: #222;
    }
    table.items .col-article { font-family: 'Courier New', monospace; font-size: 8pt; color: #666; white-space: nowrap; }
    table.items .col-desc { min-width: 180px; }
    table.items .col-desc .detail { font-size: 8pt; color: #666; line-height: 1.45; }
    table.items .col-right { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }
    table.items .col-center { text-align: center; }
    table.items th.r { text-align: right; }
    table.items th.c { text-align: center; }

    /* ── Summary row ── */
    .items-summary {
      display: flex;
      justify-content: flex-end;
      padding: 8px 0;
      margin-bottom: 24px;
      border-top: 1.5px solid #222;
      font-weight: 700;
      font-size: 10pt;
    }
    .items-summary span { margin-left: 24px; font-family: 'Courier New', monospace; }

    /* ── Terms ── */
    .terms-section { margin-bottom: 14px; page-break-inside: avoid; }
    .terms-section h3 { font-size: 9.5pt; font-weight: 700; margin-bottom: 3px; }
    .terms-section p { font-size: 8.5pt; color: #444; line-height: 1.6; }
    .terms-section a { color: #2563eb; text-decoration: none; }

    /* ── Acceptance signature ── */
    .acceptance-block { margin-top: 26px; page-break-inside: avoid; }
    .sig-row { display: flex; gap: 16px; margin-top: 36px; }
    .sig-line { display: inline-block; border-bottom: 1px solid #222; }
    .sig-label-row { display: flex; gap: 16px; font-size: 7.5pt; color: #666; margin-top: 3px; }
    .sig-label-row span { min-width: 120px; }

    /* ── Customer form ── */
    .customer-form { margin-top: 28px; page-break-inside: avoid; }
    .customer-form h3 { font-size: 10pt; font-weight: 700; margin-bottom: 10px; }
    .form-row { margin-bottom: 6px; }
    .form-line { display: block; width: 100%; border-bottom: 1px solid #999; height: 22px; }
    .form-label { font-size: 7.5pt; color: #666; margin-top: 1px; }

    /* ── SEPA ── */
    .sepa-block { margin-top: 28px; page-break-inside: avoid; }
    .sepa-block h3 { font-size: 10pt; font-weight: 700; margin-bottom: 10px; }
    .sepa-text { font-size: 8.5pt; color: #444; line-height: 1.6; margin-bottom: 16px; }
    .sepa-fields { margin-bottom: 16px; }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 10px;
      border-top: 1px solid #ddd;
      font-size: 7.5pt;
      color: #999;
      text-align: center;
      line-height: 1.7;
    }

    /* ── Print ── */
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    .no-print button {
      padding: 8px 20px;
      border: 1px solid #ccc;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .no-print button:hover { background: #f5f5f5; }
  </style>
</head>
<body>

  <div class="no-print" style="position:fixed;top:16px;right:16px;z-index:100;display:flex;gap:8px">
    <button onclick="window.print()">Drucken / PDF</button>
  </div>

  <!-- Header -->
  <div class="header">
    <div class="sender">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" class="sender-logo">` : ""}
      <div class="org-name">${esc(senderName)}</div>
      ${senderAddr.street ? `${esc(senderAddr.street)}<br>` : ""}
      ${senderAddr.zip || senderAddr.city ? `${esc(senderAddr.zip)} ${esc(senderAddr.city)}<br>` : ""}
      ${contactEmail ? `${esc(contactEmail)}` : ""}
    </div>
    <div class="recipient">
      ${quote.company_name ? `<strong>${esc(quote.company_name)}</strong><br>` : ""}
      ${contactName ? `${esc(contactName)}<br>` : ""}
      ${quote.contact_job_title ? `${esc(quote.contact_job_title)}<br>` : ""}
      ${contactEmail ? `${esc(contactEmail)}` : ""}
    </div>
  </div>

  <!-- Quote meta -->
  <div class="meta-row">
    <div class="quote-title">Angebot #${esc(quote.quote_number)}</div>
    <div class="meta-details">
      <strong>Erstellt:</strong> ${formatDate(quote.issued_date)}<br>
      ${quote.valid_until ? `<strong>Gültig bis:</strong> ${formatDate(quote.valid_until)}<br>` : ""}
      <strong>Mitarbeiter:</strong> ${esc(sigName)}
    </div>
  </div>
  ${senderPhone ? `<div class="phone-label">Telefon:${esc(senderPhone)}</div>` : ""}

  <hr class="divider">

  <!-- Salutation + Intro -->
  ${intro || serviceDesc ? `
  <div class="intro-block">
    <p class="salutation">${esc(salutation)}</p>
    ${intro ? `<p>${nl2br(intro)}</p>` : ""}
    ${serviceDesc ? `<p>${nl2br(serviceDesc)}</p>` : ""}
  </div>` : ""}

  <!-- Closing + Signature (before items, matching docx layout) -->
  ${closing ? `
  <div class="closing-block">
    <p>${nl2br(closing)}</p>
  </div>
  <div class="signature">
    <p>${esc(greeting)}</p>
    <p class="sig-name">${esc(sigName)}</p>
    <p class="sig-role">${esc(sigRole)}</p>
  </div>` : ""}

  <!-- Items table -->
  <table class="items">
    <thead>
      <tr>
        <th>Artikel</th>
        <th>Lösung</th>
        <th class="c">Zyklus</th>
        <th class="r">#</th>
        <th class="c">Unit</th>
        <th class="r">Netto</th>
        <th class="c">%</th>
        <th class="r">Summe</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="items-summary">
    ${esc(summaryLabel)}: <span>${fmt(quote.net_total)}.-</span>
  </div>

  <!-- Terms -->
  ${termsHtml ? `<div class="terms">${termsHtml}</div>` : ""}

  <!-- Acceptance signature -->
  ${showAcceptance && termsAcceptance ? `
  <div class="acceptance-block">
    <div class="sig-row">
      <div><span class="sig-line" style="width:200px"></span></div>
      <div>,am <span class="sig-line" style="width:160px"></span></div>
    </div>
    <div class="sig-label-row"><span>Ort</span><span>Datum</span></div>
    <div class="sig-row" style="margin-top:20px">
      <div><span class="sig-line" style="width:320px"></span></div>
    </div>
    <div class="sig-label-row"><span>Unterschrift - Auftraggeber</span></div>
  </div>` : ""}

  <!-- Customer data form -->
  ${showCustomerForm ? `
  <div class="customer-form">
    <h3>Kundendaten</h3>
    ${["Kundennummer (Falls vorhanden)", "Firma: (bitte vollständig angeben z.B. ABC GmbH)", "Nachname, Vorname", "Straße, Hausnummer", "Postleitzahl, Ort", "Telefon (mit Vorwahl)", "E-Mail", "UID Nummer"]
      .map(label => `<div class="form-row"><span class="form-line"></span><div class="form-label">${esc(label)}</div></div>`)
      .join("\n    ")}
  </div>` : ""}

  <!-- SEPA Einzugsermächtigung -->
  ${showSepa && sepaText ? `
  <div class="sepa-block">
    <h3>Einzugsermächtigung</h3>
    <div class="sepa-fields">
      <div class="form-row">
        <span class="form-line" style="width:60%"></span><span class="form-line" style="width:38%;margin-left:2%"></span>
        <div class="form-label" style="display:flex;justify-content:space-between"><span>Kontoinhaber</span><span>Konto lautet auf</span></div>
      </div>
      <div class="form-row">
        <span class="form-line" style="width:40%"></span><span class="form-line" style="width:25%;margin-left:2%"></span><span class="form-line" style="width:30%;margin-left:3%"></span>
        <div class="form-label" style="display:flex;justify-content:space-between"><span>IBAN</span><span>BIC</span><span>Bank</span></div>
      </div>
    </div>
    <div class="sepa-text">${nl2br(sepaText)}</div>
    <div class="sig-row">
      <div><span class="sig-line" style="width:200px"></span></div>
      <div>,am <span class="sig-line" style="width:160px"></span></div>
    </div>
    <div class="sig-label-row"><span>Ort</span><span>Datum</span></div>
    <div class="sig-row" style="margin-top:20px">
      <div><span class="sig-line" style="width:320px"></span></div>
    </div>
    <div class="sig-label-row"><span>Unterschrift - Auftraggeber</span></div>
  </div>` : ""}

  <!-- Footer -->
  <div class="footer">
    ${esc(senderName)}
    ${senderAddr.street ? ` &middot; ${esc(senderAddr.street)}` : ""}
    ${senderAddr.zip || senderAddr.city ? ` &middot; ${esc(senderAddr.zip)} ${esc(senderAddr.city)}` : ""}
    ${uid ? ` &middot; UID: ${esc(uid)}` : ""}
    ${quote.org_iban ? `<br>Bank: ${esc(quote.org_bank)} &middot; IBAN: ${esc(quote.org_iban)} &middot; BIC: ${esc(quote.org_bic)}` : ""}
  </div>

</body>
</html>`;
}
