// Ollama embedding client for nomic-embed-text (768 dimensions, runs locally)

import type { JoiConfig } from "../config/schema.js";

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

const OLLAMA_HEALTH_TIMEOUT_MS = 2500;
const OLLAMA_EMBED_TIMEOUT_MS = 30_000;
const OLLAMA_PULL_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function embed(
  text: string,
  config: JoiConfig,
): Promise<number[]> {
  const url = config.memory.ollamaUrl;
  const model = config.memory.embeddingModel;

  const response = await fetchWithTimeout(
    `${url}/api/embed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    },
    OLLAMA_EMBED_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings[0];
}

// Batch embed multiple texts
export async function embedBatch(
  texts: string[],
  config: JoiConfig,
): Promise<number[][]> {
  const url = config.memory.ollamaUrl;
  const model = config.memory.embeddingModel;

  const response = await fetchWithTimeout(
    `${url}/api/embed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    },
    OLLAMA_EMBED_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed batch failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings;
}

// Check if Ollama is available and model is loaded
export async function checkOllama(config: JoiConfig): Promise<{
  available: boolean;
  modelLoaded: boolean;
  error?: string;
}> {
  const url = config.memory.ollamaUrl;
  const model = config.memory.embeddingModel;

  try {
    const response = await fetchWithTimeout(
      `${url}/api/tags`,
      {},
      OLLAMA_HEALTH_TIMEOUT_MS,
    );
    if (!response.ok) {
      return { available: false, modelLoaded: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = data.models || [];
    const modelLoaded = models.some(
      (m) => m.name === model || m.name.startsWith(`${model}:`),
    );

    return { available: true, modelLoaded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        available: false,
        modelLoaded: false,
        error: `Timeout after ${OLLAMA_HEALTH_TIMEOUT_MS}ms`,
      };
    }
    return {
      available: false,
      modelLoaded: false,
      error: message,
    };
  }
}

// Pull model if not loaded
export async function pullModel(config: JoiConfig): Promise<void> {
  const url = config.memory.ollamaUrl;
  const model = config.memory.embeddingModel;

  const response = await fetchWithTimeout(
    `${url}/api/pull`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
    },
    OLLAMA_PULL_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama pull failed (${response.status}): ${body}`);
  }
}
