// Thin fetch-based Outline API client — no extra dependencies

import type { JoiConfig } from "../config/schema.js";
import type { OutlineDocument, OutlineCollection, OutlineSearchResult } from "./outline-types.js";

function headers(config: JoiConfig): Record<string, string> {
  return {
    "Authorization": `Bearer ${config.outline.apiKey}`,
    "Content-Type": "application/json",
  };
}

function apiUrl(config: JoiConfig): string {
  return config.outline.apiUrl;
}

async function post<T>(config: JoiConfig, endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${apiUrl(config)}${endpoint}`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outline API ${endpoint} failed (${res.status}): ${text}`);
  }
  const json = await res.json() as { data: T };
  return json.data;
}

export async function getDocument(config: JoiConfig, id: string): Promise<OutlineDocument> {
  return post<OutlineDocument>(config, "/documents.info", { id });
}

export async function listDocuments(
  config: JoiConfig,
  collectionId: string,
  offset = 0,
  limit = 100,
): Promise<OutlineDocument[]> {
  return post<OutlineDocument[]>(config, "/documents.list", {
    collectionId,
    offset,
    limit,
  });
}

export async function listAllDocuments(config: JoiConfig, collectionId: string): Promise<OutlineDocument[]> {
  const all: OutlineDocument[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const batch = await listDocuments(config, collectionId, offset, limit);
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function listCollections(config: JoiConfig): Promise<OutlineCollection[]> {
  return post<OutlineCollection[]>(config, "/collections.list", { limit: 100 });
}

export async function updateDocument(
  config: JoiConfig,
  id: string,
  data: { title?: string; text?: string },
): Promise<OutlineDocument> {
  return post<OutlineDocument>(config, "/documents.update", { id, ...data });
}

export async function createDocument(
  config: JoiConfig,
  data: { title: string; text: string; collectionId: string; publish?: boolean },
): Promise<OutlineDocument> {
  return post<OutlineDocument>(config, "/documents.create", {
    ...data,
    publish: data.publish ?? true,
  });
}

export async function searchDocuments(
  config: JoiConfig,
  query: string,
  opts?: { collectionId?: string; limit?: number },
): Promise<OutlineSearchResult[]> {
  const body: Record<string, unknown> = { query };
  if (opts?.collectionId) body.collectionId = opts.collectionId;
  if (opts?.limit) body.limit = opts.limit;
  return post<OutlineSearchResult[]>(config, "/documents.search", body);
}

export async function archiveDocument(config: JoiConfig, id: string): Promise<OutlineDocument> {
  return post<OutlineDocument>(config, "/documents.archive", { id });
}
