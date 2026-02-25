import { useEffect, useState, useCallback } from "react";
import { Card, Button, FormField, FormGrid } from "../../components/ui";

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
}

const EMPTY_ORG: Partial<Organization> = {
  name: "", short_name: "", address: { street: "", zip: "", city: "", country: "AT" },
  phone: "", email: "", website: "", uid_number: "", firmenbuch: "", legal_form: "GmbH",
  bank_name: "", iban: "", bic: "", account_holder: "",
  logo_url: "", default_signature_name: "", default_signature_role: "",
  default_intro_text: "", default_closing_text: "",
  legal_urls: { agb: "", verrechnungssaetze: "", avv: "", impressum: "", datenschutz: "" },
};

export default function CrmTab() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [form, setForm] = useState<Partial<Organization>>(EMPTY_ORG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fetchOrgs = useCallback(async () => {
    const res = await fetch("/api/organizations");
    const data = await res.json();
    const list: Organization[] = data.organizations || data || [];
    setOrgs(list);
    // Auto-select default org
    const def = list.find((o) => o.is_default) || list[0];
    if (def) { setSelected(def); setForm(def); }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const setField = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  const setAddress = (key: string, value: string) => setForm((f) => ({
    ...f,
    address: { ...(f.address || {}), [key]: value },
  }));
  const setLegalUrl = (key: string, value: string) => setForm((f) => ({
    ...f,
    legal_urls: { ...(f.legal_urls || {}), [key]: value },
  }));

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/organizations/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      fetchOrgs();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const [uploading, setUploading] = useState(false);

  const handleLogoUpload = (file: File) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setField("logo_url", reader.result as string);
      setUploading(false);
    };
    reader.onerror = () => setUploading(false);
    reader.readAsDataURL(file);
  };

  if (!selected) {
    return <Card><p className="text-muted">Loading organization...</p></Card>;
  }

  const addr = form.address || {};
  const urls = form.legal_urls || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Org selector (if multiple) */}
      {orgs.length > 1 && (
        <Card style={{ padding: 16 }}>
          <FormField label="Organization">
            <select
              value={selected.id}
              onChange={(e) => {
                const o = orgs.find((org) => org.id === e.target.value);
                if (o) { setSelected(o); setForm(o); }
              }}
              className="form-input"
              style={{ width: "100%" }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{o.is_default ? " (default)" : ""}</option>
              ))}
            </select>
          </FormField>
        </Card>
      )}

      {/* Company Details */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Company Details</h3>
        <FormGrid>
          <FormField label="Company Name">
            <input type="text" value={form.name || ""} onChange={(e) => setField("name", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="Short Name (for quote numbers)">
            <input type="text" value={form.short_name || ""} onChange={(e) => setField("short_name", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="e.g. itellico" />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Legal Form">
            <input type="text" value={form.legal_form || ""} onChange={(e) => setField("legal_form", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="GmbH" />
          </FormField>
          <FormField label="UID Number">
            <input type="text" value={form.uid_number || ""} onChange={(e) => setField("uid_number", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="ATU..." />
          </FormField>
        </FormGrid>
      </Card>

      {/* Address */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Address & Contact</h3>
        <FormField label="Street">
          <input type="text" value={addr.street || ""} onChange={(e) => setAddress("street", e.target.value)} className="form-input" style={{ width: "100%" }} />
        </FormField>
        <FormGrid>
          <FormField label="ZIP">
            <input type="text" value={addr.zip || ""} onChange={(e) => setAddress("zip", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="City">
            <input type="text" value={addr.city || ""} onChange={(e) => setAddress("city", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Phone">
            <input type="text" value={form.phone || ""} onChange={(e) => setField("phone", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="Email">
            <input type="email" value={form.email || ""} onChange={(e) => setField("email", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
        <FormField label="Website">
          <input type="url" value={form.website || ""} onChange={(e) => setField("website", e.target.value)} className="form-input" style={{ width: "100%" }} />
        </FormField>
      </Card>

      {/* Logo & Branding */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Logo & Branding</h3>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 180px" }}>
            {form.logo_url ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "#fff", textAlign: "center" }}>
                <img src={form.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: 80 }} />
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => setField("logo_url", "")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--error)", fontSize: "0.8rem" }}
                  >Remove</button>
                </div>
              </div>
            ) : (
              <div style={{
                border: "2px dashed var(--border)", borderRadius: 8, padding: 20,
                textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem",
              }}>
                No logo
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Upload Logo (PNG, SVG, JPG)">
              <input
                type="file"
                accept="image/png,image/svg+xml,image/jpeg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                className="form-input"
                style={{ width: "100%" }}
                disabled={uploading}
              />
              {uploading && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Processing...</span>}
            </FormField>
            <FormField label="Or paste Logo URL">
              <input type="url" value={form.logo_url || ""} onChange={(e) => setField("logo_url", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="https://..." />
            </FormField>
          </div>
        </div>
      </Card>

      {/* Bank Details */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Bank Details</h3>
        <FormGrid>
          <FormField label="Bank Name">
            <input type="text" value={form.bank_name || ""} onChange={(e) => setField("bank_name", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="Account Holder">
            <input type="text" value={form.account_holder || ""} onChange={(e) => setField("account_holder", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="IBAN">
            <input type="text" value={form.iban || ""} onChange={(e) => setField("iban", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="BIC">
            <input type="text" value={form.bic || ""} onChange={(e) => setField("bic", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
      </Card>

      {/* Signature & Default Texts */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Signature & Default Texts</h3>
        <FormGrid>
          <FormField label="Signature Name">
            <input type="text" value={form.default_signature_name || ""} onChange={(e) => setField("default_signature_name", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="Marcus Markowitsch, MBA" />
          </FormField>
          <FormField label="Signature Role">
            <input type="text" value={form.default_signature_role || ""} onChange={(e) => setField("default_signature_role", e.target.value)} className="form-input" style={{ width: "100%" }} placeholder="Geschäftsführer" />
          </FormField>
        </FormGrid>
        <FormField label="Default Intro Text">
          <textarea value={form.default_intro_text || ""} onChange={(e) => setField("default_intro_text", e.target.value)} className="form-input" rows={3} style={{ width: "100%" }} placeholder="Vielen Dank für Ihr Interesse..." />
        </FormField>
        <FormField label="Default Closing Text">
          <textarea value={form.default_closing_text || ""} onChange={(e) => setField("default_closing_text", e.target.value)} className="form-input" rows={3} style={{ width: "100%" }} placeholder="Wir sind überzeugt, Ihnen mit diesem Angebot..." />
        </FormField>
      </Card>

      {/* Legal URLs */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 16 }}>Legal URLs</h3>
        <FormGrid>
          <FormField label="AGB">
            <input type="url" value={urls.agb || ""} onChange={(e) => setLegalUrl("agb", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="Verrechnungssätze">
            <input type="url" value={urls.verrechnungssaetze || ""} onChange={(e) => setLegalUrl("verrechnungssaetze", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="AVV">
            <input type="url" value={urls.avv || ""} onChange={(e) => setLegalUrl("avv", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
          <FormField label="Impressum">
            <input type="url" value={urls.impressum || ""} onChange={(e) => setLegalUrl("impressum", e.target.value)} className="form-input" style={{ width: "100%" }} />
          </FormField>
        </FormGrid>
        <FormField label="Datenschutz">
          <input type="url" value={urls.datenschutz || ""} onChange={(e) => setLegalUrl("datenschutz", e.target.value)} className="form-input" style={{ width: "100%" }} />
        </FormField>
      </Card>

      {/* Save */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
        {saved && <span style={{ color: "var(--success)", fontSize: "0.85rem" }}>Saved!</span>}
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Organization"}
        </Button>
      </div>
    </div>
  );
}
