import { useEffect, useState, useCallback } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetaText,
  Modal,
  PageHeader,
  PageBody,
} from "../components/ui";

interface Organization {
  id: string;
  name: string;
  short_name: string | null;
  is_default: boolean;
  address: { street?: string; zip?: string; city?: string; country?: string } | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  uid_number: string | null;
  firmenbuch: string | null;
  legal_form: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  account_holder: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  default_intro_text: string | null;
  default_closing_text: string | null;
  default_signature_name: string | null;
  default_signature_role: string | null;
  legal_urls: Record<string, string> | null;
  notes: string | null;
  created_at: string;
}

interface QuoteTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  intro_text: string | null;
  closing_text: string | null;
  terms: Record<string, string> | null;
  default_items: Array<Record<string, unknown>> | null;
  show_acceptance: boolean;
  show_customer_form: boolean;
  show_sepa: boolean;
  default_vat_percent: number;
  default_currency: string;
  default_valid_days: number;
  is_active: boolean;
  org_name: string;
  created_at: string;
}

type Tab = "organizations" | "templates";

const EMPTY_ORG: Partial<Organization> = {
  name: "", short_name: "", phone: "", email: "", website: "",
  uid_number: "", bank_name: "", iban: "", bic: "", account_holder: "",
  default_signature_name: "", default_signature_role: "",
  default_intro_text: "", default_closing_text: "",
  address: { street: "", zip: "", city: "", country: "AT" },
  legal_urls: { agb: "", verrechnungssaetze: "", avv: "" },
};

const EMPTY_TPL: Partial<QuoteTemplate> = {
  name: "", description: "", intro_text: "", closing_text: "",
  default_vat_percent: 20, default_currency: "EUR", default_valid_days: 14,
  show_acceptance: true, show_customer_form: false, show_sepa: false,
  terms: {}, default_items: [],
};

