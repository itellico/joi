import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB client before importing the module under test
vi.mock("../db/client.js", () => ({
  query: vi.fn(),
}));

import { routeIntent, _clearAgentStatusCache } from "./intent-router.js";
import { query } from "../db/client.js";

const mockQuery = vi.mocked(query);

describe("intent-router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _clearAgentStatusCache();
    // Default: agent exists and is enabled
    mockQuery.mockResolvedValue({ rows: [{ id: "media-integrations", enabled: true, name: "Media Integrations" }], rowCount: 1 } as any);
  });

  describe("feature gate", () => {
    it("returns feature_disabled when JOI_INTENT_ROUTER is not set", async () => {
      delete process.env.JOI_INTENT_ROUTER;
      const result = await routeIntent("show me my movies");
      expect(result.routed).toBe(false);
      expect((result as any).reason).toBe("feature_disabled");
    });

    it("routes when JOI_INTENT_ROUTER=1", async () => {
      process.env.JOI_INTENT_ROUTER = "1";
      const result = await routeIntent("show me my movies");
      expect(result.routed).toBe(true);
    });
  });

  describe("user override protection", () => {
    it("does NOT route when user selected a non-personal agent", async () => {
      process.env.JOI_INTENT_ROUTER = "1";
      const result = await routeIntent("show me my movies", "coder");
      expect(result.routed).toBe(false);
      expect((result as any).reason).toBe("user_override");
    });

    it("routes when agentId is personal", async () => {
      process.env.JOI_INTENT_ROUTER = "1";
      const result = await routeIntent("check my movies", "personal");
      expect(result.routed).toBe(true);
    });

    it("routes when agentId is absent", async () => {
      process.env.JOI_INTENT_ROUTER = "1";
      const result = await routeIntent("search for jim carrey movies");
      expect(result.routed).toBe(true);
    });
  });

  describe("media routing", () => {
    beforeEach(() => {
      process.env.JOI_INTENT_ROUTER = "1";
    });

    it("routes media keywords to media-integrations", async () => {
      const queries = [
        "check for my jim carrey movies",
        "search emby for batman",
        "what movies do I have",
        "check my watchlist",
        "find the series breaking bad",
        "what am I watching",
        "what films do I have",
      ];
      for (const q of queries) {
        const result = await routeIntent(q);
        expect(result.routed, `Expected "${q}" to route`).toBe(true);
        if (result.routed) {
          expect(result.agentId).toBe("media-integrations");
          expect(result.confidence).toBeGreaterThanOrEqual(0.8);
          expect(result.executionProfile.includeSkillsPrompt).toBe(false);
          expect(result.executionProfile.includeMemoryContext).toBe(false);
        }
      }
    });
  });

  describe("email routing", () => {
    beforeEach(() => {
      process.env.JOI_INTENT_ROUTER = "1";
      mockQuery.mockResolvedValue({ rows: [{ id: "email", enabled: true, name: "Email" }], rowCount: 1 } as any);
    });

    it("routes email keywords to email agent", async () => {
      const queries = [
        "check my email",
        "show my inbox",
        "send an email to john",
        "any unread emails?",
      ];
      for (const q of queries) {
        const result = await routeIntent(q);
        expect(result.routed, `Expected "${q}" to route`).toBe(true);
        if (result.routed) {
          expect(result.agentId).toBe("email");
          expect(result.executionProfile.includeMemoryContext).toBe(true);
        }
      }
    });
  });

  describe("no match", () => {
    beforeEach(() => {
      process.env.JOI_INTENT_ROUTER = "1";
    });

    it("does not route general questions", async () => {
      const queries = [
        "what is the weather today",
        "tell me a joke",
        "how are you",
        "what time is it",
      ];
      for (const q of queries) {
        const result = await routeIntent(q);
        expect(result.routed, `Expected "${q}" NOT to route`).toBe(false);
      }
    });
  });

  describe("target validation", () => {
    beforeEach(() => {
      process.env.JOI_INTENT_ROUTER = "1";
    });

    it("returns target_missing when agent does not exist", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
      const result = await routeIntent("find my movies");
      expect(result.routed).toBe(false);
      expect((result as any).reason).toBe("target_missing");
      expect((result as any).attemptedAgentId).toBe("media-integrations");
    });

    it("returns target_disabled when agent is disabled", async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: "media-integrations", enabled: false, name: "Media Integrations" }], rowCount: 1 } as any);
      const result = await routeIntent("find my movies");
      expect(result.routed).toBe(false);
      expect((result as any).reason).toBe("target_disabled");
    });
  });
});
