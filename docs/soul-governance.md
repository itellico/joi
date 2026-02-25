# Soul Governance (JOI)

Updated: 2026-02-23

## Goal

Guarantee that every enabled agent has a structured soul document, version history, quality linkage, and safe rollout lifecycle.

## Lifecycle

1. Draft/propose:
- Source: Agent Social or Agents UI (`/api/soul/:agentId/propose`)
- Requires schema validation (`/api/soul/validate`)
- Creates review item (`review_queue.type = soul_update`)

2. Review approval:
- On `review.resolve` (approved/modified), gateway applies soul update via `applySoulReviewResolution`.
- Quality gate runs when configured (`runSoulQualityGate` + suite binding).

3. Versioning:
- All applied updates create immutable rows in `soul_versions`.
- Active uniqueness is enforced by DB + advisory lock.

4. Rollout:
- Default mode: canary rollout (`soul_rollouts.status = canary_active`).
- Candidate version is inactive during canary.
- Baseline remains active until promotion.

5. Promotion/rollback:
- Evaluation compares candidate window vs baseline window using:
  - review reject-rate delta
  - QA failure-rate delta
  - high-severity incident count
- Outcomes:
  - promote: candidate becomes active, soul file is synchronized
  - rollback: baseline restored active, soul file synchronized
  - pending: keep canary active

## Runtime injection

- `runAgent` resolves soul content per conversation via deterministic bucket assignment:
  - `bucket = hash(agentId + conversationId) % 100`
  - if `bucket < traffic_percent` -> candidate soul
  - else -> baseline soul
- Selection is persisted in `conversations.metadata.soul`.

## API surface

- Policy and schema:
  - `GET /api/soul/schema`
  - `GET /api/soul/policy`
  - `POST /api/soul/validate`

- Governance:
  - `GET /api/soul/governance/summary`
  - `GET /api/soul/rollouts`
  - `POST /api/soul/rollouts/:rolloutId/evaluate`
  - `POST /api/soul/rollouts/:rolloutId/promote`
  - `POST /api/soul/rollouts/:rolloutId/rollback`
  - `POST /api/soul/rollouts/:rolloutId/cancel`
  - `POST /api/soul/rollouts/evaluate-all`

- Per-agent:
  - `GET /api/soul/:agentId` (includes `activeRollout`)
  - `GET /api/soul/:agentId/versions` (includes `activeRollout`)
  - `PUT /api/soul/:agentId` (direct update; cancels active rollout)
  - `POST /api/soul/:agentId/rollback` (direct rollback; cancels active rollout)

## Quality coupling

- Soul quality suites are expected per enabled agent.
- `createIssuesFromRun` now enriches soul-related failures with soul section tags:
  - `soul:identity`
  - `soul:mission`
  - `soul:values`
  - `soul:boundaries`
  - `soul:decision-policy`
  - `soul:collaboration`
  - `soul:learning-loop`
  - `soul:success-metrics`

## Operations automation

Built-in cron jobs:

- Weekly rollout evaluation:
  - `evaluate_soul_rollouts_weekly`
  - `system_event = evaluate_soul_rollouts`

- Monthly governance report:
  - `soul_governance_monthly_review`
  - `system_event = soul_governance_review`
  - creates an info review item with governance snapshot

## UI

- Agents:
  - Soul tab now shows active canary status and sampling progress.
- Agent Social:
  - Soul is now read-only preview in social profile edit.
  - All soul editing/proposal actions route through Agents unified admin.

- Quality Center:
  - New “Soul Governance” tab with:
    - active/overdue/open soul issue cards
    - coverage metrics
    - rollout table
    - evaluate-all / per-rollout actions
