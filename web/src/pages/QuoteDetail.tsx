import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, MetaText, Modal, PageBody, PageHeader } from "../components/ui";

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

interface Quote {
  id: string;
  quote_number: string;
  title: string;
  contact_id: string | null;
  company_id: string | null;
  organization_id: string | null;
  issued_date: string;
  valid_until: string | null;
  status: string;
  sender_name: string;
  sender_email: string | null;
  intro_text: string | null;
  closing_text: string | null;
  terms: Record<string, string>;
  content: QuoteContent;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  net_total: number;
  vat_percent: number;
  vat_amount: number;
  gross_total: number;
  currency: string;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_emails: string[] | null;
  contact_job_title: string | null;
  company_name: string | null;
  org_name: string | null;
  org_signature_name: string | null;
  org_signature_role: string | null;
}

interface QuoteItem {
  id: string;
  quote_id: string;
  sort_order: number;
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

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  emails: string[];
  company_name: string | null;
  company_id: string | null;
  job_title: string | null;
}

const STATUS_OPTIONS = ["draft", "sent", "accepted", "declined", "expired"] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: "var(--warning)", sent: "var(--accent)", accepted: "var(--success)",
  declined: "var(--error)", expired: "var(--text-muted)",
};

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(n: number | null, currency = "EUR"): string {
  if (n === null || n === undefined) return "-";
  return `${n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// ── Inline editable text block ──
function EditableBlock({ value, onChange, label, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; label: string; rows?: number; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => { setDraft(value); setEditing(true); };
  const save = () => { onChange(draft); setEditing(false); };
  const cancel = () => setEditing(false);

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  if (editing) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={rows}
          className="form-input"
          style={{ width: "100%", fontSize: "0.9rem", lineHeight: 1.6 }}
          placeholder={placeholder}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <Button variant="primary" onClick={save} style={{ fontSize: "0.75rem", padding: "3px 10px" }}>Save</Button>
          <Button variant="ghost" onClick={cancel} style={{ fontSize: "0.75rem", padding: "3px 10px" }}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (!value && !placeholder) return null;

  return (
    <div
      onClick={startEdit}
      style={{ marginBottom: 12, cursor: "pointer", padding: "6px 8px", borderRadius: 6, transition: "background 0.15s" }}
      onMouseEnter={(e) => { (e.currentTarget).style.background = "var(--bg-secondary)"; }}
      onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}
      title={`Click to edit ${label}`}
    >
      <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      {value ? (
        <div style={{ fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{value}</div>
      ) : (
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>{placeholder}</div>
      )}
    </div>
  );
}

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newItem, setNewItem] = useState({
    section: "", article: "", description: "", detail: "", cycle: "p.m.",
    quantity: 1, unit: "Stück", unit_price: 0, discount_percent: 0,
  });

  // Contact picker
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const contactSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchQuote = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/quotes/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setQuote(data.quote || null);
        setItems(data.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchQuote(); }, [fetchQuote]);

  // ── Helpers ──

  const updateQuote = async (fields: Record<string, unknown>) => {
    if (!id) return;
    await fetch(`/api/quotes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    fetchQuote();
  };

  const updateContent = (key: string, value: string | boolean) => {
    if (!quote) return;
    const newContent = { ...(quote.content || {}), [key]: value };
    updateQuote({ content: newContent });
  };

  const handleStatusChange = (s: string) => updateQuote({ status: s });

  const handleAddItem = async () => {
    if (!id) return;
    await fetch(`/api/quotes/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newItem),
    });
    setShowAddItem(false);
    setNewItem({ section: "", article: "", description: "", detail: "", cycle: "p.m.", quantity: 1, unit: "Stück", unit_price: 0, discount_percent: 0 });
    fetchQuote();
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!id) return;
    await fetch(`/api/quotes/${id}/items/${itemId}`, { method: "DELETE" });
    fetchQuote();
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this quote?")) return;
    await fetch(`/api/quotes/${id}`, { method: "DELETE" });
    navigate("/quotes");
  };

  const handleClone = async () => {
    if (!id) return;
    const res = await fetch(`/api/quotes/${id}/clone`, { method: "POST" });
    const data = await res.json();
    if (data.id) navigate(`/quotes/${data.id}`);
  };

  const searchContacts = (q: string) => {
    setContactSearch(q);
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current);
    if (!q.trim()) { setContactResults([]); return; }
    contactSearchTimer.current = setTimeout(() => {
      fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=8`)
        .then((r) => r.json())
        .then((data) => setContactResults(data.contacts || []))
        .catch(() => {});
    }, 200);
  };

  const assignContact = async (contact: Contact | null) => {
    if (!id) return;
    await updateQuote({
      contact_id: contact?.id || null,
      company_id: contact?.company_id || null,
    });
    setShowContactPicker(false);
    setContactSearch("");
    setContactResults([]);
  };

  if (loading) return <PageBody><EmptyState message="Loading..." /></PageBody>;
  if (!quote) return <PageBody><EmptyState message="Quote not found." /></PageBody>;

  const c: QuoteContent = quote.content || {};
  const contactFullName = [quote.contact_first_name, quote.contact_last_name].filter(Boolean).join(" ");
  const sigName = quote.org_signature_name || quote.sender_name || "";
  const sigRole = quote.org_signature_role || "Geschäftsführer";

  // Group items by section
  const sections = new Map<string, QuoteItem[]>();
  for (const item of items) {
    const key = item.section || "";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(item);
  }

  return (
    <>
      <PageHeader
        title={`${quote.quote_number} — ${quote.title}`}
        subtitle={
          <span>
            {contactFullName && (
              <Link to={`/contacts/${quote.contact_id}`} className="text-accent" style={{ textDecoration: "none" }}>
                {contactFullName}
              </Link>
            )}
            {quote.company_name && (contactFullName ? ` at ${quote.company_name}` : quote.company_name)}
            {(contactFullName || quote.company_name) && " — "}
            {formatDate(quote.created_at)}
            {quote.org_name && <span style={{ color: "var(--text-muted)" }}> · {quote.org_name}</span>}
          </span>
        }
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => navigate("/quotes")}>Back</Button>
            <Button variant="ghost" onClick={() => window.open(`/api/quotes/${id}/html`, "_blank")}>Preview PDF</Button>
            <Button variant="ghost" onClick={handleClone}>Clone</Button>
            <Button variant="ghost" onClick={() => setShowSettings(true)}>Settings</Button>
            <Button variant="ghost" onClick={handleDelete} style={{ color: "var(--error)" }}>Delete</Button>
          </div>
        }
      />

      <PageBody>
        {/* ── Status bar ── */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginRight: 8 }}>Status:</span>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              style={{
                padding: "4px 12px", borderRadius: 6,
                border: quote.status === s ? `2px solid ${STATUS_COLORS[s]}` : "1px solid var(--border)",
                background: quote.status === s ? `${STATUS_COLORS[s]}22` : "transparent",
                color: quote.status === s ? STATUS_COLORS[s] : "var(--text-secondary)",
                cursor: "pointer", fontSize: "0.8rem",
                fontWeight: quote.status === s ? 600 : 400, textTransform: "capitalize",
              }}
            >{s}</button>
          ))}
          <div style={{ flex: 1 }} />
          {quote.valid_until && (
            <MetaText size="sm">
              Valid until: <strong>{formatDate(quote.valid_until)}</strong>
              {new Date(quote.valid_until) < new Date() && <Badge status="error" className="ml-2">Expired</Badge>}
            </MetaText>
          )}
        </div>

        {/* ── Document editor ── */}
        <Card style={{ padding: "24px 28px", marginBottom: 16 }}>

          {/* Contact / Recipient */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 4 }}>Empfänger</div>
              {contactFullName ? (
                <div>
                  <Link to={`/contacts/${quote.contact_id}`} className="text-accent" style={{ textDecoration: "none", fontWeight: 500, fontSize: "1rem" }}>
                    {contactFullName}
                  </Link>
                  {quote.contact_job_title && <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}> — {quote.contact_job_title}</span>}
                  {quote.company_name && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{quote.company_name}</div>}
                  {quote.contact_emails?.[0] && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{quote.contact_emails[0]}</div>}
                </div>
              ) : (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No contact assigned</span>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => { setShowContactPicker(true); setContactSearch(""); setContactResults([]); }}
              style={{ fontSize: "0.8rem" }}
            >
              {contactFullName ? "Change" : "Assign Contact"}
            </Button>
          </div>

          {/* ── Title (editable) ── */}
          <EditableBlock
            label="Title"
            value={quote.title}
            onChange={(v) => updateQuote({ title: v })}
            rows={1}
            placeholder="Quote title..."
          />

          {/* ── Salutation ── */}
          <EditableBlock
            label="Anrede / Salutation"
            value={c.salutation || ""}
            onChange={(v) => updateContent("salutation", v)}
            rows={1}
            placeholder="Sehr geehrte Damen und Herren!"
          />

          {/* ── Intro text ── */}
          <EditableBlock
            label="Einleitungstext / Intro"
            value={c.intro || ""}
            onChange={(v) => updateContent("intro", v)}
            rows={3}
            placeholder="Vielen Dank für Ihr Interesse..."
          />

          {/* ── Service description ── */}
          <EditableBlock
            label="Leistungsbeschreibung"
            value={c.service_description || ""}
            onChange={(v) => updateContent("service_description", v)}
            rows={2}
            placeholder="Betrieb des SPRACH-KI Agenten auf modernster Server Architektur."
          />

          {/* ── Closing text ── */}
          <EditableBlock
            label="Schlusstext / Closing"
            value={c.closing || ""}
            onChange={(v) => updateContent("closing", v)}
            rows={3}
            placeholder="Wir sind überzeugt, Ihnen mit diesem Angebot..."
          />

          {/* Greeting + Signature (read-only, from org) */}
          <div style={{ marginBottom: 16, padding: "6px 8px" }}>
            <div style={{ fontSize: "0.9rem" }}>{c.greeting || "Mit freundlichen Grüßen,"}</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{sigName}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{sigRole}</div>
          </div>
        </Card>

        {/* ── Line Items ── */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Positionen / Line Items</strong>
            <Button variant="primary" onClick={() => setShowAddItem(true)} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
              Add Item
            </Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                {["Artikel", "Lösung", "Zyklus"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                ))}
                {["#", "Unit", "Netto", "%", "Summe"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: h === "Unit" || h === "%" ? "center" : "right", fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                ))}
                <th style={{ padding: "8px 10px", width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(sections).map(([section, sectionItems]) => (
                <>{/* section group */}
                  {section && (
                    <tr key={`s-${section}`}>
                      <td colSpan={9} style={{ padding: "12px 10px 6px", fontWeight: 700, borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)", fontSize: "0.9rem" }}>
                        {section}
                      </td>
                    </tr>
                  )}
                  {sectionItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.article || ""}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontWeight: 500 }}>{item.description}</div>
                        {item.detail && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{item.detail}</div>}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{item.cycle || ""}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{item.quantity}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{item.unit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace" }}>{formatCurrency(item.unit_price)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{item.discount_percent > 0 ? `${item.discount_percent}%` : "-"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 500, fontFamily: "monospace" }}>{formatCurrency(item.line_total)}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <button onClick={() => handleDeleteItem(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.9rem" }} title="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>No items yet.</td></tr>
              )}
            </tbody>
          </table>
          {/* Summary row */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", borderTop: "2px solid var(--text-primary)", fontWeight: 700, fontSize: "0.95rem" }}>
            {c.items_summary_label || "SUMME NETTO"}: <span style={{ marginLeft: 16, fontFamily: "monospace" }}>{formatCurrency(quote.net_total, quote.currency)}</span>
          </div>
        </Card>

        {/* ── Totals ── */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <Card style={{ padding: 16, minWidth: 300 }}>
            <table style={{ width: "100%", fontSize: "0.9rem" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Zwischensumme</td>
                  <td style={{ padding: "4px 0", textAlign: "right", fontFamily: "monospace" }}>{formatCurrency(quote.subtotal, quote.currency)}</td>
                </tr>
                {quote.discount_percent > 0 && (
                  <tr>
                    <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Rabatt ({quote.discount_percent}%)</td>
                    <td style={{ padding: "4px 0", textAlign: "right", fontFamily: "monospace" }}>-{formatCurrency(quote.discount_amount, quote.currency)}</td>
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 0 4px", fontWeight: 600 }}>Netto</td>
                  <td style={{ padding: "6px 0 4px", textAlign: "right", fontWeight: 600, fontFamily: "monospace" }}>{formatCurrency(quote.net_total, quote.currency)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>USt ({quote.vat_percent}%)</td>
                  <td style={{ padding: "4px 0", textAlign: "right", fontFamily: "monospace" }}>{formatCurrency(quote.vat_amount, quote.currency)}</td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--text-primary)" }}>
                  <td style={{ padding: "8px 0 0", fontWeight: 700, fontSize: "1.1rem" }}>Gesamt</td>
                  <td style={{ padding: "8px 0 0", textAlign: "right", fontWeight: 700, fontSize: "1.1rem", fontFamily: "monospace" }}>{formatCurrency(quote.gross_total, quote.currency)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        {/* ── Terms (each editable) ── */}
        <Card style={{ padding: "20px 24px", marginBottom: 16 }}>
          <strong style={{ display: "block", marginBottom: 12 }}>Vertragsbedingungen / Terms</strong>
          <EditableBlock label="Vertragsbedingungen" value={c.terms_conditions || ""} onChange={(v) => updateContent("terms_conditions", v)} rows={3} placeholder="Dieses Angebot gilt vorbehaltlich..." />
          <EditableBlock label="Zeitplan & Herstellungszeit" value={c.terms_delivery || ""} onChange={(v) => updateContent("terms_delivery", v)} rows={2} placeholder="Nach Auftragserteilung innerhalb von..." />
          <EditableBlock label="Zahlungsbedingungen" value={c.terms_payment || ""} onChange={(v) => updateContent("terms_payment", v)} rows={4} placeholder="Laufende Gebühren werden im Vorhinein verrechnet..." />
          <EditableBlock label="Vertragsdauer" value={c.terms_contract_duration || ""} onChange={(v) => updateContent("terms_contract_duration", v)} rows={2} placeholder="Der Vertrag ist monatlich zum Stichtag kündbar..." />
          <EditableBlock label="Angebotsannahme" value={c.terms_acceptance || ""} onChange={(v) => updateContent("terms_acceptance", v)} rows={3} placeholder="Hiermit bestelle ich die im Angebot ausgewiesenen Leistungen..." />
        </Card>

        {/* ── SEPA text (editable) ── */}
        {(c.show_sepa || c.sepa_text) && (
          <Card style={{ padding: "20px 24px", marginBottom: 16 }}>
            <strong style={{ display: "block", marginBottom: 12 }}>SEPA Einzugsermächtigung</strong>
            <EditableBlock label="SEPA Text" value={c.sepa_text || ""} onChange={(v) => updateContent("sepa_text", v)} rows={4} placeholder="Hiermit ermächtige ich..." />
          </Card>
        )}

        {/* ── Notes (internal) ── */}
        {quote.notes && (
          <Card style={{ marginBottom: 16, padding: 16, borderLeft: "3px solid var(--warning)" }}>
            <MetaText size="xs" style={{ marginBottom: 4 }}>Internal Notes</MetaText>
            <p style={{ margin: 0 }}>{quote.notes}</p>
          </Card>
        )}

        {quote.tags && quote.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {quote.tags.map((t) => (<Badge key={t} status="muted">{t}</Badge>))}
          </div>
        )}
      </PageBody>

      {/* ── Settings modal ── */}
      <Modal open={showSettings} title="Quote Settings" onClose={() => setShowSettings(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Title</span>
            <input type="text" defaultValue={quote.title} onBlur={(e) => updateQuote({ title: e.target.value })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Valid Until</span>
            <input type="date" defaultValue={quote.valid_until?.slice(0, 10) || ""} onBlur={(e) => updateQuote({ valid_until: e.target.value })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Discount %</span>
              <input type="number" defaultValue={quote.discount_percent ?? 0} onBlur={(e) => updateQuote({ discount_percent: parseFloat(e.target.value) || 0 })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>VAT %</span>
              <input type="number" defaultValue={quote.vat_percent ?? 20} onBlur={(e) => updateQuote({ vat_percent: parseFloat(e.target.value) || 20 })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
            </label>
          </div>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Greeting</span>
            <input type="text" defaultValue={c.greeting || "Mit freundlichen Grüßen,"} onBlur={(e) => updateContent("greeting", e.target.value)} className="form-input" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Summary Label</span>
            <input type="text" defaultValue={c.items_summary_label || "SUMME NETTO"} onBlur={(e) => updateContent("items_summary_label", e.target.value)} className="form-input" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Notes (internal)</span>
            <textarea defaultValue={quote.notes || ""} onBlur={(e) => updateQuote({ notes: e.target.value })} className="form-input" rows={2} style={{ width: "100%", marginTop: 4 }} />
          </label>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Document Sections</span>
            {[
              { key: "show_acceptance_signature", label: "Acceptance signature block" },
              { key: "show_customer_form", label: "Customer data form (Kundendaten)" },
              { key: "show_sepa", label: "SEPA Einzugsermächtigung" },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={(c as Record<string, unknown>)[key] === true}
                  onChange={(e) => updateContent(key, e.target.checked)}
                />
                <span style={{ fontSize: "0.85rem" }}>{label}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowSettings(false)}>Close</Button>
          </div>
        </div>
      </Modal>

      {/* ── Add Item Modal ── */}
      <Modal open={showAddItem} title="Add Line Item" onClose={() => setShowAddItem(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Section</span>
              <input type="text" value={newItem.section} onChange={(e) => setNewItem({ ...newItem, section: e.target.value })} className="form-input" placeholder="e.g. Betrieb (laufend)" style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Article Code</span>
              <input type="text" value={newItem.article} onChange={(e) => setNewItem({ ...newItem, article: e.target.value })} className="form-input" placeholder="e.g. KI-CLOUD" style={{ width: "100%", marginTop: 4 }} />
            </label>
          </div>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Description *</span>
            <input type="text" value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} className="form-input" placeholder="Product / service name" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Detail</span>
            <textarea value={newItem.detail} onChange={(e) => setNewItem({ ...newItem, detail: e.target.value })} className="form-input" rows={2} placeholder="Longer description..." style={{ width: "100%", marginTop: 4 }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Cycle</span>
              <input type="text" value={newItem.cycle} onChange={(e) => setNewItem({ ...newItem, cycle: e.target.value })} className="form-input" placeholder="p.m." style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Quantity</span>
              <input type="number" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: parseFloat(e.target.value) || 1 })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Unit</span>
              <input type="text" value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Discount %</span>
              <input type="number" value={newItem.discount_percent} onChange={(e) => setNewItem({ ...newItem, discount_percent: parseFloat(e.target.value) || 0 })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
            </label>
          </div>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Unit Price (Netto EUR) *</span>
            <input type="number" value={newItem.unit_price} onChange={(e) => setNewItem({ ...newItem, unit_price: parseFloat(e.target.value) || 0 })} className="form-input" style={{ width: "100%", marginTop: 4 }} />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowAddItem(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddItem} disabled={!newItem.description || !newItem.unit_price}>Add</Button>
          </div>
        </div>
      </Modal>

      {/* ── Contact Picker ── */}
      <Modal open={showContactPicker} title="Assign Contact" onClose={() => setShowContactPicker(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text" value={contactSearch} onChange={(e) => searchContacts(e.target.value)}
            className="form-input" placeholder="Search contacts by name, email, company..."
            style={{ width: "100%" }} autoFocus
          />
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {quote.contact_id && (
              <div
                onClick={() => assignContact(null)}
                style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)", color: "var(--error)", fontStyle: "italic" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >Remove contact</div>
            )}
            {contactResults.map((ct) => (
              <div
                key={ct.id}
                onClick={() => assignContact(ct)}
                style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)", background: ct.id === quote.contact_id ? "var(--bg-secondary)" : "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ct.id === quote.contact_id ? "var(--bg-secondary)" : "transparent"; }}
              >
                <div style={{ fontWeight: 500 }}>
                  {ct.first_name} {ct.last_name}
                  {ct.id === quote.contact_id && <span style={{ color: "var(--accent)", fontSize: "0.8rem", marginLeft: 8 }}>current</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {[ct.company_name, ct.job_title, ct.emails?.[0]].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
            {contactSearch.trim() && contactResults.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>No contacts found</div>
            )}
            {!contactSearch.trim() && (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>Type to search</div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
