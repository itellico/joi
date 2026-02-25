import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  transaction: (...args: unknown[]) => transactionMock(...args),
}));

import { ensureSoulVersion } from "./soul-versions.js";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function soulVersionRow(params: {
  id: string;
  agentId: string;
  content: string;
  contentHash: string;
}) {
  return {
    id: params.id,
    agent_id: params.agentId,
    content: params.content,
    content_hash: params.contentHash,
    source: "manual",
    author: "human",
    review_id: null,
    quality_run_id: null,
    quality_status: "not_run",
    change_summary: null,
    parent_version_id: null,
    is_active: true,
    activated_at: new Date().toISOString(),
    metadata: {},
    created_at: new Date().toISOString(),
  };
}

describe("soul-versions ensureSoulVersion", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("returns active version without write when content hash already matches", async () => {
    const content = "same-content";
    const active = soulVersionRow({
      id: "v-active",
      agentId: "app-dev",
      content,
      contentHash: hash(content),
    });

    queryMock.mockResolvedValueOnce({ rows: [active] });

    const result = await ensureSoulVersion("app-dev", content);
    expect(result.id).toBe("v-active");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("recovers from active-version unique race and returns winner", async () => {
    const current = soulVersionRow({
      id: "v-current",
      agentId: "app-dev",
      content: "old",
      contentHash: hash("old"),
    });
    const winner = soulVersionRow({
      id: "v-winner",
      agentId: "app-dev",
      content: "new-content",
      contentHash: hash("new-content"),
    });

    queryMock
      .mockResolvedValueOnce({ rows: [current] }) // initial getActiveSoulVersion
      .mockResolvedValueOnce({ rows: [winner] }); // retry getActiveSoulVersion after conflict

    transactionMock.mockRejectedValueOnce({
      code: "23505",
      constraint: "idx_soul_versions_active_unique",
    });

    const result = await ensureSoulVersion("app-dev", "new-content");
    expect(result.id).toBe("v-winner");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
