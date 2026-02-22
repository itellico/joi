// Notion API client — thin wrapper around @notionhq/client
// Supports multi-workspace via per-instance tokens

let NotionClientLib: any = null;

async function loadNotionSDK() {
  if (!NotionClientLib) {
    const mod = await import("@notionhq/client");
    NotionClientLib = mod.Client;
  }
  return NotionClientLib!;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  parent: { type: string; id?: string };
  lastEditedTime: string;
  archived: boolean;
}

export interface NotionComment {
  id: string;
  text: string;
  createdBy: string;
  createdTime: string;
}

export interface NotionDatabaseRow {
  id: string;
  properties: Record<string, unknown>;
  url: string;
}

function extractTitle(page: any): string {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.type === "title" && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }
  return page.id;
}

function extractPlainText(richText: any[]): string {
  return richText.map((t: any) => t.plain_text).join("");
}

export class NotionClient {
  private client: any;
  public readonly workspaceLabel: string;

  constructor(token: string, workspaceLabel: string) {
    this.workspaceLabel = workspaceLabel;
    // Client is created lazily since the constructor is sync
    this._token = token;
  }

  private _token: string;
  private _initialized = false;

  private async ensureClient() {
    if (!this._initialized) {
      const ClientClass = await loadNotionSDK();
      this.client = new ClientClass({ auth: this._token });
      this._initialized = true;
    }
  }

  async searchPages(queryText: string, limit = 10): Promise<NotionPage[]> {
    await this.ensureClient();
    const response = await this.client.search({
      query: queryText,
      filter: { value: "page", property: "object" },
      page_size: limit,
    });
    return response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      parent: { type: page.parent?.type, id: page.parent?.database_id || page.parent?.page_id },
      lastEditedTime: page.last_edited_time,
      archived: page.archived,
    }));
  }

  async getPage(pageId: string): Promise<NotionPage> {
    await this.ensureClient();
    const page = await this.client.pages.retrieve({ page_id: pageId });
    return {
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      parent: { type: page.parent?.type, id: page.parent?.database_id || page.parent?.page_id },
      lastEditedTime: page.last_edited_time,
      archived: page.archived,
    };
  }

  async getPageContent(pageId: string): Promise<string> {
    await this.ensureClient();
    const blocks: string[] = [];
    let cursor: string | undefined;

    do {
      const response: any = await this.client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const block of response.results) {
        const text = this.blockToText(block);
        if (text) blocks.push(text);
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return blocks.join("\n");
  }

  private blockToText(block: any): string {
    const type = block.type;
    const data = block[type];
    if (!data) return "";

    if (data.rich_text) {
      const text = extractPlainText(data.rich_text);
      switch (type) {
        case "heading_1": return `# ${text}`;
        case "heading_2": return `## ${text}`;
        case "heading_3": return `### ${text}`;
        case "bulleted_list_item": return `- ${text}`;
        case "numbered_list_item": return `1. ${text}`;
        case "to_do": return `- [${data.checked ? "x" : " "}] ${text}`;
        case "quote": return `> ${text}`;
        case "code": return `\`\`\`${data.language || ""}\n${text}\n\`\`\``;
        case "toggle": return `<toggle> ${text}`;
        case "callout": return `> ${data.icon?.emoji || ""} ${text}`;
        default: return text;
      }
    }

    if (type === "divider") return "---";
    if (type === "image") return `![image](${data.file?.url || data.external?.url || ""})`;
    return "";
  }

  async queryDatabase(databaseId: string, filter?: object, limit = 50): Promise<NotionDatabaseRow[]> {
    await this.ensureClient();
    const response = await this.client.databases.query({
      database_id: databaseId,
      filter,
      page_size: limit,
    });
    return response.results.map((row: any) => ({
      id: row.id,
      properties: row.properties,
      url: row.url,
    }));
  }

  async createPage(parentId: string, title: string, content?: string): Promise<NotionPage> {
    await this.ensureClient();

    // Determine parent type by trying database first
    let parent: any;
    try {
      await this.client.databases.retrieve({ database_id: parentId });
      parent = { database_id: parentId };
    } catch {
      parent = { page_id: parentId };
    }

    const properties: any = {};
    if (parent.database_id) {
      properties.Name = { title: [{ text: { content: title } }] };
    } else {
      properties.title = { title: [{ text: { content: title } }] };
    }

    const children: any[] = [];
    if (content) {
      // Split content into paragraph blocks (Notion has a 2000 char limit per block)
      const chunks = content.match(/.{1,2000}/gs) || [];
      for (const chunk of chunks) {
        children.push({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: chunk } }] },
        });
      }
    }

    const page = await this.client.pages.create({
      parent,
      properties,
      children: children.length > 0 ? children : undefined,
    });

    return {
      id: page.id,
      title,
      url: page.url,
      parent: { type: page.parent?.type, id: parentId },
      lastEditedTime: page.last_edited_time,
      archived: false,
    };
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    await this.ensureClient();
    await this.client.pages.update({ page_id: pageId, properties });
  }

  async getComments(pageId: string): Promise<NotionComment[]> {
    await this.ensureClient();
    const response = await this.client.comments.list({ block_id: pageId });
    return response.results.map((c: any) => ({
      id: c.id,
      text: extractPlainText(c.rich_text),
      createdBy: c.created_by?.id || "unknown",
      createdTime: c.created_time,
    }));
  }

  async createComment(pageId: string, text: string): Promise<void> {
    await this.ensureClient();
    await this.client.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ type: "text", text: { content: text } }],
    });
  }
}
