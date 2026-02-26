import { describe, expect, it } from "vitest";
import { normalizeExecutionMode, parseLatencyProfile } from "./execution-mode.js";

describe("execution mode helpers", () => {
  it("normalizes valid execution modes", () => {
    expect(normalizeExecutionMode("live")).toBe("live");
    expect(normalizeExecutionMode("shadow")).toBe("shadow");
    expect(normalizeExecutionMode("dry_run")).toBe("dry_run");
    expect(normalizeExecutionMode("DRY RUN")).toBe("dry_run");
  });

  it("falls back for unknown execution modes", () => {
    expect(normalizeExecutionMode("invalid", "shadow")).toBe("shadow");
    expect(normalizeExecutionMode(undefined, "live")).toBe("live");
  });

  it("parses and clamps latency profile values", () => {
    const profile = parseLatencyProfile({
      toolMinMs: 120,
      toolMaxMs: 280,
      responseMinMs: 400,
      responseMaxMs: 900,
      jitterMs: 45,
    });

    expect(profile).toEqual({
      toolMinMs: 120,
      toolMaxMs: 280,
      responseMinMs: 400,
      responseMaxMs: 900,
      jitterMs: 45,
    });
  });

  it("returns undefined for empty latency profile", () => {
    expect(parseLatencyProfile(undefined)).toBeUndefined();
    expect(parseLatencyProfile({})).toBeUndefined();
    expect(parseLatencyProfile({ toolMinMs: "fast" })).toBeUndefined();
  });
});
