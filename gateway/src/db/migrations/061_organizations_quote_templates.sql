-- Organizations (your own companies) + Quote Templates
-- Organizations hold branding, bank details, legal info for document generation
-- Quote templates provide reusable starting points for quotes

-- ─── Organizations ───

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_name TEXT,                              -- e.g. "itellico" for quote number prefixes
  is_default BOOLEAN DEFAULT false,

  -- Contact info
  address JSONB DEFAULT '{}'::jsonb,            -- {street, zip, city, country}
  phone TEXT,
  email TEXT,
  website TEXT,

  -- Legal / tax
  uid_number TEXT,                              -- ATU / VAT ID
  firmenbuch TEXT,                              -- company register number
  legal_form TEXT,                              -- GmbH, KG, e.U., etc.

  -- Bank details (for SEPA / Einzugsermächtigung on quotes)
  bank_name TEXT,
  iban TEXT,
  bic TEXT,
  account_holder TEXT,

  -- Branding
  logo_url TEXT,                                -- /api/media/:id/file or external URL
  primary_color TEXT DEFAULT '#1a1a1a',
  accent_color TEXT DEFAULT '#3b82f6',

  -- Default texts for quotes
  default_intro_text TEXT,
  default_closing_text TEXT,
  default_signature_name TEXT,
  default_signature_role TEXT,

  -- Legal URLs
  legal_urls JSONB DEFAULT '{}'::jsonb,         -- {agb, verrechnungssaetze, avv, impressum, datenschutz}

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX organizations_name_idx ON organizations (LOWER(name));

-- Seed default organization (itellico)
INSERT INTO organizations (
  name, short_name, is_default,
  address, phone, email, website,
  uid_number, legal_form,
  default_intro_text, default_closing_text,
  default_signature_name, default_signature_role,
  legal_urls
) VALUES (
  'itellico internet solutions gmbh',
  'itellico',
  true,
  '{"street": "Lindengasse 26/2+3", "zip": "1070", "city": "Wien", "country": "AT"}'::jsonb,
  '+43.664.4245497',
  NULL,
  'https://itellico.ai',
  'ATU73428234',
  'GmbH',
  'Vielen Dank für Ihr Interesse an unseren Sprach-KI Lösungen. Gerne unterbreiten wir Ihnen ein Angebot für das Aufsetzen und den Betrieb unserer SPRACH-KI Lösung:',
  'Wir sind überzeugt, Ihnen mit diesem Angebot eine qualitativ hochwertige und zukunftssichere Lösung anzubieten. Bei Fragen oder für weitere Informationen stehen wir Ihnen selbstverständlich jederzeit gerne zur Verfügung.',
  'Marcus Markowitsch, MBA',
  'Geschäftsführer',
  '{"agb": "https://itellico.ai/de/rechtliches/agb", "verrechnungssaetze": "https://itellico.ai/de/rechtliches/verrechnungssaetze/", "avv": "https://itellico.ai/de/rechtliches/auftragsverarbeitungsvertrag/"}'::jsonb
);

-- ─── Quote Templates ───

CREATE TABLE quote_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- Content defaults
  intro_text TEXT,
  closing_text TEXT,

  -- Default terms
  terms JSONB DEFAULT '{}'::jsonb,
  -- e.g. {"payment": "...", "delivery": "...", "contract_duration": "...", "acceptance": "..."}

  -- Pre-filled line items (copied into quote on creation)
  default_items JSONB DEFAULT '[]'::jsonb,
  -- Array of: [{section, article, description, detail, cycle, quantity, unit, unit_price, discount_percent}]

  -- Display config
  show_acceptance BOOLEAN DEFAULT true,         -- Angebotsannahme signature section
  show_customer_form BOOLEAN DEFAULT false,     -- Customer data collection form
  show_sepa BOOLEAN DEFAULT false,              -- SEPA Einzugsermächtigung

  -- Pricing defaults
  default_vat_percent NUMERIC(5,2) DEFAULT 20,
  default_currency TEXT DEFAULT 'EUR',
  default_valid_days INT DEFAULT 14,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX quote_templates_org_idx ON quote_templates (organization_id);

