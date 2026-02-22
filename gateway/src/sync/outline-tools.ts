// Outline wiki agent tools — search and read documents from within agent conversations

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import * as api from "./outline-api.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// ─── outline_search: Search Outline wiki documents ───

handlers.set("outline_search", async (input, ctx) => {
  const { query, collection_id, limit } = input as {
    query: string;
    collection_id?: string;
    limit?: number;
  };

  if (!ctx.config.outline.apiKey) {
    return { error: "Outline API key not configured. Set it in Settings." };
  }

  const results = await api.searchDocuments(ctx.config, query, {
    collectionId: collection_id,
    limit: limit || 10,
  });

  return {
    results: results.map((r) => ({
      id: r.document.id,
      title: r.document.title,
      snippet: r.context || r.document.text?.slice(0, 200),
      collection: r.document.collectionId,
      updatedAt: r.document.updatedAt,
      url: r.document.url,
    })),
    count: results.length,
  };
});

// ─── outline_read: Read a specific Outline document ───

handlers.set("outline_read", async (input, ctx) => {
  const { id } = input as { id: string };

  if (!ctx.config.outline.apiKey) {
    return { error: "Outline API key not configured. Set it in Settings." };
  }

  const doc = await api.getDocument(ctx.config, id);

  return {
    id: doc.id,
    title: doc.title,
    content: doc.text.length > 10000 ? doc.text.slice(0, 10000) + "\n\n... (truncated)" : doc.text,
    collection: doc.collectionId,
    updatedAt: doc.updatedAt,
    url: doc.url,
  };
});

// ─── outline_list_collections: List Outline collections ───

handlers.set("outline_list_collections", async (_input, ctx) => {
  if (!ctx.config.outline.apiKey) {
    return { error: "Outline API key not configured. Set it in Settings." };
  }

  const collections = await api.listCollections(ctx.config);

  return {
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
    })),
    count: collections.length,
  };
});

// ─── Exports ───

export function getOutlineToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getOutlineToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "outline_search",
      description:
        "Search documents in the Outline wiki (go-outline.itellico.ai). Returns matching documents with snippets. Covers company wiki: processes, infrastructure, product docs, role guides.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search text" },
          collection_id: { type: "string", description: "Limit search to a specific collection (optional)" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "outline_read",
      description:
        "Read the full content of a specific Outline wiki document by ID. Use outline_search first to find document IDs.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Outline document ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "outline_list_collections",
      description: "List all collections (spaces) in the Outline wiki.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
