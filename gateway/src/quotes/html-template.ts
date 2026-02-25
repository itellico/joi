// Quote HTML template for preview and PDF generation
// Uses organization branding (logo, colors, bank details, legal URLs)

interface QuoteData {
  quote_number: string;
  title: string;
  issued_date: string;
  valid_until: string | null;
  status: string;
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

  // Organization (sender) - joined
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

  // Legacy sender fields (fallback if no org)
  sender_name?: string;
  sender_company?: string;
  sender_address?: { street?: string; zip?: string; city?: string; country?: string };
  sender_phone?: string;
  sender_email?: string | null;

  // Contact (recipient) - joined
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

function fmtNum(n: number): string {
  return n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

  // Build items HTML
  let itemsHtml = "";
  for (const [section, sectionItems] of sections) {
    if (section) {
      itemsHtml += `
        <tr class="section-row">
          <td colspan="8"><strong>${esc(section)}</strong></td>
        </tr>`;
    }
    for (const item of sectionItems) {
      itemsHtml += `
        <tr>
          <td class="article">${esc(item.article)}</td>
          <td class="desc">
            <strong>${esc(item.description)}</strong>
            ${item.detail ? `<br><span class="detail">${esc(item.detail)}</span>` : ""}
          </td>
          <td class="center">${esc(item.cycle)}</td>
          <td class="right">${fmtNum(item.quantity)}</td>
          <td class="center">${esc(item.unit)}</td>
          <td class="right">${fmtNum(item.unit_price)}</td>
          <td class="center">${item.discount_percent > 0 ? `${fmtNum(item.discount_percent)}%` : "-"}</td>
          <td class="right">${fmtNum(item.line_total)}</td>
        </tr>`;
    }
  }

  // Build terms
  const terms = quote.terms || {};
  let termsHtml = "";
  const termSections: [string, string][] = [
    ["conditions", "Vertragsbedingungen"],
    ["delivery", "Zeitplan & Herstellungszeit"],
    ["payment", "Zahlungsbedingungen"],
    ["contract_duration", "Vertragsdauer"],
    ["acceptance", "Angebotsannahme"],
  ];
  for (const [key, label] of termSections) {
    if (terms[key]) {
      let content = esc(terms[key]);
      // Append legal URL references in acceptance section
      if (key === "acceptance") {
        if (legalUrls.agb) content += `<br>AGB: <a href="${esc(legalUrls.agb)}">${esc(legalUrls.agb)}</a>`;
        if (legalUrls.verrechnungssaetze) content += `<br>Verrechnungssätze: <a href="${esc(legalUrls.verrechnungssaetze)}">${esc(legalUrls.verrechnungssaetze)}</a>`;
        if (legalUrls.avv) content += `<br>AVV: <a href="${esc(legalUrls.avv)}">${esc(legalUrls.avv)}</a>`;
      }
      termsHtml += `<div class="terms-block"><h3>${label}</h3><p>${content}</p></div>`;
    }
  }

  // Acceptance signature block
  const acceptanceHtml = terms.acceptance ? `
    <div class="acceptance">
      <div class="sig-line">
        <div><span class="sig-blank"></span></div>
        <div>am <span class="sig-blank-sm"></span></div>
      </div>
      <div class="sig-labels"><span>Ort</span><span>Datum</span></div>
      <div class="sig-line" style="margin-top:24px">
        <div><span class="sig-blank-lg"></span></div>
      </div>
      <div class="sig-labels"><span>Unterschrift — Auftraggeber</span></div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Angebot ${esc(quote.quote_number)}</title>
  <style>
    @page { size: A4; margin: 20mm 25mm 25mm 25mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: #fff;
      padding: 40px;
      max-width: 210mm;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #1a1a1a;
    }
    .sender-info { font-size: 9pt; color: #555; line-height: 1.6; }
    .sender-info .company-name { font-size: 14pt; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .sender-logo { max-height: 48px; max-width: 180px; margin-bottom: 8px; display: block; }
    .recipient { text-align: right; font-size: 9pt; color: #555; }

    .quote-meta { display: flex; justify-content: space-between; margin-bottom: 24px; }
    .quote-meta .quote-title { font-size: 16pt; font-weight: 700; }
    .quote-meta .meta-details { text-align: right; font-size: 9pt; color: #555; line-height: 1.8; }
    .meta-details strong { color: #1a1a1a; }

    .status-badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-draft { background: #fef3c7; color: #92400e; }
    .status-sent { background: #dbeafe; color: #1e40af; }
    .status-accepted { background: #d1fae5; color: #065f46; }
    .status-declined { background: #fee2e2; color: #991b1b; }
    .status-expired { background: #f3f4f6; color: #6b7280; }

    .intro { margin-bottom: 24px; font-size: 10pt; }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 9pt; }
    table.items th { background: #f8f9fa; border-bottom: 2px solid #1a1a1a; padding: 8px 6px; text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.3px; }
    table.items td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    table.items .section-row td { padding-top: 16px; border-bottom: 1px solid #d1d5db; font-size: 10pt; }
    table.items .right { text-align: right; }
    table.items .center { text-align: center; }
    table.items .article { font-family: monospace; font-size: 8pt; color: #6b7280; }
    table.items .desc { min-width: 200px; }
    table.items .detail { font-size: 8pt; color: #6b7280; line-height: 1.4; }

    .totals { display: flex; justify-content: flex-end; margin-bottom: 30px; }
    .totals table { border-collapse: collapse; font-size: 10pt; min-width: 280px; }
    .totals td { padding: 4px 12px; }
    .totals .label { text-align: right; color: #555; }
    .totals .value { text-align: right; font-weight: 500; font-family: monospace; }
    .totals .net-total td { border-top: 1px solid #d1d5db; font-weight: 600; padding-top: 6px; }
    .totals .grand-total td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 12pt; padding-top: 8px; }

    .closing { margin-bottom: 24px; }
    .signature { margin-top: 20px; margin-bottom: 30px; }
    .signature .name { font-weight: 600; }
    .signature .role { font-size: 9pt; color: #555; }

    .terms-block { margin-bottom: 16px; page-break-inside: avoid; }
    .terms-block h3 { font-size: 10pt; font-weight: 600; margin-bottom: 4px; }
    .terms-block p { font-size: 9pt; color: #555; line-height: 1.6; }
    .terms-block a { color: #3b82f6; text-decoration: none; }

    .acceptance { margin-top: 30px; page-break-inside: avoid; }
    .sig-line { display: flex; gap: 20px; margin-top: 40px; }
    .sig-blank { display: inline-block; width: 200px; border-bottom: 1px solid #1a1a1a; }
    .sig-blank-sm { display: inline-block; width: 150px; border-bottom: 1px solid #1a1a1a; }
    .sig-blank-lg { display: inline-block; width: 300px; border-bottom: 1px solid #1a1a1a; }
    .sig-labels { display: flex; gap: 20px; font-size: 8pt; color: #6b7280; margin-top: 4px; }
    .sig-labels span { min-width: 150px; }

    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af; text-align: center; line-height: 1.6; }

    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <!-- Print button (hidden on print) -->
  <div class="no-print" style="position:fixed;top:16px;right:16px;z-index:100;display:flex;gap:8px">
    <button onclick="window.print()" style="padding:8px 20px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;font-weight:500">Drucken / PDF</button>
  </div>

  <div class="header">
    <div class="sender-info">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" class="sender-logo">` : ""}
      <div class="company-name">${esc(senderName)}</div>
      ${senderAddr.street ? `${esc(senderAddr.street)}<br>` : ""}
      ${senderAddr.zip || senderAddr.city ? `${esc(senderAddr.zip)} ${esc(senderAddr.city)}<br>` : ""}
      ${senderPhone ? `Tel: ${esc(senderPhone)}<br>` : ""}
      ${senderEmail ? `${esc(senderEmail)}<br>` : ""}
      ${uid ? `UID: ${esc(uid)}` : ""}
    </div>
    <div class="recipient">
      ${quote.company_name ? `<strong>${esc(quote.company_name)}</strong><br>` : ""}
      ${contactName ? `${esc(contactName)}<br>` : ""}
      ${quote.contact_job_title ? `${esc(quote.contact_job_title)}<br>` : ""}
      ${contactEmail ? `${esc(contactEmail)}` : ""}
    </div>
  </div>

