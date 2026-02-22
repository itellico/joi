// Agent tool definitions and handlers for Apple Contacts

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import {
  searchContacts,
  getContact,
  listContacts,
  listGroups,
  getGroupMembers,
  getContactCount,
} from "./contacts.js";
import { query } from "../db/client.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

export function getContactsToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set("contacts_search", async (input) => {
    const { query } = input as { query: string };
    if (!query) return { error: "query is required" };
    const results = await searchContacts(query);
    if (results.length === 0) return { results: [], message: `No contacts found matching "${query}"` };
    return { results, count: results.length };
  });

  handlers.set("contacts_get", async (input) => {
    const { id } = input as { id: string };
    if (!id) return { error: "id is required" };
    const contact = await getContact(id);
    if (!contact) return { error: "Contact not found" };
    return contact;
  });

  handlers.set("contacts_list", async (input) => {
    const { limit } = input as { limit?: number };
    const contacts = await listContacts(limit || 50);
    const total = await getContactCount();
    return { contacts, showing: contacts.length, total };
  });

  handlers.set("contacts_groups", async () => {
    const groups = await listGroups();
    return { groups };
  });

  handlers.set("contacts_group_members", async (input) => {
    const { group, limit } = input as { group: string; limit?: number };
    if (!group) return { error: "group name is required" };
    const members = await getGroupMembers(group, limit || 50);
    if (members.length === 0) return { members: [], message: `No group found with name "${group}" or group is empty` };
    return { members, count: members.length };
  });

  handlers.set("contacts_interactions_list", async (input) => {
    const { contact_id, platform, days, limit } = input as {
      contact_id?: string; platform?: string; days?: number; limit?: number;
    };
    const d = days ?? 30;
    const l = Math.min(limit ?? 50, 200);
    const conditions = ["ci.occurred_at > NOW() - make_interval(days => $1)"];
    const params: unknown[] = [d];
    let idx = 2;
    if (contact_id) { conditions.push(`ci.contact_id = $${idx++}`); params.push(contact_id); }
    if (platform) { conditions.push(`ci.platform = $${idx++}`); params.push(platform); }
    params.push(l);
    const result = await query<Record<string, unknown>>(
      `SELECT ci.id, ci.contact_id, ci.platform, ci.direction, ci.summary,
              ci.is_from_me, ci.occurred_at, c.first_name, c.last_name
       FROM contact_interactions ci
       JOIN contacts c ON ci.contact_id = c.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ci.occurred_at DESC
       LIMIT $${idx}`,
      params,
    );
    return { interactions: result.rows, count: result.rows.length };
  });

  handlers.set("contacts_update_extra", async (input) => {
    const { contact_id, data } = input as { contact_id: string; data: Record<string, unknown> };
    if (!contact_id) return { error: "contact_id is required" };
    if (!data || typeof data !== "object") return { error: "data object is required" };
    const result = await query(
      `UPDATE contacts SET extra = COALESCE(extra, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
       WHERE id = $2 RETURNING id, first_name, last_name`,
      [JSON.stringify(data), contact_id],
    );
    if (result.rows.length === 0) return { error: "Contact not found" };
    return { updated: true, contact: result.rows[0] };
  });

  return handlers;
}

export function getContactsToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "contacts_search",
      description:
        "Search Apple Contacts by name, organization, email, or phone number. Returns matching contacts with all their details (phones, emails, addresses, etc.).",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term — matches against name, organization, email addresses, and phone numbers",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "contacts_get",
      description:
        "Get full details for a specific contact by their Apple Contacts ID. Use contacts_search first to find the ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The Apple Contacts ID (e.g., '591A0613-241B-4276-BD9C-7AF69E04E6FC:ABPerson')",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "contacts_list",
      description:
        "List contacts from Apple Contacts (names and organizations only). Use contacts_search for filtered results or contacts_get for full details.",
      input_schema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Maximum contacts to return (default: 50)",
          },
        },
        required: [],
      },
    },
    {
      name: "contacts_groups",
      description: "List all contact groups from Apple Contacts with member counts.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "contacts_group_members",
      description: "Get all members of a specific Apple Contacts group by group name.",
      input_schema: {
        type: "object" as const,
        properties: {
          group: {
            type: "string",
            description: "Name of the contact group",
          },
          limit: {
            type: "number",
            description: "Maximum members to return (default: 50)",
          },
        },
        required: ["group"],
      },
    },
    {
      name: "contacts_interactions_list",
      description:
        "Query contact interaction history from all communication channels. Filter by contact, platform, or time range. Returns direction, summary, and timestamps.",
      input_schema: {
        type: "object" as const,
        properties: {
          contact_id: {
            type: "string",
            description: "Filter by contact ID (optional)",
          },
          platform: {
            type: "string",
            description: "Filter by platform: whatsapp, telegram, imessage (optional)",
          },
          days: {
            type: "number",
            description: "Look back N days (default: 30)",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 50, max: 200)",
          },
        },
        required: [],
      },
    },
    {
      name: "contacts_update_extra",
      description:
        "Update a contact's extra JSONB field with relationship metadata (e.g. relationship_type, frequency, last_topic). Merges with existing data.",
      input_schema: {
        type: "object" as const,
        properties: {
          contact_id: {
            type: "string",
            description: "The contact ID to update",
          },
          data: {
            type: "object" as const,
            description: "Key-value pairs to merge into the contact's extra field",
          },
        },
        required: ["contact_id", "data"],
      },
    },
  ];
}
