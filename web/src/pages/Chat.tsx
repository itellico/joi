import { useRef, useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";
import {
  useChat,
  type ChatMessage,
  type ToolCall,
  type Attachment,
  type OutgoingAttachment,
  type ChatMention,
  type OutgoingMessageRelations,
} from "../hooks/useChat";
import type { ConnectionStatus, Frame } from "../hooks/useWebSocket";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { Badge, MetaText, EmptyState, Modal } from "../components/ui";
import { PageHeader } from "../components/ui/PageLayout";
import JoiOrb from "../components/JoiOrb";
import { shortModelName, formatDuration, formatToolName } from "../chat/formatters";
import { getToolSourceIndicator } from "../chat/sourceIndicators";
import {
  buildSimulationMetadata,
  type ChatExecutionMode,
  type ChatLatencyPreset,
} from "../chat/simulation";
import { CHAT_SURFACE_PROFILES } from "../chat/surfaces";
import { createThingsTicketFromChat, parseTicketCommand } from "../chat/ticketCapture";
import {
  ASSISTANT_VOICE_STATUS_EVENT,
  emitAssistantVoiceControl,
  type AssistantVoiceStatusDetail,
} from "../lib/assistantVoiceEvents";

interface Conversation {
  id: string;
  title: string;
  agent_id: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
  type?: string;
  inbox_status?: string;
  contact_id?: string;
  session_key?: string;
  channel_id?: string;
}

type ConversationFilter = "all" | "direct" | "inbox";

const CHANNEL_META: Record<string, { icon: string; label: string; color: string }> = {
  whatsapp: { icon: "\uD83D\uDFE2", label: "WhatsApp", color: "#25d366" },
  telegram: { icon: "\u2708\uFE0F", label: "Telegram", color: "#0088cc" },
  imessage: { icon: "\uD83D\uDCAC", label: "iMessage", color: "#34c759" },
  email: { icon: "\u2709\uFE0F", label: "Email", color: "#5ac8fa" },
};

function getChannelType(conv: Conversation): string | null {
  if (!conv.session_key) return null;
  const ch = conv.session_key.split(":")[0];
  return ch in CHANNEL_META ? ch : null;
}

/** Extract short account label from channel_id */
function accountLabel(channelId: string): string {
  // Non-email channels: "whatsapp-personal" → "WhatsApp", "telegram-personal" → "Telegram"
  if (channelId.startsWith("whatsapp")) return "WhatsApp";
  if (channelId.startsWith("telegram")) return "Telegram";
  // Email: "m-itellico-ai" → "itellico.ai"
  const raw = channelId.replace(/^m-/, "");
  const lastDash = raw.lastIndexOf("-");
  if (lastDash >= 0) return raw.slice(0, lastDash) + "." + raw.slice(lastDash + 1);
  return raw;
}

function getSenderName(conv: Conversation): string {
  const title = conv.title || "Unknown";
  const dash = title.indexOf(" \u2014 ");
  return dash >= 0 ? title.slice(dash + 3) : title;
}

function parseExecutionModeParam(value: string | null): ChatExecutionMode | null {
  if (value === "live" || value === "shadow" || value === "dry_run") return value;
  return null;
}

function parseLatencyPresetParam(value: string | null): ChatLatencyPreset | null {
  if (value === "none" || value === "light" || value === "realistic" || value === "stress") return value;
  return null;
}

const MAX_COMPOSER_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_COMPOSER_ATTACHMENTS = 6;
const REACTION_ACTOR_ID = "joi-user";
const QUICK_REACTION_EMOJIS = ["❤️", "🔥", "👍", "😂", "👎", "🥰"] as const;
const URL_DETECT_RE = /https?:\/\/[^\s<>()]+/i;
const LINK_PREVIEW_CACHE = new Map<string, LinkPreviewPayload | null>();
const LINK_PREVIEW_PENDING = new Map<string, Promise<LinkPreviewPayload | null>>();

interface LinkPreviewPayload {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

interface ComposerAttachment {
  id: string;
  type: "photo" | "audio" | "document";
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

interface AgentSummary {
  id: string;
  name?: string | null;
  skills?: string[];
}

interface ComposerTarget {
  id: string;
  role: ChatMessage["role"];
  preview: string;
}

const TRAILING_MENTION_RE = /(^|\s)@([a-zA-Z0-9._-]{1,64})$/;
const INLINE_MENTION_RE = /(^|\s)@([a-zA-Z0-9._-]{2,64})/g;

function summarizeMessageForComposer(message: ChatMessage): string {
  const fallback = message.role === "assistant" ? "Assistant message" : "Message";
  const source = message.content.trim();
  if (!source) return fallback;
  const compact = source.replace(/\s+/g, " ");
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function buildMentionPayload(content: string, agents: AgentSummary[]): ChatMention[] {
  if (!content.trim()) return [];
  const mentions: ChatMention[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(INLINE_MENTION_RE)) {
    const handle = match[2];
    if (!handle) continue;
    const normalized = handle.trim().replace(/^@+/, "");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const agent = agents.find((candidate) => (
      candidate.id.toLowerCase() === key
      || (candidate.name && candidate.name.toLowerCase() === key)
    ));
    const prefixLength = typeof match[1] === "string" ? match[1].length : 0;
    const start = typeof match.index === "number" ? match.index + prefixLength : undefined;
    mentions.push({
      id: agent?.id,
      value: normalized,
      label: agent?.name || undefined,
      kind: agent ? "agent" : "unknown",
      start,
      end: typeof start === "number" ? start + normalized.length + 1 : undefined,
    });
    if (mentions.length >= 32) break;
  }

  return mentions;
}

function firstHttpUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(URL_DETECT_RE);
  if (!match?.[0]) return null;
  return match[0];
}

async function loadLinkPreview(url: string): Promise<LinkPreviewPayload | null> {
  if (LINK_PREVIEW_CACHE.has(url)) return LINK_PREVIEW_CACHE.get(url) ?? null;
  const pending = LINK_PREVIEW_PENDING.get(url);
  if (pending) return pending;

  const request = fetch(`/api/chat/link-preview?url=${encodeURIComponent(url)}`)
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json() as LinkPreviewPayload;
      if (!payload?.title) return null;
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      LINK_PREVIEW_PENDING.delete(url);
    });

  LINK_PREVIEW_PENDING.set(url, request);
  const resolved = await request;
  LINK_PREVIEW_CACHE.set(url, resolved);
  return resolved;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file"));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function isAllowedComposerFile(file: File): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("audio/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json") return true;

  const lower = (file.name || "").toLowerCase();
  return [".pdf", ".txt", ".md", ".csv", ".json", ".wav", ".mp3", ".m4a", ".ogg", ".webm"]
    .some((ext) => lower.endsWith(ext));
}

function composerAttachmentType(file: File): ComposerAttachment["type"] {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

interface ChatProps {
  ws: {
    status: ConnectionStatus;
    send: (type: string, data?: unknown, id?: string) => void;
    on: (type: string, handler: (frame: Frame) => void) => () => void;
  };
  chatMode?: "api" | "claude-code";
}

export default function Chat({ ws, chatMode = "api" }: ChatProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const surface = CHAT_SURFACE_PROFILES.main;
  const {
    messages,
    isStreaming,
    conversationId,
    sendMessage,
    loadConversation,
    newConversation,
    setMessageReactions,
  } = useChat({
    send: ws.send,
    on: ws.on,
  });
  const [input, setInput] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [chatExecutionMode, setChatExecutionMode] = useState<ChatExecutionMode>(surface.defaultExecutionMode);
  const [chatLatencyPreset, setChatLatencyPreset] = useState<ChatLatencyPreset>(surface.defaultLatencyPreset);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convFilter, setConvFilter] = useState<ConversationFilter>(() => {
    if (typeof window === "undefined") return "all";
    const saved = window.localStorage.getItem("joi-chat-filter");
    if (saved === "all" || saved === "inbox") return saved;
    return "all";
  });
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [simulationCaseName, setSimulationCaseName] = useState<string | null>(null);
  const [ticketNote, setTicketNote] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [replyTarget, setReplyTarget] = useState<ComposerTarget | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ComposerTarget | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [assistantVoice, setAssistantVoice] = useState<AssistantVoiceStatusDetail>({
    state: "idle",
    isMuted: false,
    error: null,
    isListening: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryInitDoneRef = useRef(false);
  const autoSendDoneRef = useRef(false);
  const restoreConversationDoneRef = useRef(false);

  const fetchConversations = useCallback(() => {
    const url = convFilter === "all"
      ? "/api/conversations"
      : `/api/conversations?type=${convFilter}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.conversations) setConversations(data.conversations);
      })
      .catch(console.error);
  }, [convFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data?.agents)) return;
        const next = data.agents
          .filter((agent: unknown): agent is AgentSummary => {
            if (!agent || typeof agent !== "object") return false;
            return typeof (agent as { id?: unknown }).id === "string";
          })
          .map((agent: AgentSummary) => ({
            id: agent.id,
            name: typeof agent.name === "string" ? agent.name : null,
            skills: Array.isArray(agent.skills)
              ? agent.skills.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
              : [],
          }));
        setAgents(next);
      })
      .catch(() => {
        setAgents([]);
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("joi-chat-filter", convFilter);
  }, [convFilter]);

  // Refresh list when a response completes
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      fetchConversations();
    }
  }, [isStreaming, messages.length, fetchConversations]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setSelectedMessageIds([]);
  }, [conversationId]);

  useEffect(() => {
    setSelectedMessageIds((prev) => prev.filter((id) => messages.some((message) => message.id === id)));
  }, [messages]);

  useEffect(() => {
    const onAssistantVoiceStatus = (event: Event) => {
      const custom = event as CustomEvent<AssistantVoiceStatusDetail>;
      if (!custom.detail) return;
      setAssistantVoice(custom.detail);
    };

    window.addEventListener(ASSISTANT_VOICE_STATUS_EVENT, onAssistantVoiceStatus as EventListener);
    emitAssistantVoiceControl("status");
    return () => {
      window.removeEventListener(ASSISTANT_VOICE_STATUS_EVENT, onAssistantVoiceStatus as EventListener);
    };
  }, []);

  useEffect(() => {
    if (conversationId || restoreConversationDoneRef.current) return;

    const explicitConversationId = searchParams.get("conversationId");
    const hasAutoSendFlow = searchParams.get("autoSend") === "1";
    const storedConversationId = typeof window !== "undefined"
      ? window.localStorage.getItem("joi-chat-last-conversation")
      : null;

    const preferredConversationId = explicitConversationId || (hasAutoSendFlow ? null : storedConversationId);
    if (!preferredConversationId) {
      restoreConversationDoneRef.current = true;
      return;
    }

    if (explicitConversationId) {
      restoreConversationDoneRef.current = true;
      loadConversation(explicitConversationId);
      return;
    }

    if (conversations.length === 0) return;

    const exists = conversations.some((conv) => conv.id === preferredConversationId);
    restoreConversationDoneRef.current = true;
    if (exists) {
      loadConversation(preferredConversationId);
    }
  }, [conversationId, conversations, loadConversation, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!conversationId) return;
    window.localStorage.setItem("joi-chat-last-conversation", conversationId);
  }, [conversationId]);

  useEffect(() => {
    setReplyTarget(null);
    setForwardTarget(null);
  }, [conversationId]);

  useEffect(() => {
    const currentConversationParam = searchParams.get("conversationId");
    if (conversationId) {
      if (currentConversationParam === conversationId) return;
      const next = new URLSearchParams(searchParams);
      next.set("conversationId", conversationId);
      setSearchParams(next, { replace: true });
      return;
    }
    if (!currentConversationParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("conversationId");
    setSearchParams(next, { replace: true });
  }, [conversationId, searchParams, setSearchParams]);

  useEffect(() => {
    if (queryInitDoneRef.current) return;
    queryInitDoneRef.current = true;

    const mode = parseExecutionModeParam(searchParams.get("execution"));
    const latency = parseLatencyPresetParam(searchParams.get("latency"));
    const prompt = searchParams.get("prompt");
    const caseName = searchParams.get("caseName");

    if (mode) setChatExecutionMode(mode);
    if (latency) setChatLatencyPreset(latency);
    if (prompt) setInput(prompt);
    if (caseName) setSimulationCaseName(caseName);
  }, [searchParams]);

  useEffect(() => {
    const autoSendRequested = searchParams.get("autoSend");
    const prompt = searchParams.get("prompt");
    if (autoSendRequested !== "1") return;
    if (autoSendDoneRef.current) return;
    if (!prompt || !prompt.trim()) return;
    if (isStreaming || ws.status !== "connected") return;

    autoSendDoneRef.current = true;
    const simulationMetadata = buildSimulationMetadata(chatMode, chatExecutionMode, chatLatencyPreset);
    sendMessage(prompt.trim(), chatMode, surface.agentId, simulationMetadata);
    setInput("");

    const next = new URLSearchParams(searchParams);
    next.delete("autoSend");
    setSearchParams(next, { replace: true });
  }, [
    chatExecutionMode,
    chatLatencyPreset,
    chatMode,
    isStreaming,
    searchParams,
    sendMessage,
    setSearchParams,
    surface.agentId,
    ws.status,
  ]);

  const addComposerAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const acceptedFileTypes = files.filter((file) => isAllowedComposerFile(file));
    if (acceptedFileTypes.length === 0) return;

    const availableSlots = Math.max(0, MAX_COMPOSER_ATTACHMENTS - composerAttachments.length);
    if (availableSlots === 0) return;

    const selected = acceptedFileTypes.slice(0, availableSlots);
    const oversize = selected.filter((file) => file.size > MAX_COMPOSER_ATTACHMENT_BYTES);
    if (oversize.length > 0) {
      window.alert(`Max file size is ${Math.floor(MAX_COMPOSER_ATTACHMENT_BYTES / (1024 * 1024))}MB per file.`);
    }

    const accepted = selected.filter((file) => file.size <= MAX_COMPOSER_ATTACHMENT_BYTES);
    if (accepted.length === 0) return;

    const built = await Promise.all(accepted.map(async (file) => ({
      id: crypto.randomUUID(),
      type: composerAttachmentType(file),
      name: file.name || "attachment",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: await readFileAsDataUrl(file),
    })));

    setComposerAttachments((prev) => [...prev, ...built].slice(0, MAX_COMPOSER_ATTACHMENTS));
  }, [composerAttachments.length]);

  const handleComposerPickFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      void addComposerAttachments(files);
    }
    event.target.value = "";
  }, [addComposerAttachments]);

  const removeComposerAttachment = useCallback((id: string) => {
    setComposerAttachments((prev) => prev.filter((att) => att.id !== id));
  }, []);

  const trailingMentionQuery = useMemo(() => {
    const match = input.match(TRAILING_MENTION_RE);
    return match?.[2]?.toLowerCase() || "";
  }, [input]);

  const mentionSuggestions = useMemo(() => {
    if (!trailingMentionQuery) return [];
    return agents
      .filter((agent) => {
        const idMatch = agent.id.toLowerCase().startsWith(trailingMentionQuery);
        const nameMatch = typeof agent.name === "string"
          ? agent.name.toLowerCase().includes(trailingMentionQuery)
          : false;
        return idMatch || nameMatch;
      })
      .slice(0, 6);
  }, [agents, trailingMentionQuery]);

  const insertMention = useCallback((agent: AgentSummary) => {
    setInput((current) => (
      current.replace(TRAILING_MENTION_RE, (_fullMatch, prefix: string) => {
        const safePrefix = typeof prefix === "string" ? prefix : "";
        return `${safePrefix}@${agent.id} `;
      })
    ));
  }, []);

  const handleReplyToMessage = useCallback((message: ChatMessage) => {
    setForwardTarget(null);
    setReplyTarget({
      id: message.id,
      role: message.role,
      preview: summarizeMessageForComposer(message),
    });
  }, []);

  const handleForwardMessage = useCallback((message: ChatMessage) => {
    setReplyTarget(null);
    setForwardTarget({
      id: message.id,
      role: message.role,
      preview: summarizeMessageForComposer(message),
    });
  }, []);

  const handleToggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    const normalizedEmoji = emoji.trim();
    if (!message.id || !normalizedEmoji || message.isStreaming) return;
    try {
      const response = await fetch(`/api/messages/${message.id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emoji: normalizedEmoji,
          actorId: REACTION_ACTOR_ID,
        }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { reactions?: Record<string, string[]> };
      setMessageReactions(message.id, payload.reactions && typeof payload.reactions === "object"
        ? payload.reactions
        : undefined);
    } catch (error) {
      console.error("Failed to toggle reaction:", error);
    }
  }, [setMessageReactions]);

  const refreshActiveConversation = useCallback(() => {
    if (!conversationId) return;
    loadConversation(conversationId);
  }, [conversationId, loadConversation]);

  const handlePinMessage = useCallback(async (message: ChatMessage) => {
    if (!message.id) return;
    try {
      const response = await fetch(`/api/messages/${message.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !message.pinned }),
      });
      if (!response.ok) return;
      refreshActiveConversation();
    } catch (error) {
      console.error("Failed to toggle pin:", error);
    }
  }, [refreshActiveConversation]);

  const handleReportMessage = useCallback(async (message: ChatMessage) => {
    if (!message.id) return;
    const note = window.prompt("Report note (optional):", message.reportNote || "");
    if (note === null) return;
    try {
      const response = await fetch(`/api/messages/${message.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!response.ok) return;
      refreshActiveConversation();
    } catch (error) {
      console.error("Failed to report message:", error);
    }
  }, [refreshActiveConversation]);

  const handleDeleteMessage = useCallback(async (message: ChatMessage) => {
    if (!message.id) return;
    const confirmed = window.confirm("Delete this message?");
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/messages/${message.id}`, { method: "DELETE" });
      if (!response.ok) return;
      setSelectedMessageIds((prev) => prev.filter((id) => id !== message.id));
      refreshActiveConversation();
    } catch (error) {
      console.error("Failed to delete message:", error);
    }
  }, [refreshActiveConversation]);

  const handleSelectMessage = useCallback((message: ChatMessage) => {
    if (!message.id) return;
    setSelectedMessageIds((prev) => (
      prev.includes(message.id)
        ? prev.filter((id) => id !== message.id)
        : [...prev, message.id]
    ));
  }, []);

  const handleSelectOnlyMessage = useCallback((message: ChatMessage) => {
    if (!message.id) return;
    setSelectedMessageIds([message.id]);
  }, []);

  const handleClearSelectedMessages = useCallback(() => {
    setSelectedMessageIds([]);
  }, []);

  const handleCopySelectedMessages = useCallback(() => {
    if (selectedMessageIds.length === 0) return;
    const selected = messages.filter((message) => selectedMessageIds.includes(message.id));
    const payload = selected
      .map((message) => `[${message.role}] ${message.content.trim()}`)
      .filter((line) => line.trim().length > 0)
      .join("\n\n");
    if (!payload) return;
    navigator.clipboard.writeText(payload).catch(() => {});
  }, [messages, selectedMessageIds]);

  const handleDeleteSelectedMessages = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    const confirmed = window.confirm(`Delete ${selectedMessageIds.length} selected message(s)?`);
    if (!confirmed) return;
    try {
      const response = await fetch("/api/messages/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedMessageIds }),
      });
      if (!response.ok) return;
      setSelectedMessageIds([]);
      refreshActiveConversation();
    } catch (error) {
      console.error("Failed to bulk delete messages:", error);
    }
  }, [refreshActiveConversation, selectedMessageIds]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput && composerAttachments.length === 0 && !forwardTarget) return;

    const ticketCommand = (composerAttachments.length === 0 && !forwardTarget && !replyTarget)
      ? parseTicketCommand(trimmedInput)
      : null;
    if (ticketCommand) {
      void createThingsTicketFromChat({
        conversationId,
        messages,
        note: ticketCommand.note,
        kind: ticketCommand.kind,
        pendingUserMessage: trimmedInput,
        commandText: trimmedInput,
        source: "chat-main",
      })
        .then((result) => {
          setTicketNote(`Ticket created: ${result.title}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Failed to create ticket";
          setTicketNote(message);
        });
      setInput("");
      setReplyTarget(null);
      setForwardTarget(null);
      return;
    }

    const sendMode = composerAttachments.length > 0 ? "api" : chatMode;
    const simulationMetadata = buildSimulationMetadata(sendMode, chatExecutionMode, chatLatencyPreset);
    const outgoingAttachments: OutgoingAttachment[] = composerAttachments.map((att) => ({
      type: att.type,
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      data: att.data,
    }));
    const mentions = buildMentionPayload(trimmedInput, agents);
    const relations: OutgoingMessageRelations = {
      replyToMessageId: replyTarget?.id,
      forwardOfMessageId: forwardTarget?.id,
      mentions,
    };
    sendMessage(trimmedInput, sendMode, surface.agentId, simulationMetadata, outgoingAttachments, relations);
    setInput("");
    setTicketNote(null);
    setComposerAttachments([]);
    setReplyTarget(null);
    setForwardTarget(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
  };

  const handleVoiceListeningToggle = useCallback(() => {
    if (assistantVoice.state === "idle") {
      emitAssistantVoiceControl("connect");
      return;
    }
    if (assistantVoice.isMuted) {
      emitAssistantVoiceControl("unmute");
      return;
    }
    emitAssistantVoiceControl("stop");
  }, [assistantVoice.isMuted, assistantVoice.state]);

  // Derive unique accounts for filter chips
  const accounts = [...new Set(conversations.map((c) => c.channel_id).filter(Boolean))] as string[];

  const filteredConversations = conversations.filter((conv) => {
    if (accountFilter === "all") return true;
    return conv.channel_id === accountFilter;
  });
  const activeConversation = useMemo(
    () => conversations.find((conv) => conv.id === conversationId) ?? null,
    [conversationId, conversations],
  );
  const isInboxConversation = activeConversation?.type === "inbox";
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message] as const)),
    [messages],
  );

  const handleDeleteConversation = useCallback(async (
    event: React.MouseEvent,
    convId: string,
  ) => {
    event.stopPropagation();
    if (!window.confirm("Delete this conversation permanently?")) return;

    try {
      const response = await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      setConversations((prev) => prev.filter((conv) => conv.id !== convId));
      if (convId === conversationId) {
        newConversation();
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("joi-chat-last-conversation");
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  }, [conversationId, newConversation]);

  const handleDeleteFilteredConversations = useCallback(async () => {
    if (filteredConversations.length === 0) return;
    const confirmed = window.confirm(`Delete ${filteredConversations.length} conversation(s) currently shown?`);
    if (!confirmed) return;

    const ids = filteredConversations.map((conversation) => conversation.id);
    await Promise.all(ids.map(async (id) => {
      try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      } catch {
        // best-effort bulk delete
      }
    }));

    setConversations((prev) => prev.filter((conv) => !ids.includes(conv.id)));
    if (conversationId && ids.includes(conversationId)) {
      newConversation();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("joi-chat-last-conversation");
      }
    }
  }, [conversationId, filteredConversations, newConversation]);

  const accountTabs = accounts.length > 1 ? (
    <div className="chat-channel-filters">
      <button
        className={`channel-chip${accountFilter === "all" ? " channel-chip--active" : ""}`}
        onClick={() => setAccountFilter("all")}
      >
        All
      </button>
      {accounts.map((acct) => (
        <button
          key={acct}
          className={`channel-chip${accountFilter === acct ? " channel-chip--active" : ""}`}
          onClick={() => setAccountFilter(acct)}
        >
          {accountLabel(acct)}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="chat-page">
      {/* Sidebar — always visible */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <MetaText className="text-md font-semibold text-secondary">
            {convFilter === "inbox" ? "Inbox" : "All Conversations"}
          </MetaText>
          {convFilter === "all" && filteredConversations.length > 0 && (
            <button
              type="button"
              className="chat-sidebar-bulk-delete"
              onClick={handleDeleteFilteredConversations}
              title="Delete all conversations currently listed"
            >
              Delete All
            </button>
          )}
          <div className="chat-filter-tabs" style={{ marginLeft: "auto" }}>
            {(["all", "inbox"] as ConversationFilter[]).map((f) => (
              <button
                key={f}
                className={`filter-btn${convFilter === f ? " filter-btn-active" : ""}`}
                onClick={() => { setConvFilter(f); setAccountFilter("all"); }}
              >
                {f === "all" ? "All" : "Inbox"}
              </button>
            ))}
          </div>
        </div>
        {accountTabs}
        <div className="chat-sidebar-list">
          {filteredConversations.map((conv) => {
            const ch = getChannelType(conv);
            const meta = ch ? CHANNEL_META[ch] : null;
            return (
              <div
                key={conv.id}
                className={`chat-sidebar-item${conv.id === conversationId ? " active" : ""}`}
                onClick={() => loadConversation(conv.id)}
              >
                <div className="chat-conv-row">
                  {meta && <span className="chat-conv-channel" title={meta.label}>{meta.icon}</span>}
                  <div className="chat-conv-info">
                    <div className={`chat-conv-title${conv.id === conversationId ? " chat-conv-title--active" : ""}`}>
                      {getSenderName(conv)}
                      {conv.type === "inbox" && conv.inbox_status && (
                        <span className={`inbox-badge inbox-badge--${conv.inbox_status}`}>
                          {conv.inbox_status}
                        </span>
                      )}
                    </div>
                    <div className="chat-conv-meta">
                      {conv.channel_id && <MetaText size="sm" className="text-accent">{accountLabel(conv.channel_id)}</MetaText>}
                      <MetaText size="sm">{conv.message_count} msgs</MetaText>
                      <MetaText size="sm">{formatTime(conv.updated_at)}</MetaText>
                    </div>
                  </div>
                  {convFilter === "all" && (
                    <button
                      type="button"
                      className="chat-conv-delete"
                      onClick={(event) => void handleDeleteConversation(event, conv.id)}
                      title="Delete conversation"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredConversations.length === 0 && (
            <EmptyState message="No conversations yet" />
          )}
        </div>
      </div>

      {/* Main chat */}
      <div className="chat-container">
        <PageHeader
          title="Voice Chats"
          actions={(
            <button
              className={`filter-btn${assistantVoice.isListening ? " filter-btn-active" : ""}`}
              onClick={handleVoiceListeningToggle}
              title={
                assistantVoice.state === "idle"
                  ? "Start voice link"
                  : assistantVoice.isMuted
                    ? "Resume voice stream"
                    : "End voice link"
              }
            >
              {assistantVoice.state === "idle"
                ? "Start Voice"
                : assistantVoice.isMuted
                  ? "Resume Voice"
                  : "End Voice"}
            </button>
          )}
        />

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <JoiOrb
                className="chat-welcome-avatar"
                size={64}
                active
                intensity={0.36}
                variant="firestorm"
                rings={3}
                animated
                ariaLabel="JOI"
              />
              <h3 className="chat-welcome-title">
                JOI
              </h3>
              <p>Speak or type and I will route the right source.</p>
            </div>
          )}

          {messages.map((msg) => {
            const replySource = msg.replyToMessageId ? messageById.get(msg.replyToMessageId) : null;
            const replyPreview = replySource
              ? summarizeMessageForComposer(replySource)
              : (msg.replyToMessageId ? `Message ${msg.replyToMessageId.slice(0, 8)}` : null);

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                replyPreview={replyPreview}
                onReply={handleReplyToMessage}
                onForward={handleForwardMessage}
                onToggleReaction={handleToggleReaction}
                onPin={handlePinMessage}
                onReport={handleReportMessage}
                onDelete={handleDeleteMessage}
                onSelect={handleSelectMessage}
                onSelectOnly={handleSelectOnlyMessage}
                isSelected={selectedMessageIds.includes(msg.id)}
                selectionMode={selectedMessageIds.length > 0}
                onInstruct={isInboxConversation ? (text) => {
                  setInput(text);
                  // Focus the textarea
                  const textarea = document.querySelector<HTMLTextAreaElement>(".chat-compose textarea");
                  textarea?.focus();
                } : undefined}
              />
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {selectedMessageIds.length > 0 && (
          <div className="chat-selection-toolbar">
            <span className="chat-selection-count">{selectedMessageIds.length} selected</span>
            <button type="button" className="msg-action-btn" onClick={handleCopySelectedMessages}>Copy</button>
            <button type="button" className="msg-action-btn msg-action-btn--warn" onClick={() => { void handleDeleteSelectedMessages(); }}>Delete</button>
            <button type="button" className="msg-action-btn" onClick={handleClearSelectedMessages}>Clear</button>
          </div>
        )}

        <ConversationTotals messages={messages} />
        <div className="chat-sim-toolbar chat-sim-toolbar--simple">
          <div className="chat-sim-summary">
            <div className="chat-sim-status-row">
              {simulationCaseName && (
                <Badge status="info">Simulating case: {simulationCaseName}</Badge>
              )}
            </div>
            <MetaText size="xs">
              Autopilot is active. Logs in <a href="/logs">/logs</a>
            </MetaText>
            <MetaText size="xs">
              Command: <code>/ticket reason</code> creates a Things item in JOI/Inbox with full chat context.
            </MetaText>
            {ticketNote && <MetaText size="xs" className="chat-qa-note">{ticketNote}</MetaText>}
          </div>
        </div>
        <form className="chat-compose" onSubmit={handleSubmit}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,audio/*,text/plain,text/markdown,text/csv,application/json"
            multiple
            onChange={handleComposerPickFiles}
            style={{ display: "none" }}
          />
          {(replyTarget || forwardTarget) && (
            <div className="chat-compose-context">
              {replyTarget && (
                <div className="chat-compose-context-item">
                  <span className="chat-compose-context-label">Replying to {replyTarget.role}</span>
                  <span className="chat-compose-context-preview">{replyTarget.preview}</span>
                  <button
                    type="button"
                    className="chat-compose-context-clear"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Clear reply target"
                  >
                    ×
                  </button>
                </div>
              )}
              {forwardTarget && (
                <div className="chat-compose-context-item">
                  <span className="chat-compose-context-label">Forwarding {forwardTarget.role}</span>
                  <span className="chat-compose-context-preview">{forwardTarget.preview}</span>
                  <button
                    type="button"
                    className="chat-compose-context-clear"
                    onClick={() => setForwardTarget(null)}
                    aria-label="Clear forward target"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}
          {composerAttachments.length > 0 && (
            <div className="chat-compose-attachments">
              {composerAttachments.map((att) => (
                <div key={att.id} className="chat-compose-attachment-pill">
                  {att.type === "photo" ? (
                    <img
                      src={att.data}
                      alt={att.name}
                      className="chat-compose-attachment-thumb"
                    />
                  ) : (
                    <span className="chat-compose-attachment-thumb chat-compose-attachment-thumb--file">
                      {att.type === "audio" ? "A" : "F"}
                    </span>
                  )}
                  <span>{att.name}</span>
                  <button
                    type="button"
                    className="chat-compose-attachment-remove"
                    onClick={() => removeComposerAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || composerAttachments.length >= MAX_COMPOSER_ATTACHMENTS || ws.status !== "connected"}
            title={composerAttachments.length >= MAX_COMPOSER_ATTACHMENTS ? `Maximum ${MAX_COMPOSER_ATTACHMENTS} attachments` : "Attach files"}
          >
            +
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              const supported = files.filter((file) => isAllowedComposerFile(file));
              if (supported.length > 0) {
                e.preventDefault();
                void addComposerAttachments(supported);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Message JOI..."
            disabled={ws.status !== "connected"}
            autoFocus
            rows={1}
          />
          {mentionSuggestions.length > 0 && (
            <div className="chat-mention-suggestions">
              {mentionSuggestions.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="chat-mention-suggestion"
                  onClick={() => insertMention(agent)}
                >
                  <span className="chat-mention-suggestion-id">@{agent.id}</span>
                  {agent.name && <span className="chat-mention-suggestion-name">{agent.name}</span>}
                </button>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={(!input.trim() && composerAttachments.length === 0 && !forwardTarget) || isStreaming || ws.status !== "connected"}
          >
            {isStreaming ? "..." : "Send"}
          </button>
        </form>
      </div>
      <ConversationHistoryPanel
        conversationId={conversationId}
        conversationAgentId={activeConversation?.agent_id || null}
        messages={messages}
        agents={agents}
      />
    </div>
  );
}

function ConversationTotals({ messages }: { messages: ChatMessage[] }) {
  const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.isStreaming);
  if (assistantMsgs.length === 0) return null;

  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;
  let assistantTokens = 0;
  let toolTokens = 0;
  let assistantCost = 0;
  let toolCost = 0;
  let hasAssistantBreakdown = false;
  let hasToolBreakdown = false;
  let hasAnyCostValue = false;

  for (const m of assistantMsgs) {
    if (m.usage) totalTokens += m.usage.inputTokens + m.usage.outputTokens;
    if (typeof m.costUsd === "number") {
      totalCost += m.costUsd;
      hasAnyCostValue = true;
    }
    if (m.latencyMs) totalLatency += m.latencyMs;

    if (m.assistantUsage) {
      assistantTokens += m.assistantUsage.inputTokens + m.assistantUsage.outputTokens;
      hasAssistantBreakdown = true;
    }
    if (m.toolUsage) {
      toolTokens += m.toolUsage.inputTokens + m.toolUsage.outputTokens;
      hasToolBreakdown = true;
    }
    if (!m.assistantUsage && !m.toolUsage && m.usage) {
      assistantTokens += m.usage.inputTokens + m.usage.outputTokens;
      hasAssistantBreakdown = true;
    }

    if (typeof m.assistantCostUsd === "number") {
      assistantCost += m.assistantCostUsd;
      hasAssistantBreakdown = true;
      hasAnyCostValue = true;
    }
    if (typeof m.toolCostUsd === "number") {
      toolCost += m.toolCostUsd;
      hasToolBreakdown = true;
      hasAnyCostValue = true;
    }
    if (m.assistantCostUsd === undefined && m.toolCostUsd === undefined && typeof m.costUsd === "number") {
      assistantCost += m.costUsd;
      hasAssistantBreakdown = true;
    }
  }

  if (totalTokens === 0 && totalCost === 0) return null;

  const parts: string[] = [];
  if (totalTokens > 0) parts.push(`${totalTokens.toLocaleString()} tok`);
  if (hasAnyCostValue) {
    parts.push(formatUsd(totalCost));
  }
  if (hasAssistantBreakdown && assistantTokens > 0) {
    parts.push(`assistant ${assistantTokens.toLocaleString()} tok`);
  }
  if (hasToolBreakdown && toolTokens > 0) {
    parts.push(`tools ${toolTokens.toLocaleString()} tok`);
  }
  if (hasAssistantBreakdown && hasAnyCostValue) {
    parts.push(`assistant ${formatUsd(assistantCost)}`);
  }
  if (hasToolBreakdown && hasAnyCostValue) {
    parts.push(`tools ${formatUsd(toolCost)}`);
  }
  parts.push(`${(totalLatency / 1000).toFixed(1)}s`);
  parts.push(`${assistantMsgs.length} msgs`);

  return (
    <div className="chat-totals">
      {parts.map((p, i) => (
        <MetaText key={i} size="xs">
          {i > 0 && <span className="chat-separator">&middot;</span>}
          {p}
        </MetaText>
      ))}
    </div>
  );
}

function formatHistoryTimestamp(iso?: string): string {
  if (!iso) return "pending";
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatHistoryTimestampLong(iso?: string): string {
  if (!iso) return "pending";
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function formatHistoryGap(previousIso?: string, nextIso?: string): string | null {
  if (!previousIso || !nextIso) return null;
  const previous = new Date(previousIso).getTime();
  const next = new Date(nextIso).getTime();
  if (!Number.isFinite(previous) || !Number.isFinite(next) || next <= previous) return null;

  const seconds = Math.round((next - previous) / 1000);
  if (seconds < 60) return `+${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `+${minutes}m ${remainingSeconds}s` : `+${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `+${hours}h ${remainingMinutes}m` : `+${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `+${days}d ${remainingHours}h` : `+${days}d`;
}

function formatUsd(amount: number): string {
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(3)}`;
}

function summarizeHistoryContent(content: string): string {
  const compact = (content || "").replace(/\s+/g, " ").trim();
  if (!compact) return "(no text)";
  return compact.length > 190 ? `${compact.slice(0, 187)}...` : compact;
}

function ConversationHistoryPanel({
  conversationId,
  conversationAgentId,
  messages,
  agents,
}: {
  conversationId: string | null;
  conversationAgentId: string | null;
  messages: ChatMessage[];
  agents: AgentSummary[];
}) {
  const [copiedPayload, setCopiedPayload] = useState<"transcript" | "json" | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const assistantMessages = messages.filter((message) => message.role === "assistant" && !message.isStreaming);
  const totalTurns = messages.filter((message) => message.role === "user" || message.role === "assistant").length;
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent] as const)),
    [agents],
  );

  const agentIdsInPlay = useMemo(() => {
    const ids = new Set<string>();
    if (conversationAgentId) ids.add(conversationAgentId);
    for (const message of messages) {
      if (message.agentId) ids.add(message.agentId);
      for (const delegation of message.delegations || []) {
        if (delegation.agentId) ids.add(delegation.agentId);
      }
    }
    return [...ids];
  }, [conversationAgentId, messages]);

  const configuredSkills = useMemo(() => {
    const skills = new Set<string>();
    for (const agentId of agentIdsInPlay) {
      const agent = agentsById.get(agentId);
      for (const skill of agent?.skills || []) {
        const trimmed = skill.trim();
        if (trimmed.length > 0) skills.add(trimmed);
      }
    }
    return [...skills].sort((a, b) => a.localeCompare(b));
  }, [agentIdsInPlay, agentsById]);

  const observedModels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      if (message.model) {
        counts.set(message.model, (counts.get(message.model) || 0) + 1);
      }
      if (message.toolModel) {
        counts.set(`tools:${message.toolModel}`, (counts.get(`tools:${message.toolModel}`) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [messages]);

  const observedTools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      for (const toolCall of message.toolCalls || []) {
        const key = toolCall.name?.trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [messages]);

  const transcriptPayload = useMemo(() => {
    if (messages.length === 0) return "";
    const header = [
      `Conversation: ${conversationId || "pending"}`,
      `Agent: ${conversationAgentId || "unknown"}`,
      `Generated: ${new Date().toISOString()}`,
      "",
    ].join("\n");

    const body = messages.map((message, index) => {
      const lines: string[] = [];
      const metaParts = [
        `#${index + 1}`,
        message.role.toUpperCase(),
        formatHistoryTimestampLong(message.createdAt),
      ];
      if (message.model) metaParts.push(`model=${message.model}`);
      if (message.toolModel) metaParts.push(`toolModel=${message.toolModel}`);
      if (message.provider) metaParts.push(`provider=${message.provider}`);
      if (message.agentId) metaParts.push(`agent=${message.agentId}`);
      lines.push(metaParts.join(" | "));
      if (message.toolCalls && message.toolCalls.length > 0) {
        lines.push(`tools: ${message.toolCalls.map((toolCall) => toolCall.name).join(", ")}`);
      }
      lines.push((message.content || "").trim() || "(no text)");
      return lines.join("\n");
    }).join("\n\n---\n\n");

    return `${header}${body}`;
  }, [conversationAgentId, conversationId, messages]);

  const jsonPayload = useMemo(() => (
    JSON.stringify({
      conversationId,
      conversationAgentId,
      exportedAt: new Date().toISOString(),
      messages,
    }, null, 2)
  ), [conversationAgentId, conversationId, messages]);

  const copyPayload = useCallback((kind: "transcript" | "json", value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopiedPayload(kind);
        window.setTimeout(() => {
          setCopiedPayload((current) => (current === kind ? null : current));
        }, 1400);
      })
      .catch(() => {});
  }, []);

  const handleCopyMessage = useCallback((message: ChatMessage) => {
    const payload = (message.content || "").trim();
    if (!payload) return;
    navigator.clipboard.writeText(payload)
      .then(() => {
        setCopiedMessageId(message.id);
        window.setTimeout(() => {
          setCopiedMessageId((current) => (current === message.id ? null : current));
        }, 1200);
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="chat-history-panel">
      <div className="chat-history-header">
        <MetaText className="text-md font-semibold text-secondary">Debug Flow</MetaText>
        <MetaText size="xs">
          {assistantMessages.length} assistant / {totalTurns} turns
        </MetaText>
        {conversationId && (
          <MetaText size="xs" className="chat-history-conversation-id">
            {conversationId}
          </MetaText>
        )}
        <div className="chat-history-actions">
          <button
            type="button"
            className="chat-history-copy-btn"
            onClick={() => copyPayload("transcript", transcriptPayload)}
            disabled={messages.length === 0}
          >
            {copiedPayload === "transcript" ? "Copied Transcript" : "Copy Transcript"}
          </button>
          <button
            type="button"
            className="chat-history-copy-btn"
            onClick={() => copyPayload("json", jsonPayload)}
            disabled={messages.length === 0}
          >
            {copiedPayload === "json" ? "Copied JSON" : "Copy JSON"}
          </button>
        </div>
      </div>
      <div className="chat-history-summary">
        <div className="chat-history-section">
          <MetaText size="xs" className="chat-history-section-label">Agents</MetaText>
          <div className="chat-history-chip-row">
            {agentIdsInPlay.length === 0 && <span className="chat-history-empty-chip">none</span>}
            {agentIdsInPlay.map((agentId) => {
              const agent = agentsById.get(agentId);
              const label = agent?.name?.trim() ? `${agent.name} (${agentId})` : agentId;
              return (
                <span key={agentId} className="chat-history-chip">{label}</span>
              );
            })}
          </div>
        </div>
        <div className="chat-history-section">
          <MetaText size="xs" className="chat-history-section-label">Configured Skills</MetaText>
          <div className="chat-history-chip-row">
            {configuredSkills.length === 0 && <span className="chat-history-empty-chip">none visible</span>}
            {configuredSkills.map((skill) => (
              <span key={skill} className="chat-history-chip">{skill}</span>
            ))}
          </div>
        </div>
        <div className="chat-history-section">
          <MetaText size="xs" className="chat-history-section-label">Observed Models</MetaText>
          <div className="chat-history-chip-row">
            {observedModels.length === 0 && <span className="chat-history-empty-chip">none</span>}
            {observedModels.map(([model, count]) => (
              <span key={model} className="chat-history-chip">
                {model.startsWith("tools:") ? `tools ${shortModelName(model.slice(6))}` : shortModelName(model)} x{count}
              </span>
            ))}
          </div>
        </div>
        <div className="chat-history-section">
          <MetaText size="xs" className="chat-history-section-label">Observed Tools</MetaText>
          <div className="chat-history-chip-row">
            {observedTools.length === 0 && <span className="chat-history-empty-chip">none</span>}
            {observedTools.map(([tool, count]) => (
              <span key={tool} className="chat-history-chip">{formatToolName(tool)} x{count}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="chat-history-list">
        {messages.length === 0 && (
          <MetaText size="sm" className="chat-history-empty">No history yet.</MetaText>
        )}
        {messages.map((message, index) => {
          const previousMessage = index > 0 ? messages[index - 1] : null;
          const flowDelta = previousMessage ? formatHistoryGap(previousMessage.createdAt, message.createdAt) : null;
          const assistantTokenCount = message.assistantUsage
            ? (message.assistantUsage.inputTokens + message.assistantUsage.outputTokens)
            : (!message.toolUsage && message.usage ? (message.usage.inputTokens + message.usage.outputTokens) : null);
          const toolTokenCount = message.toolUsage
            ? (message.toolUsage.inputTokens + message.toolUsage.outputTokens)
            : null;
          const fallbackTokenCount = assistantTokenCount === null && toolTokenCount === null && message.usage
            ? (message.usage.inputTokens + message.usage.outputTokens)
            : null;
          const assistantCost = typeof message.assistantCostUsd === "number"
            ? message.assistantCostUsd
            : (message.toolCostUsd === undefined && typeof message.costUsd === "number" ? message.costUsd : undefined);
          const toolCost = typeof message.toolCostUsd === "number" ? message.toolCostUsd : undefined;
          const fallbackCost = assistantCost === undefined && toolCost === undefined && typeof message.costUsd === "number"
            ? message.costUsd
            : undefined;
          const assistantCostLabel = typeof assistantCost === "number"
            ? `assistant ${formatUsd(assistantCost)}`
            : null;
          const toolCostLabel = typeof toolCost === "number"
            ? `tools ${formatUsd(toolCost)}`
            : null;
          const fallbackCostLabel = typeof fallbackCost === "number"
            ? formatUsd(fallbackCost)
            : null;
          const latencyLabel = typeof message.latencyMs === "number" && message.latencyMs > 0
            ? formatDuration(message.latencyMs)
            : null;
          const modelLabel = message.model ? shortModelName(message.model) : null;
          const actionsModelLabel = message.toolModel ? shortModelName(message.toolModel) : null;
          const toolNames = (message.toolCalls || [])
            .map((toolCall) => formatToolName(toolCall.name))
            .filter((name) => name.length > 0);
          const roleLabel = message.role === "assistant"
            ? "Assistant"
            : message.role === "user"
              ? "User"
              : "System";

          return (
            <div key={message.id || `${message.role}-${index}`} className={`chat-history-item chat-history-item-${message.role}`}>
              <div className="chat-history-item-top">
                <div className="chat-history-item-ident">
                  <span className="chat-history-order">#{index + 1}</span>
                  <span className={`chat-history-role chat-history-role-${message.role}`}>{roleLabel}</span>
                </div>
                <div className="chat-history-item-timewrap">
                  <span className="chat-history-time">{formatHistoryTimestamp(message.createdAt)}</span>
                  {flowDelta && <span className="chat-history-gap">{flowDelta}</span>}
                </div>
              </div>
              <div className="chat-history-models">
                {modelLabel && <Badge status="muted" className="chat-history-badge">{modelLabel}</Badge>}
                {actionsModelLabel && <Badge status="info" className="chat-history-badge">tools: {actionsModelLabel}</Badge>}
                {message.provider && <Badge status="muted" className="chat-history-badge">{message.provider}</Badge>}
              </div>
              <div className="chat-history-metrics">
                {assistantTokenCount !== null && <span className="chat-history-metric-assistant">assistant {assistantTokenCount.toLocaleString()} tok</span>}
                {toolTokenCount !== null && <span className="chat-history-metric-tool">tools {toolTokenCount.toLocaleString()} tok</span>}
                {fallbackTokenCount !== null && <span className="chat-history-metric-total">{fallbackTokenCount.toLocaleString()} tok</span>}
                {assistantCostLabel && <span className="chat-history-metric-assistant">{assistantCostLabel}</span>}
                {toolCostLabel && <span className="chat-history-metric-tool">{toolCostLabel}</span>}
                {fallbackCostLabel && <span className="chat-history-metric-total">{fallbackCostLabel}</span>}
                {latencyLabel && <span>{latencyLabel}</span>}
              </div>
              {toolNames.length > 0 && (
                <MetaText size="xs" className="chat-history-tools">
                  tools: {toolNames.slice(0, 4).join(", ")}
                  {toolNames.length > 4 ? " +" : ""}
                </MetaText>
              )}
              <div className="chat-history-content-wrap">
                <div className="chat-history-content">
                  {message.content?.trim() ? message.content : summarizeHistoryContent(message.content)}
                </div>
                <button
                  type="button"
                  className="chat-history-inline-copy"
                  onClick={() => handleCopyMessage(message)}
                  disabled={!message.content?.trim()}
                >
                  {copiedMessageId === message.id ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** Detect if content looks like an email (starts with Subject:) */
function isEmailContent(content: string): boolean {
  return content.startsWith("Subject:");
}

/** Parse email: extract subject line and body */
function parseEmail(content: string): { subject: string; body: string } {
  const firstNewline = content.indexOf("\n");
  const subjectLine = (firstNewline >= 0 ? content.slice(0, firstNewline) : content)
    .replace(/^Subject:\s*/, "").trim();
  const body = firstNewline >= 0 ? content.slice(firstNewline + 1).trim() : "";
  return { subject: subjectLine, body };
}

function isHtml(text: string): boolean {
  return /<(html|div|table|p|span|a|img)\b/i.test(text);
}

function EmailView({ content }: { content: string }) {
  const { subject, body } = parseEmail(content);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(200);
  const htmlMode = isHtml(body);

  useEffect(() => {
    if (!htmlMode) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 12px; font-family: -apple-system, system-ui, sans-serif; font-size: 13px; color: #e0e0e0; background: transparent; overflow-x: hidden; word-break: break-word; }
      a { color: #ff5a1f; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100% !important; }
    </style></head><body>${body}</body></html>`);
    doc.close();
    const resize = () => {
      const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 200;
      setIframeHeight(Math.min(h + 16, 600));
    };
    iframe.onload = resize;
    setTimeout(resize, 100);
    setTimeout(resize, 500);
  }, [body, htmlMode]);

  return (
    <div className="email-view">
      <div className="email-subject">{subject}</div>
      {htmlMode ? (
        <iframe
          ref={iframeRef}
          className="email-iframe"
          style={{ height: iframeHeight }}
          sandbox="allow-same-origin"
          title="Email content"
        />
      ) : (
        <div className="email-body">{body}</div>
      )}
    </div>
  );
}

const ATTACHMENT_ICONS: Record<string, string> = {
  photo: "\uD83D\uDDBC\uFE0F",
  video: "\uD83C\uDFA5",
  audio: "\uD83C\uDFB5",
  voice: "\uD83C\uDF99\uFE0F",
  document: "\uD83D\uDCC4",
  sticker: "\uD83E\uDEAA",
  unknown: "\uD83D\uDCCE",
};

function AttachmentBadges({ attachments }: { attachments: Attachment[] }) {
  const [lightboxAtt, setLightboxAtt] = useState<Attachment | null>(null);

  return (
    <>
      <div className="chat-attachments">
        {attachments.map((att, i) => {
          const hasMedia = att.mediaId && att.status === "ready";
          const isImage = att.type === "photo" || att.mimeType?.startsWith("image/");
          const hasInlineDataImage = Boolean(!hasMedia && isImage && att.fileUrl?.startsWith("data:"));

          // Inline thumbnail for downloaded images
          if ((hasMedia && isImage && att.thumbnailUrl) || hasInlineDataImage) {
            return (
              <img
                key={i}
                src={hasInlineDataImage ? att.fileUrl : att.thumbnailUrl}
                alt={att.filename || "photo"}
                className="chat-attachment-thumb"
                onClick={hasMedia ? () => setLightboxAtt(att) : undefined}
                loading="lazy"
              />
            );
          }

          const icon = ATTACHMENT_ICONS[att.type] || ATTACHMENT_ICONS.unknown;
          const label = att.filename || att.type;
          const sizeStr = att.size ? ` (${(att.size / 1024).toFixed(0)} KB)` : "";
          return (
            <span
              key={i}
              className={`chat-attachment-badge${hasMedia ? " chat-attachment-badge--clickable" : ""}`}
              onClick={hasMedia ? () => setLightboxAtt(att) : undefined}
            >
              {icon} {label}{sizeStr}
            </span>
          );
        })}
      </div>
      {lightboxAtt && (
        <ChatMediaLightbox attachment={lightboxAtt} onClose={() => setLightboxAtt(null)} />
      )}
    </>
  );
}

function ChatMediaLightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  if (!attachment.mediaId || !attachment.fileUrl) return null;
  const isImage = attachment.type === "photo" || attachment.mimeType?.startsWith("image/");
  const isVideo = attachment.type === "video" || attachment.mimeType?.startsWith("video/");
  const isAudio = attachment.type === "audio" || attachment.type === "voice" || attachment.mimeType?.startsWith("audio/");

  return (
    <Modal open onClose={onClose} width="80vw">
      <div className="media-lightbox">
        <div className="media-lightbox-preview">
          {isImage && <img src={attachment.fileUrl} alt={attachment.filename || "image"} className="media-lightbox-img" />}
          {isVideo && <video src={attachment.fileUrl} controls className="media-lightbox-video" />}
          {isAudio && <audio src={attachment.fileUrl} controls />}
          {!isImage && !isVideo && !isAudio && (
            <a href={attachment.fileUrl} download={attachment.filename || "download"}>Download {attachment.filename || "file"}</a>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LinkPreviewCard({ preview }: { preview: LinkPreviewPayload }) {
  const siteLabel = preview.siteName || (() => {
    try {
      return new URL(preview.url).hostname;
    } catch {
      return "";
    }
  })();

  return (
    <a
      className="chat-link-preview"
      href={preview.url}
      target="_blank"
      rel="noreferrer"
    >
      {preview.imageUrl && (
        <img
          src={preview.imageUrl}
          alt=""
          className="chat-link-preview-image"
          loading="lazy"
        />
      )}
      <div className="chat-link-preview-body">
        {siteLabel && <div className="chat-link-preview-site">{siteLabel}</div>}
        <div className="chat-link-preview-title">{preview.title}</div>
        {preview.description && (
          <div className="chat-link-preview-description">{preview.description}</div>
        )}
      </div>
    </a>
  );
}

function MessageActions({ copied, onCopy, onInstruct, onTask, onExtract }: {
  copied: boolean;
  onCopy: () => void;
  onInstruct: () => void;
  onTask: () => void;
  onExtract: () => void;
}) {
  return (
    <div className="msg-actions">
      <button className="msg-action-btn" onClick={onCopy} title="Copy message">
        {copied ? "Copied!" : "Copy"}
      </button>
      <button className="msg-action-btn msg-action-btn--primary" onClick={onInstruct} title="Give JOI instructions about this message">
        Instruct
      </button>
      <button className="msg-action-btn" onClick={onTask} title="Create a task from this message">
        Task
      </button>
      <button className="msg-action-btn" onClick={onExtract} title="Extract key information">
        Extract
      </button>
    </div>
  );
}

function MessageBubble({
  message,
  replyPreview,
  onReply,
  onForward,
  onToggleReaction,
  onPin,
  onReport,
  onDelete,
  onSelect,
  onSelectOnly,
  isSelected,
  selectionMode,
  onInstruct,
}: {
  message: ChatMessage;
  replyPreview?: string | null;
  onReply?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onPin?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onSelect?: (message: ChatMessage) => void;
  onSelectOnly?: (message: ChatMessage) => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onInstruct?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<LinkPreviewPayload | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /** Get short context string for pre-filling chat input */
  const getMessageContext = (): string => {
    if (isEmailContent(message.content)) {
      const { subject } = parseEmail(message.content);
      // Try to extract sender from "From: X" in the email body
      const fromMatch = message.content.match(/^From:\s*(.+)$/m);
      const sender = fromMatch?.[1]?.trim() || "";
      return sender ? `${subject} from ${sender}` : subject;
    }
    return message.content.slice(0, 120).replace(/\n/g, " ");
  };

  const handleInstruct = () => {
    if (!onInstruct) return;
    const ctx = getMessageContext();
    onInstruct(`[Re: ${ctx}]\n\n`);
  };

  const handleTask = () => {
    if (!onInstruct) return;
    const ctx = getMessageContext();
    onInstruct(`Create a task from this: ${ctx}`);
  };

  const handleExtract = () => {
    if (!onInstruct) return;
    onInstruct("Extract the key information from this message and save it");
  };
  if (message.role === "system") {
    return (
      <div className="chat-message chat-message-system">
        {message.content}
      </div>
    );
  }

  const emailMode = message.role === "user" && isEmailContent(message.content);
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const hasToolCalls = Boolean(message.toolCalls && message.toolCalls.length > 0);
  const hasPlannedSteps = Boolean(message.plannedSteps && message.plannedSteps.length > 0);
  const forwardMeta = message.forwardingMetadata && typeof message.forwardingMetadata === "object"
    ? message.forwardingMetadata
    : null;
  const forwardSourceRole = typeof forwardMeta?.sourceRole === "string" ? forwardMeta.sourceRole : null;
  const mentionValues = (message.mentions || [])
    .map((mention) => (typeof mention.value === "string" ? mention.value.trim() : ""))
    .filter((value) => value.length > 0);
  const linkUrl = firstHttpUrl(message.content);
  const timestampLabel = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const hasComposerActions = !message.isStreaming && Boolean(
    onReply || onForward || onPin || onReport || onDelete || onSelectOnly,
  );
  const reactionEntries = Object.entries(message.reactions || {})
    .map(([emoji, actors]) => {
      const actorList = Array.isArray(actors)
        ? actors.filter((actor): actor is string => typeof actor === "string")
        : [];
      if (actorList.length === 0) return null;
      return {
        emoji,
        count: actorList.length,
        reacted: actorList.includes(REACTION_ACTOR_ID),
      };
    })
    .filter((entry): entry is { emoji: string; count: number; reacted: boolean } => Boolean(entry))
    .sort((a, b) => b.count - a.count);
  const canReact = Boolean(onToggleReaction) && !message.isStreaming && message.role === "assistant";

  useEffect(() => {
    if (!linkUrl) {
      setPreview(null);
      return;
    }
    let active = true;
    loadLinkPreview(linkUrl).then((payload) => {
      if (!active) return;
      setPreview(payload);
    });
    return () => {
      active = false;
    };
  }, [linkUrl]);

  return (
    <div className={`chat-message ${message.role}${emailMode ? " chat-message-email" : ""}${isSelected ? " chat-message-selected" : ""}`}>
      {selectionMode && (
        <label className="chat-message-select-toggle">
          <input
            type="checkbox"
            checked={Boolean(isSelected)}
            onChange={() => onSelect?.(message)}
          />
          <span>Select</span>
        </label>
      )}
      {message.pinned && (
        <div className="chat-message-context chat-message-context--pin">
          📌 Pinned
        </div>
      )}
      {message.reported && (
        <div className="chat-message-context chat-message-context--report">
          ⚠️ Reported{message.reportNote ? `: ${message.reportNote}` : ""}
        </div>
      )}
      {message.replyToMessageId && (
        <div className="chat-message-context chat-message-context--reply">
          Replying to {replyPreview || `message ${message.replyToMessageId.slice(0, 8)}`}
        </div>
      )}
      {message.forwardOfMessageId && (
        <div className="chat-message-context chat-message-context--forward">
          Forwarded{forwardSourceRole ? ` from ${forwardSourceRole}` : ""}
        </div>
      )}
      {mentionValues.length > 0 && (
        <div className="chat-message-mentions">
          {mentionValues.slice(0, 4).map((value, index) => (
            <span key={`${message.id}-${value}-${index}`} className="chat-message-mention-chip">@{value}</span>
          ))}
        </div>
      )}
      {message.role === "assistant" ? (
        <>
          <div className="joi-avatar-row">
            <JoiOrb
              className="joi-msg-avatar"
              size={22}
              active
              intensity={message.isStreaming ? 0.5 : 0.22}
              variant={message.isStreaming ? "firestorm" : "transparent"}
              rings={2}
              animated
              ariaLabel="JOI"
            />
            <MetaText size="xs" className="text-accent font-semibold joi-label">JOI</MetaText>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{message.content}</ReactMarkdown>
          {preview && <LinkPreviewCard preview={preview} />}
          {message.isStreaming && !message.content && (
            <div className="streaming-indicator">
              <span /><span /><span />
            </div>
          )}
          {(hasToolCalls || hasPlannedSteps) && (
            <div className="flex-col gap-1 mt-2">
              {hasToolCalls && (message.toolModel || message.model) && (() => {
                const actionsModel = message.toolModel || message.model || "";
                const actionsProvider = message.toolProvider || message.provider;
                return (
                  <div className="flex-row gap-1 text-xs text-muted">
                    <MetaText size="xs" className="opacity-50">actions via</MetaText>
                    <Badge
                      status="muted"
                      className={`chat-model-badge${actionsProvider === "ollama" ? " chat-model-badge--local" : ""}`}
                    >
                      {shortModelName(actionsModel)}
                    </Badge>
                  </div>
                );
              })()}
              {hasToolCalls && (
                <div className="chat-tool-badges">
                  {message.toolCalls!.map((tc) => (
                    <ChatToolBadge key={tc.id} tc={tc} />
                  ))}
                </div>
              )}
              <ChatToolChecklist toolCalls={message.toolCalls || []} plannedSteps={message.plannedSteps} />
            </div>
          )}
          {!message.isStreaming && (message.model || message.usage || message.latencyMs || message.toolCalls?.length) && (
            <MessageMeta message={message} />
          )}
                </>
              ) : emailMode ? (
                <>
                  <EmailView content={message.content} />
                  {hasAttachments && <AttachmentBadges attachments={message.attachments!} />}
                  {onInstruct && <MessageActions copied={copied} onCopy={handleCopy} onInstruct={handleInstruct} onTask={handleTask} onExtract={handleExtract} />}
                </>
              ) : (
                <>
                  {message.content && <span>{message.content}</span>}
                  {preview && <LinkPreviewCard preview={preview} />}
                  {hasAttachments && <AttachmentBadges attachments={message.attachments!} />}
                  {message.role === "user" && onInstruct && (
                    <MessageActions copied={copied} onCopy={handleCopy} onInstruct={handleInstruct} onTask={handleTask} onExtract={handleExtract} />
                  )}
                </>
              )}
      {timestampLabel && (
        <div className="chat-message-time">
          {timestampLabel}
        </div>
      )}
      {(reactionEntries.length > 0 || canReact) && (
        <div className="chat-message-reactions">
          {reactionEntries.map((reaction) => (
            <button
              key={`${message.id}-${reaction.emoji}`}
              type="button"
              className={`chat-message-reaction${reaction.reacted ? " chat-message-reaction--active" : ""}`}
              onClick={() => onToggleReaction?.(message, reaction.emoji)}
              title={`Toggle ${reaction.emoji} reaction`}
            >
              <span>{reaction.emoji}</span>
              {reaction.count > 1 && <span className="chat-message-reaction-count">{reaction.count}</span>}
            </button>
          ))}
          {canReact && (
            <div className="chat-message-reaction-picker">
              {QUICK_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={`${message.id}-pick-${emoji}`}
                  type="button"
                  className="chat-message-reaction-btn"
                  onClick={() => onToggleReaction?.(message, emoji)}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {hasComposerActions && (
        <div className="msg-actions">
          {onReply && (
            <button
              type="button"
              className="msg-action-btn"
              onClick={() => onReply(message)}
              title="Reply to this message"
            >
              Reply
            </button>
          )}
          {onForward && (
            <button
              type="button"
              className="msg-action-btn"
              onClick={() => onForward(message)}
              title="Forward this message"
            >
              Forward
            </button>
          )}
          {onPin && (
            <button
              type="button"
              className={`msg-action-btn${message.pinned ? " msg-action-btn--primary" : ""}`}
              onClick={() => onPin(message)}
              title={message.pinned ? "Unpin message" : "Pin message"}
            >
              {message.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {onReport && (
            <button
              type="button"
              className="msg-action-btn msg-action-btn--warn"
              onClick={() => onReport(message)}
              title="Report this message"
            >
              Report
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="msg-action-btn msg-action-btn--warn"
              onClick={() => onDelete(message)}
              title="Delete this message"
            >
              Delete
            </button>
          )}
          {onSelectOnly && (
            <button
              type="button"
              className="msg-action-btn"
              onClick={() => onSelectOnly(message)}
              title="Select this message"
            >
              Select
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChatToolBadge({ tc }: { tc: ToolCall }) {
  const isError = tc.error;
  const isPending = tc.result === undefined;
  const source = getToolSourceIndicator(tc.name);
  const [elapsedMs, setElapsedMs] = useState<number>(() => {
    if (tc.startedAt) return Math.max(0, Date.now() - tc.startedAt);
    return 0;
  });

  useEffect(() => {
    const startedAt = tc.startedAt;
    if (!isPending || !startedAt) return;
    const iv = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 100);
    return () => window.clearInterval(iv);
  }, [isPending, tc.startedAt]);

  const durationMs = tc.durationMs != null
    ? tc.durationMs
    : (isPending && tc.startedAt ? elapsedMs : null);
  const durationLabel = durationMs != null ? formatDuration(durationMs) : null;
  const toolLabel = formatToolName(tc.name);

  return (
    <span
      className={`chat-tool-pill${isError ? " error" : isPending ? " pending" : " done"}`}
      title={tc.name}
    >
      <span
        className="tool-source-sigil"
        title={source.label}
        style={{ "--sig-c1": source.c1, "--sig-c2": source.c2 } as CSSProperties}
      >
        <span className="tool-source-pip" />
        <span className="tool-source-eq"><i /><i /><i /></span>
      </span>
      <span className="chat-tool-name">{toolLabel}</span>
      {durationLabel && <span className="chat-tool-duration">{durationLabel}</span>}
      {isPending && !isError && <span className="chat-tool-spinner" />}
    </span>
  );
}

function ChatToolChecklist({ toolCalls, plannedSteps }: { toolCalls: ToolCall[]; plannedSteps?: string[] }) {
  const normalizedPlan = (plannedSteps || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const total = Math.max(normalizedPlan.length, toolCalls.length);
  if (total === 0) return null;

  const checklist = Array.from({ length: total }, (_, index) => {
    const tc = toolCalls[index];
    const name = normalizedPlan[index] || (tc ? formatToolName(tc.name) : `Step ${index + 1}`);
    if (!tc) {
      return { id: `plan-${index}`, name, status: "pending" as const, durationMs: null };
    }
    const status = tc.error ? "error" : tc.result === undefined ? "pending" : "done";
    return { id: tc.id, name, status, durationMs: tc.durationMs ?? null };
  });

  const failed = checklist.filter((item) => item.status === "error").length;
  const pending = checklist.filter((item) => item.status === "pending").length;

  const title = pending > 0
    ? `Working checklist · ${pending} remaining`
    : failed > 0
      ? `Checklist finished · ${failed} failed`
      : "Checklist complete";

  return (
    <div className="chat-tool-checklist">
      <div className="chat-tool-checklist-title">{title}</div>
      <ul className="chat-tool-checklist-list">
        {checklist.map((item) => {
          return (
            <li key={item.id} className={`chat-tool-checklist-item ${item.status}`}>
              <span className={`chat-tool-checklist-icon ${item.status}`} />
              <span className="chat-tool-checklist-name">{item.name}</span>
              {item.durationMs != null && (
                <span className="chat-tool-checklist-time">{formatDuration(item.durationMs)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageMeta({ message }: { message: ChatMessage }) {
  const parts: Array<{ text: string; highlight?: boolean; color?: string }> = [];

  if (message.provider) {
    // Check if FULLY free: no paid providers AND no cost incurred
    const chatFree = message.provider === "ollama" || message.provider === "claude-code";
    const toolPaid = message.toolProvider && message.toolProvider !== "ollama";
    const hasCost = message.costUsd !== undefined && message.costUsd > 0;
    const isFree = chatFree && !toolPaid && !hasCost;

    if (message.provider === "claude-code") {
      parts.push({ text: "CLI", highlight: true });
    } else if (isFree) {
      parts.push({ text: "Free", highlight: true });
    } else if (!chatFree) {
      parts.push({ text: message.provider });
    }
    // When mixed (chat free + tool paid), skip provider label — cost tells the story
  }

  if (message.model) {
    parts.push({ text: shortModelName(message.model) });
  }

  if (message.usage) {
    const { inputTokens, outputTokens } = message.usage;
    const total = inputTokens + outputTokens;
    parts.push({ text: `${total.toLocaleString()} tok` });
    if (message.usage.voiceCache) {
      const hits = Number(message.usage.voiceCache.cacheHits || 0);
      const misses = Number(message.usage.voiceCache.cacheMisses || 0);
      const totalSegments = Number(message.usage.voiceCache.segments || (hits + misses));
      if (totalSegments > 0) {
        const rate = Math.round((hits / totalSegments) * 100);
        parts.push({ text: `cache ${rate}%` });
      }
    }
  }

  if (message.costUsd !== undefined && message.costUsd > 0) {
    const costStr = message.costUsd < 0.01
      ? `$${message.costUsd.toFixed(4)}`
      : `$${message.costUsd.toFixed(3)}`;
    parts.push({ text: costStr, color: "var(--warning, #ff9f0a)" });
  } else if (message.costUsd === 0 || (!message.costUsd && message.provider === "ollama" && !message.toolProvider)) {
    // Only show "free" cost indicator when truly free
  }

  if (message.latencyMs) {
    parts.push({ text: formatDuration(message.latencyMs) });
  }

  if (message.toolCalls?.length) {
    const completedToolDurations = message.toolCalls
      .map((tc) => tc.durationMs)
      .filter((ms): ms is number => typeof ms === "number");
    if (completedToolDurations.length > 0) {
      const totalToolMs = completedToolDurations.reduce((sum, ms) => sum + ms, 0);
      if (message.toolCalls.length === 1) {
        parts.push({ text: `${formatToolName(message.toolCalls[0].name)} ${formatDuration(totalToolMs)}` });
      } else {
        parts.push({ text: `tools ${formatDuration(totalToolMs)}` });
      }
    }
  }

  if (parts.length === 0) return null;

  return (
    <div className="chat-msg-meta">
      {parts.map((part, i) => {
        let className = "";
        if (part.highlight) className = "text-success font-semibold";

        return (
          <MetaText key={i} size="sm" className={className} style={part.color ? { color: part.color } : undefined}>
            {i > 0 && <span className="chat-separator">&middot;</span>}
            {part.text}
          </MetaText>
        );
      })}
    </div>
  );
}
