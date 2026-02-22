// Channel agent tools — send messages and list channels from within agent conversations

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { getAdapter, getAllStatuses } from "./manager.js";
import { linkMessageToContact } from "./router.js";
import type { ChannelMessage } from "./types.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// ─── channel_send: Send a message through a connected channel ───

handlers.set("channel_send", async (input) => {
  const { channel_id, to, content } = input as {
    channel_id: string;
    to: string;
    content: string;
  };

  const adapter = getAdapter(channel_id);
  if (!adapter) {
    return { error: `Channel '${channel_id}' not found. Available channels: use channel_list to see connected channels.` };
  }

  const status = adapter.getStatus();
  if (status.status !== "connected") {
    return { error: `Channel '${channel_id}' is ${status.status}, not connected. ${status.error ? `Reason: ${status.error}` : "Try reconnecting in Settings."}` };
  }

  try {
    await adapter.send(to, content);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to send via ${channel_id}: ${errMsg}` };
  }

  // Track outbound message in CRM contact timeline
  const isTelegramUsername = adapter.channelType === "telegram" && !/^\d+$/.test(to);
  const outMsg: ChannelMessage = {
    channelId: channel_id,
    channelType: adapter.channelType,
    senderId: isTelegramUsername ? "" : to,
    content,
    timestamp: new Date(),
    metadata: isTelegramUsername ? { username: to.replace(/^@/, "") } : undefined,
  };
  linkMessageToContact(outMsg, "outbound");

  return { sent: true, channelId: channel_id, to };
});

// ─── channel_list: List all configured channels and their status ───

handlers.set("channel_list", async () => {
  const statuses = getAllStatuses();
  return {
    channels: statuses.map((s) => ({
      channelId: s.channelId,
      channelType: s.channelType,
      status: s.status,
      displayName: s.displayName,
      error: s.error,
    })),
    count: statuses.length,
  };
});

// ─── Exports ───

export function getChannelToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getChannelToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "channel_send",
      description:
        "Send a message to a specific contact through a connected channel (WhatsApp, Telegram, iMessage).",
      input_schema: {
        type: "object" as const,
        properties: {
          channel_id: { type: "string", description: "Channel ID (from channel_list)" },
          to: { type: "string", description: "Recipient identifier (phone number, chat ID, etc.)" },
          content: { type: "string", description: "Message text to send" },
        },
        required: ["channel_id", "to", "content"],
      },
    },
    {
      name: "channel_list",
      description: "List all configured messaging channels and their connection status.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}
