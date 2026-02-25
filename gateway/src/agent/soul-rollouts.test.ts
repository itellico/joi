import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const transactionMock = vi.fn();
const writeAgentSoulDocumentMock = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  transaction: (...args: unknown[]) => transactionMock(...args),
}));

vi.mock("./soul-documents.js", () => ({
  writeAgentSoulDocument: (...args: unknown[]) => writeAgentSoulDocumentMock(...args),
}));

import {
  chooseSoulForConversation,
  evaluateSoulRollout,
  promoteSoulRollout,
  rollbackSoulRollout,
} from "./soul-rollouts.js";

const BASE_ROLLOUT_ROW = {
  id: "rollout-1",
  agent_id: "app-dev",
  candidate_version_id: "candidate-v1",
  baseline_version_id: "baseline-v1",
  status: "canary_active",
  traffic_percent: 10,
  minimum_sample_size: 20,
  metrics: {},
  metadata: {},
  decision_reason: null,
  started_at: "2026-02-20T10:00:00.000Z",
  evaluated_at: null,
  ended_at: null,
  created_at: "2026-02-20T10:00:00.000Z",
  candidate_content: "candidate soul",
  baseline_content: "baseline soul",
  candidate_is_active: false,
  baseline_is_active: true,
  candidate_quality_status: "passed",
  baseline_quality_status: "passed",
};

describe("soul-rollouts selection", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    writeAgentSoulDocumentMock.mockReset();
  });

  it("assigns deterministic bucket/track for same conversation", async () => {
    queryMock.mockResolvedValue({ rows: [{ ...BASE_ROLLOUT_ROW, traffic_percent: 50 }] });

    const a = await chooseSoulForConversation({
      agentId: "app-dev",
      conversationId: "conv-123",
      fallbackContent: "fallback",
    });
    const b = await chooseSoulForConversation({
      agentId: "app-dev",
      conversationId: "conv-123",
      fallbackContent: "fallback",
    });

    expect(a.bucket).toBe(b.bucket);
    expect(a.selectedTrack).toBe(b.selectedTrack);
    expect(a.selectedVersionId).toBe(b.selectedVersionId);
    expect(a.rolloutId).toBe("rollout-1");
  });
});

describe("soul-rollouts transitions", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    writeAgentSoulDocumentMock.mockReset();
  });

  it("evaluates rollout and returns rollback decision when incident threshold is breached", async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM soul_rollouts r") && sql.includes("WHERE r.id = $1") && !sql.includes("FOR UPDATE")) {
        return { rows: [{ ...BASE_ROLLOUT_ROW }] };
      }
      if (sql.includes("FROM conversations")) {
        return { rows: [{ sample_size: 28, candidate_samples: 3, baseline_samples: 25 }] };
      }
      if (sql.includes("FROM review_queue")) {
        const isBaselineWindow = (params || []).length >= 3;
        return {
          rows: [{
            rejected: isBaselineWindow ? 1 : 0,
            total: isBaselineWindow ? 20 : 12,
          }],
        };
      }
      if (sql.includes("FROM qa_test_runs")) {
        return { rows: [{ failed_cases: 0, total_cases: 40 }] };
      }
      if (sql.includes("FROM qa_issues")) {
        return { rows: [{ count: 2 }] };
      }
      if (sql.includes("UPDATE soul_rollouts") && sql.includes("SET metrics =")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in evaluate test: ${sql}`);
    });

    const result = await evaluateSoulRollout("rollout-1", { applyDecision: false });
    expect(result.decision).toBe("rollback");
    expect(result.applied).toBe(false);
    expect(result.metrics.highSeverityIncidents).toBe(2);
  });

  it("promotes rollout and syncs candidate soul document", async () => {
    transactionMock.mockImplementation(async (fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
      const client = {
        query: async (sql: string) => {
          if (sql.includes("FROM soul_rollouts r") && sql.includes("FOR UPDATE")) {
            return { rows: [{ ...BASE_ROLLOUT_ROW }] };
          }
          if (sql.includes("UPDATE soul_rollouts") && sql.includes("RETURNING *")) {
            return { rows: [{ ...BASE_ROLLOUT_ROW, status: "promoted", ended_at: "2026-02-20T11:00:00.000Z" }] };
          }
          return { rows: [] };
        },
      };
      return fn(client);
    });

    const promoted = await promoteSoulRollout("rollout-1", "manual promote");
    expect(promoted.status).toBe("promoted");
    expect(writeAgentSoulDocumentMock).toHaveBeenCalledWith("app-dev", "candidate soul");
  });

  it("rolls back rollout and syncs baseline soul document", async () => {
    transactionMock.mockImplementation(async (fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
      const client = {
        query: async (sql: string) => {
          if (sql.includes("FROM soul_rollouts r") && sql.includes("FOR UPDATE")) {
            return { rows: [{ ...BASE_ROLLOUT_ROW }] };
          }
          if (sql.includes("UPDATE soul_rollouts") && sql.includes("RETURNING *")) {
            return { rows: [{ ...BASE_ROLLOUT_ROW, status: "rolled_back", ended_at: "2026-02-20T11:00:00.000Z" }] };
          }
          return { rows: [] };
        },
      };
      return fn(client);
    });

    const rolledBack = await rollbackSoulRollout("rollout-1", "manual rollback");
    expect(rolledBack.status).toBe("rolled_back");
    expect(writeAgentSoulDocumentMock).toHaveBeenCalledWith("app-dev", "baseline soul");
  });
});