export default function Organizations() {
  const [tab, setTab] = useState<Tab>("organizations");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Org editing
  const [editingOrg, setEditingOrg] = useState<Partial<Organization> | null>(null);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);

  // Template editing
  const [editingTpl, setEditingTpl] = useState<Partial<QuoteTemplate> | null>(null);
  const [editingTplId, setEditingTplId] = useState<string | null>(null);

  const fetchOrgs = useCallback(async () => {
    const res = await fetch("/api/organizations");
    const data = await res.json();
    setOrgs(data.organizations || []);
  }, []);

  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/quote-templates");
    const data = await res.json();
    setTemplates(data.templates || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOrgs(), fetchTemplates()]).finally(() => setLoading(false));
  }, [fetchOrgs, fetchTemplates]);

  // ─── Org CRUD ───
  const handleSaveOrg = async () => {
    if (!editingOrg) return;
    const method = editingOrgId ? "PUT" : "POST";
    const url = editingOrgId ? `/api/organizations/${editingOrgId}` : "/api/organizations";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingOrg),
    });
    setEditingOrg(null);
    setEditingOrgId(null);
    fetchOrgs();
  };

  const handleDeleteOrg = async (id: string) => {
    if (!confirm("Delete this organization?")) return;
    await fetch(`/api/organizations/${id}`, { method: "DELETE" });
    fetchOrgs();
  };

  // ─── Template CRUD ───
  const handleSaveTpl = async () => {
    if (!editingTpl) return;
    const method = editingTplId ? "PUT" : "POST";
    const url = editingTplId ? `/api/quote-templates/${editingTplId}` : "/api/quote-templates";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingTpl),
    });
    setEditingTpl(null);
    setEditingTplId(null);
    fetchTemplates();
  };

  const handleDeleteTpl = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/quote-templates/${id}`, { method: "DELETE" });
    fetchTemplates();
  };

  if (loading) return <PageBody><EmptyState message="Loading..." /></PageBody>;

  return (
    <>
      <PageHeader
        title="Organizations & Templates"
        subtitle="Manage your companies and quote templates"
        actions={
          tab === "organizations" ? (
            <Button variant="primary" onClick={() => { setEditingOrg({ ...EMPTY_ORG }); setEditingOrgId(null); }}>
              New Organization
            </Button>
          ) : (
            <Button variant="primary" onClick={() => {
              setEditingTpl({ ...EMPTY_TPL, organization_id: orgs[0]?.id });
              setEditingTplId(null);
            }}>
              New Template
            </Button>
          )
        }
      />

      <PageBody>
        {/* Tab selector */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
          {(["organizations", "templates"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "6px 16px", borderRadius: 6, cursor: "pointer",
                fontSize: "0.85rem", textTransform: "capitalize",
                border: tab === t ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: tab === t ? "var(--accent-subtle)" : "transparent",
                color: tab === t ? "var(--accent)" : "var(--text-secondary)",
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t} ({t === "organizations" ? orgs.length : templates.length})
            </button>
          ))}
        </div>

        {/* Organizations list */}
        {tab === "organizations" && (
          orgs.length === 0 ? (
            <EmptyState icon="🏢" message="No organizations yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {orgs.map((org) => (
                <Card key={org.id} style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: "1rem" }}>{org.name}</strong>
                        {org.is_default && <Badge status="accent">Default</Badge>}
                        {org.short_name && <Badge status="muted">{org.short_name}</Badge>}
                      </div>
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        {org.address?.street && <span>{org.address.street}, {org.address.zip} {org.address.city}</span>}
                        {org.phone && <span>{org.phone}</span>}
                        {org.email && <span>{org.email}</span>}
                        {org.uid_number && <span>UID: {org.uid_number}</span>}
                      </div>
                      {(org.iban || org.bank_name) && (
                        <MetaText size="xs" style={{ marginTop: 4 }}>
                          Bank: {org.bank_name} {org.iban && `/ ${org.iban}`} {org.bic && `/ ${org.bic}`}
                        </MetaText>
                      )}
                      {org.default_signature_name && (
                        <MetaText size="xs" style={{ marginTop: 2 }}>
                          Signature: {org.default_signature_name}{org.default_signature_role ? `, ${org.default_signature_role}` : ""}
                        </MetaText>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="ghost" onClick={() => { setEditingOrg({ ...org }); setEditingOrgId(org.id); }}>Edit</Button>
                      {!org.is_default && (
                        <Button variant="ghost" onClick={() => handleDeleteOrg(org.id)} style={{ color: "var(--error)" }}>Delete</Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {/* Templates list */}
        {tab === "templates" && (
          templates.length === 0 ? (
            <EmptyState icon="📄" message="No quote templates yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {templates.map((tpl) => (
                <Card key={tpl.id} style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <strong>{tpl.name}</strong>
                        <Badge status={tpl.is_active ? "success" : "muted"}>{tpl.is_active ? "Active" : "Inactive"}</Badge>
                        <MetaText size="xs">{tpl.org_name}</MetaText>
                      </div>
                      {tpl.description && (
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 4 }}>{tpl.description}</div>
                      )}
                      <div style={{ display: "flex", gap: 16, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        <span>VAT: {tpl.default_vat_percent}%</span>
                        <span>Valid: {tpl.default_valid_days} days</span>
                        <span>{tpl.default_currency}</span>
                        <span>{(tpl.default_items || []).length} default items</span>
                        {tpl.show_acceptance && <span>Acceptance form</span>}
                        {tpl.show_sepa && <span>SEPA form</span>}
                      </div>
                      {tpl.terms && Object.keys(tpl.terms).length > 0 && (
                        <MetaText size="xs" style={{ marginTop: 4 }}>
                          Terms: {Object.keys(tpl.terms).join(", ")}
                        </MetaText>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="ghost" onClick={() => { setEditingTpl({ ...tpl }); setEditingTplId(tpl.id); }}>Edit</Button>
                      <Button variant="ghost" onClick={() => handleDeleteTpl(tpl.id)} style={{ color: "var(--error)" }}>Delete</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </PageBody>

      {/* Organization Edit Modal */}
      {editingOrg && (
        <Modal open={true} title={editingOrgId ? "Edit Organization" : "New Organization"} onClose={() => { setEditingOrg(null); setEditingOrgId(null); }} width={640}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Company Name *</span>
                <input className="form-input" value={editingOrg.name || ""} onChange={(e) => setEditingOrg({ ...editingOrg, name: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Short Name</span>
                <input className="form-input" value={editingOrg.short_name || ""} onChange={(e) => setEditingOrg({ ...editingOrg, short_name: e.target.value })} placeholder="e.g. itellico" style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Address</div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Street</span>
                <input className="form-input" value={editingOrg.address?.street || ""} onChange={(e) => setEditingOrg({ ...editingOrg, address: { ...editingOrg.address, street: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">ZIP</span>
                <input className="form-input" value={editingOrg.address?.zip || ""} onChange={(e) => setEditingOrg({ ...editingOrg, address: { ...editingOrg.address, zip: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">City</span>
                <input className="form-input" value={editingOrg.address?.city || ""} onChange={(e) => setEditingOrg({ ...editingOrg, address: { ...editingOrg.address, city: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Contact</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Phone</span>
                <input className="form-input" value={editingOrg.phone || ""} onChange={(e) => setEditingOrg({ ...editingOrg, phone: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Email</span>
                <input className="form-input" value={editingOrg.email || ""} onChange={(e) => setEditingOrg({ ...editingOrg, email: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Website</span>
                <input className="form-input" value={editingOrg.website || ""} onChange={(e) => setEditingOrg({ ...editingOrg, website: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Legal & Tax</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">UID Number</span>
                <input className="form-input" value={editingOrg.uid_number || ""} onChange={(e) => setEditingOrg({ ...editingOrg, uid_number: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Legal Form</span>
                <input className="form-input" value={editingOrg.legal_form || ""} onChange={(e) => setEditingOrg({ ...editingOrg, legal_form: e.target.value })} placeholder="GmbH" style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Bank Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Bank</span>
                <input className="form-input" value={editingOrg.bank_name || ""} onChange={(e) => setEditingOrg({ ...editingOrg, bank_name: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">IBAN</span>
                <input className="form-input" value={editingOrg.iban || ""} onChange={(e) => setEditingOrg({ ...editingOrg, iban: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">BIC</span>
                <input className="form-input" value={editingOrg.bic || ""} onChange={(e) => setEditingOrg({ ...editingOrg, bic: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Account Holder</span>
                <input className="form-input" value={editingOrg.account_holder || ""} onChange={(e) => setEditingOrg({ ...editingOrg, account_holder: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Quote Defaults</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Signature Name</span>
                <input className="form-input" value={editingOrg.default_signature_name || ""} onChange={(e) => setEditingOrg({ ...editingOrg, default_signature_name: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Signature Role</span>
                <input className="form-input" value={editingOrg.default_signature_role || ""} onChange={(e) => setEditingOrg({ ...editingOrg, default_signature_role: e.target.value })} placeholder="Geschäftsführer" style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>
            <label>
              <span className="form-label">Default Intro Text</span>
              <textarea className="form-input" value={editingOrg.default_intro_text || ""} onChange={(e) => setEditingOrg({ ...editingOrg, default_intro_text: e.target.value })} rows={2} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span className="form-label">Default Closing Text</span>
              <textarea className="form-input" value={editingOrg.default_closing_text || ""} onChange={(e) => setEditingOrg({ ...editingOrg, default_closing_text: e.target.value })} rows={2} style={{ width: "100%", marginTop: 4 }} />
            </label>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Legal URLs</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">AGB URL</span>
                <input className="form-input" value={editingOrg.legal_urls?.agb || ""} onChange={(e) => setEditingOrg({ ...editingOrg, legal_urls: { ...editingOrg.legal_urls, agb: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Verrechnungssätze URL</span>
                <input className="form-input" value={editingOrg.legal_urls?.verrechnungssaetze || ""} onChange={(e) => setEditingOrg({ ...editingOrg, legal_urls: { ...editingOrg.legal_urls, verrechnungssaetze: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">AVV URL</span>
                <input className="form-input" value={editingOrg.legal_urls?.avv || ""} onChange={(e) => setEditingOrg({ ...editingOrg, legal_urls: { ...editingOrg.legal_urls, avv: e.target.value } })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <label>
              <span className="form-label">Logo URL</span>
              <input className="form-input" value={editingOrg.logo_url || ""} onChange={(e) => setEditingOrg({ ...editingOrg, logo_url: e.target.value })} placeholder="/api/media/:id/file or https://..." style={{ width: "100%", marginTop: 4 }} />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Button variant="ghost" onClick={() => { setEditingOrg(null); setEditingOrgId(null); }}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveOrg} disabled={!editingOrg.name}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Template Edit Modal */}
      {editingTpl && (
        <Modal open={true} title={editingTplId ? "Edit Template" : "New Template"} onClose={() => { setEditingTpl(null); setEditingTplId(null); }} width={640}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">Organization *</span>
                <select className="form-input" value={editingTpl.organization_id || ""} onChange={(e) => setEditingTpl({ ...editingTpl, organization_id: e.target.value })} style={{ width: "100%", marginTop: 4 }}>
                  <option value="">Select...</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label>
                <span className="form-label">Template Name *</span>
                <input className="form-input" value={editingTpl.name || ""} onChange={(e) => setEditingTpl({ ...editingTpl, name: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <label>
              <span className="form-label">Description</span>
              <input className="form-input" value={editingTpl.description || ""} onChange={(e) => setEditingTpl({ ...editingTpl, description: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
            </label>

            <label>
              <span className="form-label">Intro Text (overrides org default)</span>
              <textarea className="form-input" value={editingTpl.intro_text || ""} onChange={(e) => setEditingTpl({ ...editingTpl, intro_text: e.target.value })} rows={2} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              <span className="form-label">Closing Text (overrides org default)</span>
              <textarea className="form-input" value={editingTpl.closing_text || ""} onChange={(e) => setEditingTpl({ ...editingTpl, closing_text: e.target.value })} rows={2} style={{ width: "100%", marginTop: 4 }} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label>
                <span className="form-label">VAT %</span>
                <input className="form-input" type="number" value={editingTpl.default_vat_percent ?? 20} onChange={(e) => setEditingTpl({ ...editingTpl, default_vat_percent: parseFloat(e.target.value) || 20 })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Currency</span>
                <input className="form-input" value={editingTpl.default_currency || "EUR"} onChange={(e) => setEditingTpl({ ...editingTpl, default_currency: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label>
                <span className="form-label">Valid Days</span>
                <input className="form-input" type="number" value={editingTpl.default_valid_days ?? 14} onChange={(e) => setEditingTpl({ ...editingTpl, default_valid_days: parseInt(e.target.value) || 14 })} style={{ width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                <input type="checkbox" checked={editingTpl.show_acceptance ?? true} onChange={(e) => setEditingTpl({ ...editingTpl, show_acceptance: e.target.checked })} />
                Acceptance form
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                <input type="checkbox" checked={editingTpl.show_sepa ?? false} onChange={(e) => setEditingTpl({ ...editingTpl, show_sepa: e.target.checked })} />
                SEPA form
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                <input type="checkbox" checked={editingTpl.show_customer_form ?? false} onChange={(e) => setEditingTpl({ ...editingTpl, show_customer_form: e.target.checked })} />
                Customer data form
              </label>
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>Default Terms</div>
            {["conditions", "delivery", "payment", "contract_duration", "acceptance"].map((key) => (
              <label key={key}>
                <span className="form-label" style={{ textTransform: "capitalize" }}>{key.replace(/_/g, " ")}</span>
                <textarea
                  className="form-input"
                  value={(editingTpl.terms as Record<string, string>)?.[key] || ""}
                  onChange={(e) => setEditingTpl({
                    ...editingTpl,
                    terms: { ...(editingTpl.terms || {}), [key]: e.target.value },
                  })}
                  rows={2}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
            ))}

            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 8 }}>
              Default Line Items ({(editingTpl.default_items || []).length})
            </div>
            <MetaText size="xs">
              Pre-filled items JSON. Edit via the agent or API for now.
            </MetaText>
            <textarea
              className="form-input"
              value={JSON.stringify(editingTpl.default_items || [], null, 2)}
              onChange={(e) => {
                try {
                  setEditingTpl({ ...editingTpl, default_items: JSON.parse(e.target.value) });
                } catch { /* ignore parse errors while typing */ }
              }}
              rows={6}
              style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Button variant="ghost" onClick={() => { setEditingTpl(null); setEditingTplId(null); }}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveTpl} disabled={!editingTpl.name || !editingTpl.organization_id}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
