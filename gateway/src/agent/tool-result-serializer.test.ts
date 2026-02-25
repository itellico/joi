import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { summarizeToolResult } from "./runtime.js";

describe("tool-result-serializer", () => {
  beforeEach(() => {
    process.env.JOI_TOOL_RESULT_SUMMARY = "1";
  });

  afterEach(() => {
    delete process.env.JOI_TOOL_RESULT_SUMMARY;
  });

  describe("feature gate", () => {
    it("returns original when feature is disabled", () => {
      delete process.env.JOI_TOOL_RESULT_SUMMARY;
      const bigResult = JSON.stringify({ count: 100, items: Array(50).fill({ id: 1, name: "test", genres: ["action"], cast: ["actor"] }) });
      expect(summarizeToolResult("emby_search", bigResult)).toBe(bigResult);
    });
  });

  describe("emby envelope handling", () => {
    it("summarizes envelope-style results with nested page metadata", () => {
      const input = JSON.stringify({
        server: { id: "srv1", name: "Emby" },
        query: "matrix",
        compact: true,
        count: 3,
        page: {
          startIndex: 0,
          limit: 50,
          returned: 3,
          hasMore: false,
        },
        items: [
          { id: "123", name: "The Matrix", type: "Movie", year: 1999, communityRating: 8.7, genres: ["Sci-Fi", "Action"], cast: ["Keanu Reeves"], directors: ["Wachowskis"], imageUrl: "http://example.com/img.jpg", played: true, playCount: 5 },
          { id: "456", name: "Inception", type: "Movie", year: 2010, communityRating: 8.8, genres: ["Sci-Fi"], cast: ["Leo"], directors: ["Nolan"], imageUrl: "http://example.com/img2.jpg" },
          { id: "789", name: "Breaking Bad", type: "Series", year: 2008, communityRating: 9.5, genres: ["Drama"], cast: ["Bryan Cranston"] },
        ],
      });

      const result = summarizeToolResult("emby_search", input);
      const parsed = JSON.parse(result);

      // Envelope metadata preserved
      expect(parsed.count).toBe(3);
      expect(parsed.page.returned).toBe(3);
      expect(parsed.page.hasMore).toBe(false);

      // Items summarized to essential fields only
      expect(parsed.items).toHaveLength(3);
      expect(parsed.items[0]).toEqual({ id: "123", name: "The Matrix", type: "Movie", year: 1999, communityRating: 8.7 });
      expect(parsed.items[1]).toEqual({ id: "456", name: "Inception", type: "Movie", year: 2010, communityRating: 8.8 });

      // Stripped fields
      expect(parsed.items[0].genres).toBeUndefined();
      expect(parsed.items[0].cast).toBeUndefined();
      expect(parsed.items[0].directors).toBeUndefined();
      expect(parsed.items[0].imageUrl).toBeUndefined();
      expect(parsed.items[0].played).toBeUndefined();
      expect(parsed.compact).toBeUndefined();
      expect(parsed.server).toBeUndefined(); // server metadata stripped
    });

    it("handles emby_library tool with nested page", () => {
      const input = JSON.stringify({
        count: 1,
        page: { returned: 1, hasMore: false },
        items: [{ id: "1", name: "Movie Library", type: "CollectionFolder" }],
      });
      const result = summarizeToolResult("emby_library", input);
      const parsed = JSON.parse(result);
      expect(parsed.items[0]).toEqual({ id: "1", name: "Movie Library", type: "CollectionFolder" });
      expect(parsed.page.returned).toBe(1);
    });

    it("handles emby_recently_watched tool", () => {
      const input = JSON.stringify({
        count: 2,
        page: { returned: 2, hasMore: false },
        items: [
          { id: "a", name: "Die Hard", type: "Movie", year: 1988, communityRating: 8.2, extra: "data" },
          { id: "b", name: "Home Alone", type: "Movie", year: 1990, extra: "more" },
        ],
      });
      const result = summarizeToolResult("emby_recently_watched", input);
      const parsed = JSON.parse(result);
      expect(parsed.items[0].extra).toBeUndefined();
      expect(parsed.items[0].id).toBe("a");
    });

    it("handles envelope without page sub-object gracefully", () => {
      // Some tools might return flat envelope without page nesting
      const input = JSON.stringify({
        count: 1,
        items: [{ id: "x", name: "Test", type: "Movie" }],
      });
      const result = summarizeToolResult("emby_search", input);
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(1);
      expect(parsed.page).toBeUndefined();
      expect(parsed.items[0]).toEqual({ id: "x", name: "Test", type: "Movie" });
    });
  });

  describe("non-emby tools", () => {
    it("passes through non-emby tool results unchanged", () => {
      const input = JSON.stringify({ result: "contact found", name: "John" });
      expect(summarizeToolResult("contacts_search", input)).toBe(input);
    });
  });

  describe("hard cap fallback", () => {
    it("truncates very large non-emby results", () => {
      const huge = "x".repeat(5000);
      const result = summarizeToolResult("some_other_tool", huge);
      expect(result.length).toBeLessThan(5000);
      expect(result).toContain("[truncated");
    });

    it("truncates large non-JSON emby results", () => {
      const huge = "not json " + "x".repeat(5000);
      const result = summarizeToolResult("emby_search", huge);
      expect(result.length).toBeLessThan(5500);
      expect(result).toContain("[truncated");
    });
  });

  describe("edge cases", () => {
    it("handles empty items array", () => {
      const input = JSON.stringify({ count: 0, page: { returned: 0, hasMore: false }, items: [] });
      const result = summarizeToolResult("emby_search", input);
      const parsed = JSON.parse(result);
      expect(parsed.items).toEqual([]);
      expect(parsed.count).toBe(0);
    });

    it("handles non-object items in array", () => {
      const input = JSON.stringify({ count: 1, items: ["just a string"] });
      const result = summarizeToolResult("emby_search", input);
      // Should not crash — items that aren't objects get slimmed to empty
      const parsed = JSON.parse(result);
      expect(parsed.items).toHaveLength(1);
    });
  });
});
