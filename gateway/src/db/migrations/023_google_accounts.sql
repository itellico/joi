-- Google Accounts: multi-account OAuth2 token storage
-- Replaces file-based google-token.json with DB-backed per-account tokens

CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,                     -- slug like 'personal', 'work'
  email         TEXT,                                 -- populated from Google userinfo after OAuth
  display_name  TEXT NOT NULL,
  tokens        JSONB DEFAULT '{}',                   -- OAuth2 tokens (access_token, refresh_token, etc.)
  scopes        TEXT[] DEFAULT '{}',
  is_default    BOOLEAN DEFAULT false,
  status        TEXT DEFAULT 'pending'                -- pending | connected | error
                  CHECK (status IN ('pending', 'connected', 'error')),
  error_message TEXT,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure at most one default account
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_accounts_default
  ON google_accounts (is_default) WHERE is_default = true;
