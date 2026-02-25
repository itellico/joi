import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, MetaText, Modal, PageBody, PageHeader } from "../components/ui";

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
  sender_company: string;
  sender_address: { street?: string; zip?: string; city?: string; country?: string } | null;
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
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_emails: string[] | null;
  contact_job_title: string | null;
  company_name: string | null;
  org_name: string | null;
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
  draft: "var(--warning)",
  sent: "var(--accent)",
  accepted: "var(--success)",
  declined: "var(--error)",
  expired: "var(--text-muted)",
};

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(n: number | null, currency = "EUR"): string {
  if (n === null || n === undefined) return "-";
  return `${n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Quote>>({});
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({
    section: "", article: "", description: "", detail: "", cycle: "p.m.",
    quantity: 1, unit: "Stück", unit_price: 0, discount_percent: 0,
  });

  // Contact picker state
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

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;
    await fetch(`/api/quotes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchQuote();
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    await fetch(`/api/quotes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditing(false);
    fetchQuote();
  };

  const handleAddItem = async () => {
    if (!id) return;
    await fetch(`/api/quotes/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newItem),
    });
    setShowAddItem(false);
    setNewItem({
      section: "", article: "", description: "", detail: "", cycle: "p.m.",
      quantity: 1, unit: "Stück", unit_price: 0, discount_percent: 0,
    });
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
    try {
      const res = await fetch(`/api/quotes/${id}/clone`, { method: "POST" });
      const data = await res.json();
      if (data.id) navigate(`/quotes/${data.id}`);
    } catch {
      // ignore
    }
  };

  const handlePrint = () => {
    window.open(`/api/quotes/${id}/html`, "_blank");
  };

  // Contact picker
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
    await fetch(`/api/quotes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_id: contact?.id || null,
        company_id: contact?.company_id || null,
      }),
    });
    setShowContactPicker(false);
    setContactSearch("");
    setContactResults([]);
    fetchQuote();
  };

  if (loading) return <PageBody><EmptyState message="Loading..." /></PageBody>;
  if (!quote) return <PageBody><EmptyState message="Quote not found." /></PageBody>;

  const contactFullName = [quote.contact_first_name, quote.contact_last_name].filter(Boolean).join(" ");

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
              <>
                {quote.contact_id ? (
                  <Link to={`/contacts/${quote.contact_id}`} className="text-accent" style={{ textDecoration: "none" }}>
                    {contactFullName}
                  </Link>
                ) : contactFullName}
                {quote.company_name && ` at ${quote.company_name}`}
                {" — "}
              </>
            )}
            {quote.company_name && !contactFullName && `${quote.company_name} — `}
            Created {formatDate(quote.created_at)}
            {quote.org_name && (
              <span style={{ color: "var(--text-muted)" }}> · {quote.org_name}</span>
            )}
          </span>
        }
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => navigate("/quotes")}>Back</Button>
            <Button variant="ghost" onClick={handlePrint}>Print / PDF</Button>
            <Button variant="ghost" onClick={handleClone}>Clone</Button>
            <Button variant="ghost" onClick={() => { setEditForm(quote); setEditing(true); }}>Edit</Button>
            <Button variant="ghost" onClick={handleDelete} style={{ color: "var(--error)" }}>Delete</Button>
          </div>
        }
      />

      <PageBody>
        {/* Status bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginRight: 8 }}>Status:</span>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                border: quote.status === s ? `2px solid ${STATUS_COLORS[s]}` : "1px solid var(--border)",
                background: quote.status === s ? `${STATUS_COLORS[s]}22` : "transparent",
                color: quote.status === s ? STATUS_COLORS[s] : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: quote.status === s ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {quote.valid_until && (
            <MetaText size="sm">
              Valid until: <strong>{formatDate(quote.valid_until)}</strong>
              {new Date(quote.valid_until) < new Date() && (
                <Badge status="error" className="ml-2">Expired</Badge>
              )}
            </MetaText>
          )}
        </div>

        {/* Contact card */}
        <Card style={{ marginBottom: 16, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", color: "var(--text-muted)", minWidth: 60 }}>
              To
            </span>
            {contactFullName ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <div>
                  <Link to={`/contacts/${quote.contact_id}`} className="text-accent" style={{ textDecoration: "none", fontWeight: 500 }}>
                    {contactFullName}
                  </Link>
                  {quote.contact_job_title && (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}> — {quote.contact_job_title}</span>
                  )}
                  {quote.company_name && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{quote.company_name}</div>
                  )}
                  {quote.contact_emails?.[0] && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{quote.contact_emails[0]}</div>
                  )}
                </div>
              </div>
            ) : (
              <span style={{ flex: 1, color: "var(--text-muted)", fontStyle: "italic" }}>No contact assigned</span>
            )}
            <Button
              variant="ghost"
              onClick={() => { setShowContactPicker(true); setContactSearch(""); setContactResults([]); }}
              style={{ fontSize: "0.8rem" }}
            >
              {contactFullName ? "Change" : "Assign Contact"}
            </Button>
          </div>
        </Card>

        {/* Intro text */}
        {quote.intro_text && (
          <Card style={{ marginBottom: 16, padding: 16 }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{quote.intro_text}</p>
          </Card>
        )}

        {/* Line items */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Line Items</strong>
            <Button variant="primary" onClick={() => setShowAddItem(true)} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
              Add Item
            </Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Article</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Description</th>
                <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Cycle</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Qty</th>
                <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Unit</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Price</th>
                <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>%</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.3px" }}>Total</th>
                <th style={{ padding: "8px 12px", width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(sections).map(([section, sectionItems]) => (
                <>{/* Fragment with key handled by section row */}
                  {section && (
                    <tr key={`section-${section}`}>
                      <td colSpan={9} style={{ padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        {section}
                      </td>
                    </tr>
                  )}
                  {sectionItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.article || "-"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontWeight: 500 }}>{item.description}</div>
                        {item.detail && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>{item.detail}</div>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{item.cycle || "-"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{item.quantity}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{item.unit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{formatCurrency(item.unit_price)}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{item.discount_percent > 0 ? `${item.discount_percent}%` : "-"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500, fontFamily: "monospace" }}>{formatCurrency(item.line_total)}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.8rem" }}
                          title="Remove item"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                    No items yet. Click "Add Item" to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <Card style={{ padding: 16, minWidth: 300 }}>
            <table style={{ width: "100%", fontSize: "0.9rem" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Subtotal</td>
                  <td style={{ padding: "4px 0", textAlign: "right", fontFamily: "monospace" }}>{formatCurrency(quote.subtotal, quote.currency)}</td>
                </tr>
                {quote.discount_percent > 0 && (
                  <tr>
                    <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Discount ({quote.discount_percent}%)</td>
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

        {/* Closing text */}
        {quote.closing_text && (
          <Card style={{ marginBottom: 16, padding: 16 }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{quote.closing_text}</p>
          </Card>
        )}

        {/* Terms */}
        {quote.terms && Object.keys(quote.terms).length > 0 && (
          <Card style={{ marginBottom: 16, padding: 16 }}>
            <strong style={{ display: "block", marginBottom: 12 }}>Terms</strong>
            {Object.entries(quote.terms).map(([key, value]) => (
              <div key={key} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "capitalize", marginBottom: 2 }}>{key.replace(/_/g, " ")}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{value}</div>
              </div>
            ))}
          </Card>
        )}

        {/* Notes (internal) */}
        {quote.notes && (
          <Card style={{ marginBottom: 16, padding: 16, borderLeft: "3px solid var(--warning)" }}>
            <MetaText size="xs" style={{ marginBottom: 4 }}>Internal Notes</MetaText>
            <p style={{ margin: 0 }}>{quote.notes}</p>
          </Card>
        )}

        {/* Tags */}
        {quote.tags && quote.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {quote.tags.map((t) => (
              <Badge key={t} status="muted">{t}</Badge>
            ))}
          </div>
        )}
      </PageBody>

      {/* Edit Modal */}
      <Modal open={editing} title="Edit Quote" onClose={() => setEditing(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Title</span>
            <input
              type="text"
              value={editForm.title || ""}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Valid Until</span>
            <input
              type="date"
              value={editForm.valid_until?.slice(0, 10) || ""}
              onChange={(e) => setEditForm({ ...editForm, valid_until: e.target.value })}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Intro Text</span>
            <textarea
              value={editForm.intro_text || ""}
              onChange={(e) => setEditForm({ ...editForm, intro_text: e.target.value })}
              className="form-input"
              rows={3}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Closing Text</span>
            <textarea
              value={editForm.closing_text || ""}
              onChange={(e) => setEditForm({ ...editForm, closing_text: e.target.value })}
              className="form-input"
              rows={3}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Discount %</span>
            <input
              type="number"
              value={editForm.discount_percent ?? 0}
              onChange={(e) => setEditForm({ ...editForm, discount_percent: parseFloat(e.target.value) || 0 })}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>VAT %</span>
            <input
              type="number"
              value={editForm.vat_percent ?? 20}
              onChange={(e) => setEditForm({ ...editForm, vat_percent: parseFloat(e.target.value) || 20 })}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Notes (internal)</span>
            <textarea
              value={editForm.notes || ""}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              className="form-input"
              rows={2}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveEdit}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Add Item Modal */}
      <Modal open={showAddItem} title="Add Line Item" onClose={() => setShowAddItem(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Section</span>
              <input
                type="text"
                value={newItem.section}
                onChange={(e) => setNewItem({ ...newItem, section: e.target.value })}
                className="form-input"
                placeholder="e.g. Betrieb (laufend)"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Article Code</span>
              <input
                type="text"
                value={newItem.article}
                onChange={(e) => setNewItem({ ...newItem, article: e.target.value })}
                className="form-input"
                placeholder="e.g. KI-CLOUD"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Description *</span>
            <input
              type="text"
              value={newItem.description}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
              className="form-input"
              placeholder="Product / service name"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Detail</span>
            <textarea
              value={newItem.detail}
              onChange={(e) => setNewItem({ ...newItem, detail: e.target.value })}
              className="form-input"
              rows={2}
              placeholder="Longer description..."
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Cycle</span>
              <input
                type="text"
                value={newItem.cycle}
                onChange={(e) => setNewItem({ ...newItem, cycle: e.target.value })}
                className="form-input"
                placeholder="p.m."
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Quantity</span>
              <input
                type="number"
                value={newItem.quantity}
                onChange={(e) => setNewItem({ ...newItem, quantity: parseFloat(e.target.value) || 1 })}
                className="form-input"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Unit</span>
              <input
                type="text"
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                className="form-input"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Discount %</span>
              <input
                type="number"
                value={newItem.discount_percent}
                onChange={(e) => setNewItem({ ...newItem, discount_percent: parseFloat(e.target.value) || 0 })}
                className="form-input"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Unit Price (Netto EUR) *</span>
            <input
              type="number"
              value={newItem.unit_price}
              onChange={(e) => setNewItem({ ...newItem, unit_price: parseFloat(e.target.value) || 0 })}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowAddItem(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddItem} disabled={!newItem.description || !newItem.unit_price}>Add</Button>
          </div>
        </div>
      </Modal>

      {/* Contact Picker Modal */}
      <Modal open={showContactPicker} title="Assign Contact" onClose={() => setShowContactPicker(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            value={contactSearch}
            onChange={(e) => searchContacts(e.target.value)}
            className="form-input"
            placeholder="Search contacts by name, email, company..."
            style={{ width: "100%" }}
            autoFocus
          />
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {/* Remove contact option */}
            {quote.contact_id && (
              <div
                onClick={() => assignContact(null)}
                style={{
                  padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)",
                  color: "var(--error)", fontStyle: "italic",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                Remove contact assignment
              </div>
            )}
            {contactResults.map((c) => (
              <div
                key={c.id}
                onClick={() => assignContact(c)}
                style={{
                  padding: "10px 12px", cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background: c.id === quote.contact_id ? "var(--bg-secondary)" : "transparent",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = c.id === quote.contact_id ? "var(--bg-secondary)" : "transparent"; }}
              >
                <div style={{ fontWeight: 500 }}>
                  {c.first_name} {c.last_name}
                  {c.id === quote.contact_id && (
                    <span style={{ color: "var(--accent)", fontSize: "0.8rem", marginLeft: 8 }}>current</span>
                  )}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {[c.company_name, c.job_title, c.emails?.[0]].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
            {contactSearch.trim() && contactResults.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                No contacts found
              </div>
            )}
            {!contactSearch.trim() && (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                Type to search for contacts
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
