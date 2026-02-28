import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-router.js", () => ({
  getModelClient: vi.fn(),
}));

vi.mock("./ollama-llm.js", () => ({
  ollamaChat: vi.fn(),
}));

import { classifyIntent } from "./intent-classifier.js";
import { getModelClient } from "./model-router.js";

const mockGetModelClient = vi.mocked(getModelClient);

describe("intent-classifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns no-tools for obvious small talk without calling LLM", async () => {
    const result = await classifyIntent("wie gehts dir?", {} as any);

    expect(result).toEqual({
      needsTools: false,
      domain: "general",
      routeToAgent: null,
      confidence: 1,
    });
    expect(mockGetModelClient).not.toHaveBeenCalled();
  });

  it("uses classifier model for non-smalltalk messages", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: "{\"needsTools\":true,\"domain\":\"weather\",\"routeToAgent\":null,\"confidence\":0.92}",
          },
        },
      ],
    });

    mockGetModelClient.mockResolvedValue({
      client: null,
      openaiClient: {
        chat: {
          completions: {
            create,
          },
        },
      },
      model: "openai/gpt-4.1-nano",
      provider: "openrouter",
      ollamaUrl: null,
    } as any);

    const result = await classifyIntent("what is the weather in berlin tomorrow", {} as any);

    expect(result.needsTools).toBe(true);
    expect(result.domain).toBe("weather");
    expect(result.routeToAgent).toBeNull();
    expect(result.confidence).toBe(0.92);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back to tools-enabled when classifier errors on non-smalltalk", async () => {
    mockGetModelClient.mockRejectedValue(new Error("classifier unavailable"));

    const result = await classifyIntent("book me a flight to vienna", {} as any);

    expect(result).toEqual({
      needsTools: true,
      domain: "general",
      routeToAgent: null,
      confidence: 0.5,
    });
  });
});
