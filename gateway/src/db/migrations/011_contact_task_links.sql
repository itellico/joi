-- Explicit contact ↔ Things3 task links (replaces weak name-based matching)
CREATE TABLE contact_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  things_task_uuid TEXT NOT NULL,
  linked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX contact_task_links_unique ON contact_task_links (contact_id, things_task_uuid);
CREATE INDEX contact_task_links_contact_idx ON contact_task_links (contact_id);
CREATE INDEX contact_task_links_task_idx ON contact_task_links (things_task_uuid);
