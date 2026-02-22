// Notion agent tools — search, read, create, update, query, and comment
// Multi-workspace: each tool accepts a `workspace` parameter to select which Notion config

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { NotionClient } from "./notion-api.js";
import { query as dbQuery } from "../db/client.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// Cache of Notion clients keyed by channel_config id
const clientCache = new Map<string, NotionClient>();

async function getNotionClient(workspace?: string): Promise<NotionClient | null> {
  // Load all Notion workspace configs from channel_configs
  const filter = workspace
    ? "AND id = $2"
    : "";
  const params: unknown[] = ["notion"];
  if (workspace) params.push(workspace);

  const result = await dbQuery<{ id: string; config: Record<string, unknown>; display_name: string | null }>(
    `SELECT id, config, display_name FROM channel_configs WHERE channel_type = $1 AND enabled = true ${filter} LIMIT 1`,
    params,
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const cached = clientCache.get(row.id);
  if (cached) return cached;

  const token = row.config.token as string;
  if (!token) return null;

  const label = row.display_name || row.id;
  const client = new NotionClient(token, label);
  clientCache.set(row.id, client);
  return client;
}

async function listWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const result = await dbQuery<{ id: string; display_name: string | null }>(
    "SELECT id, display_name FROM channel_configs WHERE channel_type = 'notion' AND enabled = true",
  );
  return result.rows.map((r) => ({ id: r.id, name: r.display_name || r.id }));
}

// ─── notion_search ───

handlers.set("notion_search", async (input) => {
  const { query, workspace, limit } = input as { query: string; workspace?: string; limit?: number };

  const client = await getNotionClient(workspace);
  if (!client) {
    const workspaces = await listWorkspaces();
    if (workspaces.length === 0) return { error: "No Notion workspaces configured. Add one in Settings > Integrations." };
    return { error: `Workspace not found. Available: ${workspaces.map((w) => w.id).join(", ")}` };
  }

  const pages = await client.searchPages(query, limit || 10);
  return {
    workspace: client.workspaceLabel,
    results: pages.map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      lastEdited: p.lastEditedTime,
    })),
    count: pages.length,
  };
});

// ─── notion_read ───

handlers.set("notion_read", async (input) => {
  const { page_id, workspace } = input as { page_id: string; workspace?: string };

  const client = await getNotionClient(workspace);
  if (!client) return { error: "Notion workspace not configured or not found." };

  const [page, content] = await Promise.all([
    client.getPage(page_id),
    client.getPageContent(page_id),
  ]);

  const truncated = content.length > 10000 ? content.slice(0, 10000) + "\n\n... (truncated)" : content;

  return {
    workspace: client.workspaceLabel,
    id: page.id,
    title: page.title,
    url: page.url,
    lastEdited: page.lastEditedTime,
    content: truncated,
  };
});

// ─── notion_create ───

handlers.set("notion_create", async (input) => {
  const { parent_id, title, content, workspace } = input as {
    parent_id: string;
    title: string;
    content?: string;
    workspace?: string;
  };

  const client = await getNotionClient(workspace);
  if (!client) return { error: "Notion workspace not configured or not found." };

  const page = await client.createPage(parent_id, title, content);
  return {
    workspace: client.workspaceLabel,
    id: page.id,
    title: page.title,
    url: page.url,
  };
});

// ─── notion_update ───

handlers.set("notion_update", async (input) => {
  const { page_id, properties, workspace } = input as {
    page_id: string;
    properties: Record<string, unknown>;
    workspace?: string;
  };

  const client = await getNotionClient(workspace);
  if (!client) return { error: "Notion workspace not configured or not found." };

  await client.updatePage(page_id, properties);
  return { workspace: client.workspaceLabel, updated: true, page_id };
});

// ─── notion_query_db ───

handlers.set("notion_query_db", async (input) => {
  const { database_id, filter, limit, workspace } = input as {
    database_id: string;
    filter?: object;
    limit?: number;
    workspace?: string;
  };

  const client = await getNotionClient(workspace);
  if (!client) return { error: "Notion workspace not configured or not found." };

  const rows = await client.queryDatabase(database_id, filter, limit || 50);
  return {
    workspace: client.workspaceLabel,
    rows: rows.map((r) => ({ id: r.id, url: r.url, properties: r.properties })),
    count: rows.length,
  };
});

// ─── notion_comment ───

handlers.set("notion_comment", async (input) => {
  const { page_id, text, action, workspace } = input as {
    page_id: string;
    text?: string;
    action?: "list" | "create";
    workspace?: string;
  };

  const client = await getNotionClient(workspace);
  if (!client) return { error: "Notion workspace not configured or not found." };

  if (action === "list" || !text) {
    const comments = await client.getComments(page_id);
    return { workspace: client.workspaceLabel, comments, count: comments.length };
  }

  await client.createComment(page_id, text);
  return { workspace: client.workspaceLabel, created: true, page_id };
});

// ─── notion_workspaces ───

handlers.set("notion_workspaces", async () => {
  const workspaces = await listWorkspaces();
  return { workspaces, count: workspaces.length };
});

// ─── Exports ───

export function getNotionToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getNotionToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "notion_search",
      description:
        "Search pages in a Notion workspace. Returns matching pages with titles and URLs. Use `workspace` to target a specific workspace (get available workspaces with notion_workspaces).",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search text" },
          workspace: { type: "string", description: "Workspace channel ID (optional — uses first available if omitted)" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "notion_read",
      description:
        "Read the content of a Notion page by ID. Returns the page title and markdown-like content. Use notion_search to find page IDs.",
      input_schema: {
        type: "object" as const,
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
          workspace: { type: "string", description: "Workspace channel ID (optional)" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_create",
      description:
        "Create a new page in Notion. Specify a parent page or database ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          parent_id: { type: "string", description: "Parent page or database ID" },
          title: { type: "string", description: "Page title" },
          content: { type: "string", description: "Page content as plain text (optional)" },
          workspace: { type: "string", description: "Workspace channel ID (optional)" },
        },
        required: ["parent_id", "title"],
      },
    },
    {
      name: "notion_update",
      description:
        "Update properties of a Notion page (e.g., status, tags). Pass Notion property format.",
      input_schema: {
        type: "object" as const,
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
          properties: { type: "object", description: "Notion properties object to update" },
          workspace: { type: "string", description: "Workspace channel ID (optional)" },
        },
        required: ["page_id", "properties"],
      },
    },
    {
      name: "notion_query_db",
      description:
        "Query a Notion database with optional filters. Returns rows with their properties.",
      input_schema: {
        type: "object" as const,
        properties: {
          database_id: { type: "string", description: "Notion database ID" },
          filter: { type: "object", description: "Notion filter object (optional)" },
          limit: { type: "number", description: "Max results (default: 50)" },
          workspace: { type: "string", description: "Workspace channel ID (optional)" },
        },
        required: ["database_id"],
      },
    },
    {
      name: "notion_comment",
      description:
        "List or create comments on a Notion page. Use action='list' to read comments, or provide text to create one.",
      input_schema: {
        type: "object" as const,
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
          text: { type: "string", description: "Comment text (for creating)" },
          action: { type: "string", enum: ["list", "create"], description: "Action: list or create (default: create if text provided)" },
          workspace: { type: "string", description: "Workspace channel ID (optional)" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_workspaces",
      description:
        "List all configured Notion workspaces. Use the returned IDs as the `workspace` parameter in other Notion tools.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
