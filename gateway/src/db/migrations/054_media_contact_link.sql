-- Link media to contacts via contact_id FK
-- Also backfill existing media by matching sender_id to contact channel identifiers

ALTER TABLE media ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_contact_id ON media(contact_id);

-- Backfill: match Telegram sender_id → contacts.telegram_id
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'telegram'
  AND m.sender_id IS NOT NULL
  AND m.sender_id = c.telegram_id;

-- Backfill: match Telegram sender_id → contacts.telegram_username (some channels use username)
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'telegram'
  AND m.sender_id IS NOT NULL
  AND LOWER(m.sender_id) = LOWER(c.telegram_username);

-- Backfill: match Slack sender_id → contacts.slack_handle
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'slack'
  AND m.sender_id IS NOT NULL
  AND m.sender_id = c.slack_handle;

-- Backfill: match Email sender_id → contacts.emails array
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'email'
  AND m.sender_id IS NOT NULL
  AND LOWER(m.sender_id) = ANY(SELECT LOWER(unnest(c.emails)));

-- Backfill: match iMessage sender_id (phone/email) → contacts.phones or emails
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'imessage'
  AND m.sender_id IS NOT NULL
  AND (
    m.sender_id = ANY(c.phones)
    OR LOWER(m.sender_id) = ANY(SELECT LOWER(unnest(c.emails)))
  );

-- Backfill: match WhatsApp sender_id (phone-based) → contacts.phones
-- WhatsApp sender_id is typically phone@s.whatsapp.net, strip the suffix
UPDATE media m
SET contact_id = c.id
FROM contacts c
WHERE m.contact_id IS NULL
  AND m.channel_type = 'whatsapp'
  AND m.sender_id IS NOT NULL
  AND REPLACE(SPLIT_PART(m.sender_id, '@', 1), '+', '') = ANY(
    SELECT REPLACE(REPLACE(REPLACE(REPLACE(unnest(c.phones), ' ', ''), '-', ''), '(', ''), ')', '')
  );
