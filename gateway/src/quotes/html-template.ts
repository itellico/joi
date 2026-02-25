// Quote HTML template for preview and PDF generation
// Matches the itellico Angebot.docx corporate design

interface QuoteContact {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  emails: string[];
}

interface QuoteCompany {
  name: string | null;
  domain: string | null;
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

interface QuoteData {
  quote_number: string;
  title: string;
  issued_date: string;
  valid_until: string | null;
  status: string;
  sender_name: string;
  sender_company: string;
  sender_address: { street?: string; zip?: string; city?: string; country?: string };
  sender_phone: string;
  sender_email: string | null;
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

  // Joined
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_emails?: string[];
  contact_job_title?: string | null;
  company_name?: string | null;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(n: number): string {
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
  const contactName = [quote.contact_first_name, quote.contact_last_name].filter(Boolean).join(" ");
  const contactEmail = quote.contact_emails?.[0] || "";
  const addr = quote.sender_address || {};
  const sections = groupItemsBySection(items);

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
          <td class="right">${formatCurrency(item.quantity)}</td>
          <td class="center">${esc(item.unit)}</td>
          <td class="right">${formatCurrency(item.unit_price)}</td>
          <td class="center">${item.discount_percent > 0 ? `${formatCurrency(item.discount_percent)}%` : "-"}</td>
          <td class="right">${formatCurrency(item.line_total)}</td>
        </tr>`;
    }
  }

  // Build terms section
  const terms = quote.terms || {};
  let termsHtml = "";
  if (terms.conditions || terms.contract_duration || terms.payment || terms.delivery || terms.acceptance) {
    if (terms.conditions) {
      termsHtml += `<div class="terms-block"><h3>Vertragsbedingungen</h3><p>${esc(terms.conditions)}</p></div>`;
    }
    if (terms.delivery) {
      termsHtml += `<div class="terms-block"><h3>Zeitplan & Herstellungszeit</h3><p>${esc(terms.delivery)}</p></div>`;
    }
    if (terms.payment) {
      termsHtml += `<div class="terms-block"><h3>Zahlungsbedingungen</h3><p>${esc(terms.payment)}</p></div>`;
    }
    if (terms.contract_duration) {
      termsHtml += `<div class="terms-block"><h3>Vertragsdauer</h3><p>${esc(terms.contract_duration)}</p></div>`;
    }
    if (terms.acceptance) {
      termsHtml += `<div class="terms-block"><h3>Angebotsannahme</h3><p>${esc(terms.acceptance)}</p></div>`;
    }
  }

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
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #1a1a1a;
    }
    .sender-info {
      font-size: 9pt;
      color: #555;
      line-height: 1.6;
    }
    .sender-info .company-name {
      font-size: 14pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 4px;
    }
    .recipient {
      text-align: right;
      font-size: 9pt;
      color: #555;
    }

    .quote-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .quote-meta .quote-title {
      font-size: 16pt;
      font-weight: 700;
    }
    .quote-meta .meta-details {
      text-align: right;
      font-size: 9pt;
      color: #555;
      line-height: 1.8;
    }
    .meta-details strong { color: #1a1a1a; }

    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-draft { background: #fef3c7; color: #92400e; }
    .status-sent { background: #dbeafe; color: #1e40af; }
    .status-accepted { background: #d1fae5; color: #065f46; }
    .status-declined { background: #fee2e2; color: #991b1b; }
    .status-expired { background: #f3f4f6; color: #6b7280; }

    .intro { margin-bottom: 24px; font-size: 10pt; }

    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 9pt;
    }
    table.items th {
      background: #f8f9fa;
      border-bottom: 2px solid #1a1a1a;
      padding: 8px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    table.items td {
      padding: 8px 6px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    table.items .section-row td {
      padding-top: 16px;
      border-bottom: 1px solid #d1d5db;
      font-size: 10pt;
      background: transparent;
    }
    table.items .right { text-align: right; }
    table.items .center { text-align: center; }
    table.items .article { font-family: monospace; font-size: 8pt; color: #6b7280; }
    table.items .desc { min-width: 200px; }
    table.items .detail { font-size: 8pt; color: #6b7280; line-height: 1.4; }

    .totals {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 30px;
    }
    .totals table {
      border-collapse: collapse;
      font-size: 10pt;
      min-width: 280px;
    }
    .totals td {
      padding: 4px 12px;
    }
    .totals .label { text-align: right; color: #555; }
    .totals .value { text-align: right; font-weight: 500; }
    .totals .grand-total td {
      border-top: 2px solid #1a1a1a;
      font-weight: 700;
      font-size: 12pt;
      padding-top: 8px;
    }
    .totals .net-total td {
      border-top: 1px solid #d1d5db;
      font-weight: 600;
      padding-top: 6px;
    }

    .closing { margin-bottom: 24px; font-size: 10pt; }
    .signature {
      margin-top: 20px;
      margin-bottom: 30px;
    }
    .signature .name { font-weight: 600; }
    .signature .role { font-size: 9pt; color: #555; }

    .terms-block {
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .terms-block h3 {
      font-size: 10pt;
      font-weight: 600;
      margin-bottom: 4px;
      color: #1a1a1a;
    }
    .terms-block p {
      font-size: 9pt;
      color: #555;
      line-height: 1.6;
    }

    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 8pt;
      color: #9ca3af;
      text-align: center;
    }

    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="sender-info">
      <div class="company-name">${esc(quote.sender_company)}</div>
      ${addr.street ? `${esc(addr.street)}<br>` : ""}
      ${addr.zip || addr.city ? `${esc(addr.zip)} ${esc(addr.city)}<br>` : ""}
      ${quote.sender_phone ? `Tel: ${esc(quote.sender_phone)}<br>` : ""}
      ${quote.sender_email ? `${esc(quote.sender_email)}` : ""}
    </div>
    <div class="recipient">
      ${quote.company_name ? `<strong>${esc(quote.company_name)}</strong><br>` : ""}
      ${contactName ? `${esc(contactName)}<br>` : ""}
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
      <strong>Mitarbeiter:</strong> ${esc(quote.sender_name)}
    </div>
  </div>

  ${quote.intro_text ? `<div class="intro"><p>${esc(quote.intro_text)}</p></div>` : ""}

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
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr>
        <td class="label">Zwischensumme</td>
        <td class="value">${formatCurrency(quote.subtotal)} ${esc(quote.currency)}</td>
      </tr>
      ${quote.discount_percent > 0 ? `
      <tr>
        <td class="label">Rabatt (${formatCurrency(quote.discount_percent)}%)</td>
        <td class="value">-${formatCurrency(quote.discount_amount)} ${esc(quote.currency)}</td>
      </tr>` : ""}
      <tr class="net-total">
        <td class="label">Netto</td>
        <td class="value">${formatCurrency(quote.net_total)} ${esc(quote.currency)}</td>
      </tr>
      <tr>
        <td class="label">USt (${formatCurrency(quote.vat_percent)}%)</td>
        <td class="value">${formatCurrency(quote.vat_amount)} ${esc(quote.currency)}</td>
      </tr>
      <tr class="grand-total">
        <td class="label">Gesamt</td>
        <td class="value">${formatCurrency(quote.gross_total)} ${esc(quote.currency)}</td>
      </tr>
    </table>
  </div>

  ${quote.closing_text ? `
  <div class="closing"><p>${esc(quote.closing_text)}</p></div>
  <div class="signature">
    <p>Mit freundlichen Grüßen,</p>
    <p class="name">${esc(quote.sender_name)}</p>
    <p class="role">Geschäftsführer</p>
  </div>` : ""}

  ${termsHtml ? `<div class="terms">${termsHtml}</div>` : ""}

  <div class="footer">
    ${esc(quote.sender_company)} &middot; ${esc(addr.street)} &middot; ${esc(addr.zip)} ${esc(addr.city)}
  </div>

</body>
</html>`;
}
