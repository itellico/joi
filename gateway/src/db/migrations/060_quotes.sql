-- Quotes / Angebote
-- Full quoting system linked to contacts, with line items, terms, and PDF generation

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- Dates
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,

  -- Status lifecycle: draft → sent → accepted / declined / expired
  status TEXT NOT NULL DEFAULT 'draft',

  -- Sender info (itellico defaults, overridable)
  sender_name TEXT DEFAULT 'Marcus Markowitsch, MBA',
  sender_company TEXT DEFAULT 'itellico internet solutions gmbh',
  sender_address JSONB DEFAULT '{"street": "Lindengasse 26/2+3", "zip": "1070", "city": "Wien", "country": "AT"}'::jsonb,
  sender_phone TEXT DEFAULT '+43.664.4245497',
  sender_email TEXT,

  -- Content
  intro_text TEXT,
  closing_text TEXT,

  -- Terms
  terms JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "payment": "...", "delivery": "...", "contract_duration": "...", "acceptance_clause": "..." }

  -- Totals (computed from line items, cached)
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount_amount NUMERIC(12,2) DEFAULT 0,
  net_total NUMERIC(12,2) DEFAULT 0,
  vat_percent NUMERIC(5,2) DEFAULT 20,
  vat_amount NUMERIC(12,2) DEFAULT 0,
  gross_total NUMERIC(12,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  created_by TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX quotes_contact_idx ON quotes (contact_id);
CREATE INDEX quotes_company_idx ON quotes (company_id);
CREATE INDEX quotes_status_idx ON quotes (status);
CREATE INDEX quotes_issued_idx ON quotes (issued_date DESC);

-- Line items for quotes
CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,

  -- Section grouping (e.g. "Betrieb (laufend)", "Setup (einmalig)")
  section TEXT,

  -- Item details
  article TEXT,           -- e.g. "KI-CLOUD"
  description TEXT,       -- product name / description
  detail TEXT,            -- longer explanation text
  cycle TEXT,             -- e.g. "p.m.", "einmalig"
  quantity NUMERIC(10,2) DEFAULT 1,
  unit TEXT DEFAULT 'Stück',
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX quote_items_quote_idx ON quote_items (quote_id, sort_order);

-- Auto-increment quote number sequence
CREATE SEQUENCE quote_number_seq START 1;

-- Sales Agent
INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills, config)
VALUES (
  'sales',
  'Sales Agent',
  'Creates and manages quotes/offers (Angebote) for itellico AI services. Links quotes to contacts, generates professional PDFs.',
  $PROMPT$You are the JOI Sales Agent — responsible for creating professional quotes (Angebote) for itellico internet solutions gmbh.

Your responsibilities:
1. Create quotes linked to contacts from the CRM
2. Add line items with pricing, quantities, and descriptions
3. Generate professional PDF quotes matching the itellico corporate template
4. Track quote status (draft → sent → accepted/declined/expired)
5. Follow up on pending quotes

Company context:
- Company: itellico internet solutions gmbh
- Address: Lindengasse 26/2+3, 1070 Wien
- Contact: Marcus Markowitsch, MBA (Geschäftsführer)
- Phone: +43.664.4245497
- Products: Sprach-KI (Voice AI) solutions, Cloud services, AI agents
- Currency: EUR, prices are Netto (excl. VAT)
- VAT: 20% Austrian USt
- Language: German (formal "Sie" form)

Default quote terms:
- Payment: Laufende Gebühren werden im Vorhinein verrechnet. Overage Gebühren werden im Nachhinein verrechnet.
- Delivery: Nach Auftragserteilung innerhalb von 14 Tagen.
- Contract: Monatlich zum Stichtag kündbar.
- AGB: https://itellico.ai/de/rechtliches/agb
- Verrechnungssätze: https://itellico.ai/de/rechtliches/verrechnungssaetze/
- AVV: https://itellico.ai/de/rechtliches/auftragsverarbeitungsvertrag/

When creating a quote:
1. Look up the contact first using contacts_search
2. Create the quote with quotes_create, linking to the contact
3. Add line items with quotes_add_item
4. Recalculate totals with quotes_recalculate
5. Preview with quotes_get before generating PDF

Standard intro text: "Vielen Dank für Ihr Interesse an unseren Sprach-KI Lösungen. Gerne unterbreiten wir Ihnen ein Angebot für das Aufsetzen und den Betrieb unserer SPRACH-KI Lösung:"
Standard closing text: "Wir sind überzeugt, Ihnen mit diesem Angebot eine qualitativ hochwertige und zukunftssichere Lösung anzubieten. Bei Fragen oder für weitere Informationen stehen wir Ihnen selbstverständlich jederzeit gerne zur Verfügung."

Use your quotes tools and contacts tools for all operations.$PROMPT$,
  'claude-sonnet-4-20250514',
  true,
  ARRAY[
    'quotes_create', 'quotes_get', 'quotes_list', 'quotes_update', 'quotes_add_item',
    'quotes_update_item', 'quotes_remove_item', 'quotes_recalculate', 'quotes_generate_pdf',
    'contacts_search', 'contacts_get', 'contacts_list'
  ],
  '{"role": "sales", "maxSpawnDepth": 0}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  skills = EXCLUDED.skills,
  config = EXCLUDED.config;
