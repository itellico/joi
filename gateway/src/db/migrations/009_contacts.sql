-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  industry TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  obsidian_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX companies_name_idx ON companies (LOWER(name));

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  nickname TEXT,
  emails TEXT[] DEFAULT '{}',
  phones TEXT[] DEFAULT '{}',
  company_id UUID REFERENCES companies(id),
  job_title TEXT,
  birthday DATE,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active',
  telegram_username TEXT,
  telegram_id TEXT,
  slack_handle TEXT,
  notes TEXT,
  obsidian_path TEXT,
  avatar_url TEXT,
  source TEXT,
  address JSONB,
  social_profiles JSONB,
  extra JSONB DEFAULT '{}',
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX contacts_company_idx ON contacts (company_id);
CREATE INDEX contacts_status_idx ON contacts (status);
CREATE INDEX contacts_last_name_idx ON contacts (LOWER(last_name));

-- Contact Interactions (communication log)
CREATE TABLE contact_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  direction TEXT,
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX interactions_contact_idx ON contact_interactions (contact_id);
CREATE INDEX interactions_date_idx ON contact_interactions (occurred_at DESC);