  <div class="quote-meta">
    <div>
      <div class="quote-title">Angebot ${esc(quote.quote_number)}</div>
      <span class="status-badge status-${quote.status}">${esc(quote.status)}</span>
    </div>
    <div class="meta-details">
      <strong>Erstellt:</strong> ${formatDate(quote.issued_date)}<br>
      ${quote.valid_until ? `<strong>Gültig bis:</strong> ${formatDate(quote.valid_until)}<br>` : ""}
      <strong>Mitarbeiter:</strong> ${esc(sigName)}
    </div>
  </div>

  ${quote.intro_text ? `
  <div class="intro">
    <p>Sehr geehrte Damen und Herren!</p>
    <p style="margin-top:8px">${esc(quote.intro_text)}</p>
  </div>` : ""}

  <table class="items">
    <thead>
      <tr>
        <th>Artikel</th>
        <th>Lösung</th>
        <th>Zyklus</th>
        <th class="right">#</th>
        <th class="center">Unit</th>
        <th class="right">Netto</th>
        <th class="center">%</th>
        <th class="right">Summe</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr>
        <td class="label">Zwischensumme</td>
        <td class="value">${fmtNum(quote.subtotal)} ${esc(quote.currency)}</td>
      </tr>
      ${quote.discount_percent > 0 ? `
      <tr>
        <td class="label">Rabatt (${fmtNum(quote.discount_percent)}%)</td>
        <td class="value">-${fmtNum(quote.discount_amount)} ${esc(quote.currency)}</td>
      </tr>` : ""}
      <tr class="net-total">
        <td class="label">Netto</td>
        <td class="value">${fmtNum(quote.net_total)} ${esc(quote.currency)}</td>
      </tr>
      <tr>
        <td class="label">USt (${fmtNum(quote.vat_percent)}%)</td>
        <td class="value">${fmtNum(quote.vat_amount)} ${esc(quote.currency)}</td>
      </tr>
      <tr class="grand-total">
        <td class="label">Gesamt</td>
        <td class="value">${fmtNum(quote.gross_total)} ${esc(quote.currency)}</td>
      </tr>
    </table>
  </div>

  ${quote.closing_text ? `
  <div class="closing"><p>${esc(quote.closing_text)}</p></div>
  <div class="signature">
    <p>Mit freundlichen Grüßen,</p>
    <p class="name">${esc(sigName)}</p>
    <p class="role">${esc(sigRole)}</p>
  </div>` : ""}

  ${termsHtml ? `<div class="terms">${termsHtml}</div>` : ""}
  ${acceptanceHtml}

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