-- Seed default template
INSERT INTO quote_templates (
  organization_id,
  name, description,
  intro_text, closing_text,
  terms,
  default_items,
  show_acceptance, show_sepa,
  default_vat_percent, default_valid_days
) VALUES (
  (SELECT id FROM organizations WHERE is_default = true LIMIT 1),
  'Sprach-KI Cloud Standard',
  'Standard monthly cloud service quote for Voice AI agent',
  NULL,  -- inherits from organization
  NULL,  -- inherits from organization
  '{
    "conditions": "Dieses Angebot gilt vorbehaltlich technischer Realisierbarkeit. Von diesem Angebot ausgenommen sind alle Leistungen und Kosten, die im Angebot nicht ausgewiesen sind und für deren Verrechnung es keine explizite schriftliche Vereinbarung gibt.",
    "delivery": "Nach Auftragserteilung innerhalb von 14 Tagen.",
    "payment": "Laufende Gebühren werden im Vorhinein verrechnet. Overage Gebühren werden im Nachhinein verrechnet. Sekundengenaue Abrechnung ab der ersten Sekunde. Ein Upgrade Ihres Pakets ist jederzeit möglich. Bitte beachten Sie, dass nicht verbrauchte Minuten am Ende des Abrechnungszeitraums nicht ins nächste Monat übertragen werden. Alle Preisangaben in Euro Netto exklusive gesetzlicher Mehrwertsteuer.",
    "contract_duration": "Der Vertrag ist monatlich zum Stichtag kündbar, sodass Sie stets flexibel bleiben.",
    "acceptance": "Hiermit bestelle ich die im Angebot ausgewiesenen Leistungen. Ich habe die AGB gelesen, verstanden und akzeptiert."
  }'::jsonb,
  '[{
    "section": "Betrieb (laufend)",
    "article": "KI-CLOUD",
    "description": "Sprach-KI Agent Cloud Service Paket: Starter",
    "detail": "inklusive 420 Minuten. Overage nach 2000 Minuten: 0,30 € / min. Sekundengenau ab der ersten Sekunde abgerechnet.",
    "cycle": "p.m.",
    "quantity": 1,
    "unit": "Stück",
    "unit_price": 600,
    "discount_percent": 0
  }]'::jsonb,
  true, true,
  20, 14
);

-- ─── Add organization_id + template_id to quotes ───

ALTER TABLE quotes ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN template_id UUID REFERENCES quote_templates(id) ON DELETE SET NULL;

-- Set existing quotes to default organization
UPDATE quotes SET organization_id = (SELECT id FROM organizations WHERE is_default = true LIMIT 1);

CREATE INDEX quotes_org_idx ON quotes (organization_id);
CREATE INDEX quotes_template_idx ON quotes (template_id);

-- ─── Update sales agent with new tools ───

UPDATE agents SET
  skills = ARRAY[
    'quotes_create', 'quotes_get', 'quotes_list', 'quotes_update', 'quotes_add_item',
    'quotes_update_item', 'quotes_remove_item', 'quotes_recalculate', 'quotes_generate_pdf',
    'org_list', 'org_get', 'template_list', 'template_get',
    'contacts_search', 'contacts_get', 'contacts_list'
  ],
  system_prompt = $PROMPT$You are the JOI Sales Agent — responsible for creating professional quotes (Angebote) for itellico internet solutions gmbh and other organizations.

Your responsibilities:
1. Create quotes linked to contacts from the CRM
2. Use quote templates for consistent, pre-filled quotes
3. Add/modify line items with pricing, quantities, and descriptions
4. Generate professional PDF quotes with organization branding
5. Track quote status (draft → sent → accepted/declined/expired)

Workflow for creating a quote:
1. Use org_list or org_get to find the sending organization
2. Use template_list to find available templates for that org
3. Use contacts_search to find the recipient contact
4. Use quotes_create with organization_id, template_id, and contact_id
   → Template auto-populates intro, closing, terms, and default line items
5. Adjust items with quotes_add_item, quotes_update_item, quotes_remove_item
6. Use quotes_recalculate to verify totals
7. Preview with quotes_get, then generate PDF with quotes_generate_pdf

Company context (default org — itellico):
- Company: itellico internet solutions gmbh
- Address: Lindengasse 26/2+3, 1070 Wien
- Contact: Marcus Markowitsch, MBA (Geschäftsführer)
- Phone: +43.664.4245497
- Products: Sprach-KI (Voice AI) solutions, Cloud services, AI agents
- Currency: EUR, prices are Netto (excl. VAT)
- VAT: 20% Austrian USt
- Language: German (formal "Sie" form)

Templates auto-populate terms, items, and texts. Always use a template when one exists.
Quotes inherit organization branding (logo, address, bank details) automatically.$PROMPT$
WHERE id = 'sales';
