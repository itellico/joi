-- Phase 2+3: Accounting tables + Review Queue (Human-in-the-Loop)

-- ─── Review Queue (generic HITL for any agent) ───

CREATE TABLE IF NOT EXISTS review_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  conversation_id TEXT,

  -- What to review
  type            TEXT NOT NULL,        -- approve | classify | match | select | verify | freeform
  title           TEXT NOT NULL,
  description     TEXT,

  -- Content to display (array of typed content blocks)
  content         JSONB NOT NULL DEFAULT '[]',

  -- Agent's proposal
  proposed_action JSONB,
  alternatives    JSONB,

  -- Human response
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | modified
  resolution      JSONB,
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,

  -- Organization
  priority        INTEGER DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  tags            TEXT[],
  batch_id        TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_agent ON review_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_batch ON review_queue(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_queue_created ON review_queue(created_at DESC);

-- ─── Invoices (extracted from PDFs by processor agent) ───

CREATE TABLE IF NOT EXISTS invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor                  TEXT NOT NULL,
  amount                  DECIMAL(12,2),
  currency                TEXT DEFAULT 'EUR',
  invoice_date            DATE,
  invoice_number          TEXT,
  source_file             TEXT,               -- Google Drive file ID or path
  source_email_id         TEXT,               -- Gmail message ID (if from email)
  bmd_folder              TEXT,               -- classified target folder
  payment_method          TEXT,               -- bar | bank | cc | paypal | stripe
  status                  TEXT DEFAULT 'pending',  -- pending | classified | matched | uploaded | error
  matched_transaction_id  UUID,
  review_id               UUID REFERENCES review_queue(id),
  metadata                JSONB,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_bmd_folder ON invoices(bmd_folder) WHERE bmd_folder IS NOT NULL;

-- ─── Transactions (from George bank/CC export CSVs) ───

CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account             TEXT NOT NULL,          -- IBAN or CC number (masked)
  account_type        TEXT,                   -- giro | creditcard | bankcard
  booking_date        DATE,
  value_date          DATE,
  amount              DECIMAL(12,2),
  currency            TEXT DEFAULT 'EUR',
  description         TEXT,                   -- raw description from bank
  counterparty        TEXT,                   -- Auftraggeber/Empfänger
  vendor_normalized   TEXT,                   -- cleaned/matched vendor name
  reference           TEXT,                   -- bank reference
  source_file         TEXT,                   -- CSV file path
  matched_invoice_id  UUID REFERENCES invoices(id),
  match_confidence    DECIMAL(3,2),           -- 0.00 to 1.00
  review_id           UUID REFERENCES review_queue(id),
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(booking_date);
CREATE INDEX IF NOT EXISTS idx_transactions_matched ON transactions(matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_unmatched ON transactions(matched_invoice_id) WHERE matched_invoice_id IS NULL;

-- ─── Reconciliation Runs (monthly matching summaries) ───

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month               TEXT NOT NULL,            -- '2026-01'
  status              TEXT DEFAULT 'running',   -- running | completed | needs_review
  total_transactions  INTEGER DEFAULT 0,
  matched             INTEGER DEFAULT 0,
  unmatched           INTEGER DEFAULT 0,
  missing_invoices    INTEGER DEFAULT 0,
  orphan_invoices     INTEGER DEFAULT 0,
  report              JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recon_runs_month ON reconciliation_runs(month);

-- ─── Accounting agent entries ───

INSERT INTO agents (id, name, description, model, enabled, config) VALUES
  ('accounting-orchestrator', 'Accounting Orchestrator',
   'Coordinates the monthly accounting pipeline: collect → classify → reconcile → upload',
   'claude-sonnet-4-20250514', true,
   '{"maxSpawnDepth": 2, "role": "orchestrator"}'::jsonb),

  ('invoice-collector', 'Invoice Collector',
   'Scans Gmail for invoice emails, downloads PDF attachments, normalizes non-PDF formats, uploads to Google Drive',
   'claude-haiku-4-5-20251001', true,
   '{"role": "collector"}'::jsonb),

  ('invoice-processor', 'Invoice Processor',
   'Extracts data from invoice PDFs (vendor, amount, currency, date), classifies into BMD folders using vendor table and payment method rules',
   'claude-sonnet-4-20250514', true,
   '{"role": "processor"}'::jsonb),

  ('reconciliation', 'Reconciliation Agent',
   'Matches bank/CC transactions from George export against classified invoices. Auto-matches high-confidence, sends low-confidence to review queue',
   'claude-sonnet-4-20250514', true,
   '{"role": "reconciliation"}'::jsonb),

  ('bmd-uploader', 'BMD Uploader',
   'Uploads classified invoices to the correct BMD folder via Playwright browser automation',
   'claude-haiku-4-5-20251001', true,
   '{"role": "uploader"}'::jsonb)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  model = EXCLUDED.model,
  config = EXCLUDED.config;
