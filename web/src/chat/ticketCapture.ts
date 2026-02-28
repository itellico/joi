import type { ChatMessage } from "../hooks/useChat";

export interface TicketCommand {
  note: string;
  kind: "ticket" | "bug";
}

export interface CreateThingsTicketParams {
  conversationId: string | null;
  messages: ChatMessage[];
  note: string;
  kind: "ticket" | "bug";
  pendingUserMessage?: string;
  source: "chat-main" | "assistant-chat";
  commandText?: string;
}

export interface CreateThingsTicketResult {
  created: boolean;
  title: string;
  projectTitle?: string;
  headingTitle?: string;
}

const DIRECT_COMMAND_RE = /^\/?ticket(?:\s*[:\-]?\s*(.*))?$/i;

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatAssistantMetadata(message: ChatMessage): string {
  const meta: string[] = [];
  if (message.agentId) meta.push(`agent=${message.agentId}`);
  if (message.model) meta.push(`model=${message.model}`);
  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    const tools = message.toolCalls
      .map((tool) => tool.name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
    if (tools.length > 0) meta.push(`tools=${tools.join(",")}`);
  }
  return meta.length > 0 ? ` (${meta.join(" | ")})` : "";
}

function buildEffectiveMessages(messages: ChatMessage[], pendingUserMessage?: string): ChatMessage[] {
  const filtered = messages.filter((message) => !message.isStreaming);
  const pending = compactText(pendingUserMessage || "");
  if (!pending) return filtered;

  const last = filtered[filtered.length - 1];
  if (last?.role === "user" && compactText(last.content || "") === pending) {
    return filtered;
  }

  return [
    ...filtered,
    {
      id: `pending-user-${Date.now()}`,
      role: "user",
      content: pending,
    },
  ];
}

export function parseTicketCommand(value: string): TicketCommand | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(DIRECT_COMMAND_RE);
  if (!directMatch) return null;
  const details = compactText(directMatch[1] || "");
  return {
    kind: "ticket",
    note: details || "Ticket requested from chat command",
  };
}

export function buildTicketTranscript(messages: ChatMessage[], pendingUserMessage?: string): string {
  const effective = buildEffectiveMessages(messages, pendingUserMessage);
  const lines: string[] = [];

  for (const message of effective) {
    const content = compactText(message.content || "");
    if (!content) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;

    if (message.role === "user") {
      lines.push(`User: ${content}`);
      continue;
    }

    lines.push(`Assistant${formatAssistantMetadata(message)}: ${content}`);
  }

  return lines.join("\n\n");
}

export async function createThingsTicketFromChat(
  params: CreateThingsTicketParams,
): Promise<CreateThingsTicketResult> {
  const transcript = buildTicketTranscript(params.messages, params.pendingUserMessage);
  const response = await fetch("/api/chat/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: params.conversationId,
      note: params.note,
      kind: params.kind,
      commandText: params.commandText || params.pendingUserMessage || "",
      transcript,
      source: params.source,
    }),
  });

  const payload = await response.json().catch(() => ({} as { error?: string }));
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create Things ticket");
  }

  return payload as CreateThingsTicketResult;
}
