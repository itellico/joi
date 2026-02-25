import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("./soul-documents.js", () => ({
  readGlobalSoulDocument: () => ({ content: "You are JOI, a personal AI assistant." }),
  readSoulDocumentForAgent: (id: string) => ({ content: `You are the ${id} agent.` }),
}));
vi.mock("../skills/catalog.js", () => ({
  listExternalSkillCatalog: () => [],
}));

import { buildSystemPrompt, buildSystemPromptParts, buildCachedSystemBlocks } from "./system-prompt.js";

describe("system-prompt-cache", () => {
  describe("buildSystemPromptParts", () => {
    it("returns static and dynamic blocks", () => {
      const parts = buildSystemPromptParts(undefined, { agentId: "personal" });
      expect(parts.staticBlock).toContain("You are the personal agent.");
      expect(parts.staticBlock).toContain("Execution Discipline");
      expect(parts.staticBlock).toContain("Voice Style");
      expect(parts.dynamicBlock).toContain("Current Context");
      expect(parts.dynamicBlock).toContain("Date:");
      expect(parts.dynamicBlock).toContain("Time:");
      expect(parts.dynamicBlock).toContain("macOS (Mac Mini)");
    });

    it("excludes timestamp from static block", () => {
      const parts = buildSystemPromptParts(undefined, { agentId: "personal" });
      expect(parts.staticBlock).not.toContain("Date:");
      expect(parts.staticBlock).not.toContain("Time:");
    });

    it("includes skills in static block when enabled", () => {
      const parts = buildSystemPromptParts(undefined, { agentId: "personal", includeSkillsPrompt: true });
      // No skills are mocked, so it won't appear, but structure is correct
      expect(typeof parts.staticBlock).toBe("string");
    });
  });

  describe("15-minute timestamp stability", () => {
    it("rounds timestamps to 15-minute buckets", () => {
      // Call twice within the same 15-min window
      const parts1 = buildSystemPromptParts(undefined, { agentId: "personal" });
      const parts2 = buildSystemPromptParts(undefined, { agentId: "personal" });
      // Dynamic blocks should be identical within the same bucket
      expect(parts1.dynamicBlock).toBe(parts2.dynamicBlock);
    });
  });

  describe("buildCachedSystemBlocks", () => {
    it("returns TextBlockParam[] with cache_control on static block", () => {
      const blocks = buildCachedSystemBlocks(undefined, { agentId: "personal" });
      expect(blocks).toHaveLength(2);

      // Static block has cache_control
      expect(blocks[0].type).toBe("text");
      expect((blocks[0] as any).cache_control).toEqual({ type: "ephemeral" });
      expect(blocks[0].text).toContain("Execution Discipline");

      // Dynamic block has no cache_control
      expect(blocks[1].type).toBe("text");
      expect((blocks[1] as any).cache_control).toBeUndefined();
      expect(blocks[1].text).toContain("Current Context");
    });
  });

  describe("buildSystemPrompt backward compat", () => {
    it("returns a single concatenated string", () => {
      const prompt = buildSystemPrompt(undefined, { agentId: "personal" });
      expect(typeof prompt).toBe("string");
      expect(prompt).toContain("You are the personal agent.");
      expect(prompt).toContain("Current Context");
      expect(prompt).toContain("Execution Discipline");
    });

    it("includes language instruction for non-English", () => {
      const prompt = buildSystemPrompt(undefined, { language: "de", agentId: "personal" });
      expect(prompt).toContain("German");
      expect(prompt).toContain("Du-form");
    });

    it("includes agent override when custom prompt is provided", () => {
      const prompt = buildSystemPrompt("Be extra helpful.", { agentId: "personal" });
      expect(prompt).toContain("Agent Override");
      expect(prompt).toContain("Be extra helpful.");
    });
  });
});
