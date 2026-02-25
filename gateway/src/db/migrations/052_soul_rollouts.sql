-- Soul rollout orchestration (canary/promote/rollback)

CREATE TABLE IF NOT EXISTS soul_rollouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  candidate_version_id UUID NOT NULL REFERENCES soul_versions(id) ON DELETE CASCADE,
  baseline_version_id UUID REFERENCES soul_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'canary_active'
    CHECK (status IN ('canary_active', 'promoted', 'rolled_back', 'cancelled')),
  traffic_percent INT NOT NULL DEFAULT 10 CHECK (traffic_percent >= 1 AND traffic_percent <= 100),
  minimum_sample_size INT NOT NULL DEFAULT 20 CHECK (minimum_sample_size >= 1),
  metrics JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  decision_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soul_rollouts_agent_started
  ON soul_rollouts(agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_soul_rollouts_status
  ON soul_rollouts(status, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_soul_rollouts_agent_active
  ON soul_rollouts(agent_id)
  WHERE status = 'canary_active';
