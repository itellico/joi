-- Soul governance: validation lifecycle, versioning, rollback traceability

CREATE TABLE IF NOT EXISTS soul_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  author TEXT NOT NULL DEFAULT 'system',
  review_id UUID REFERENCES review_queue(id) ON DELETE SET NULL,
  quality_run_id UUID REFERENCES qa_test_runs(id) ON DELETE SET NULL,
  quality_status TEXT NOT NULL DEFAULT 'not_run'
    CHECK (quality_status IN ('not_run', 'passed', 'failed')),
  change_summary TEXT,
  parent_version_id UUID REFERENCES soul_versions(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soul_versions_agent_created
  ON soul_versions(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soul_versions_review
  ON soul_versions(review_id)
  WHERE review_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_soul_versions_quality_run
  ON soul_versions(quality_run_id)
  WHERE quality_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_soul_versions_active_unique
  ON soul_versions(agent_id)
  WHERE is_active = true;
