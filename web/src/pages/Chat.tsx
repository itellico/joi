import { useRef, useEffect, useState, useCallback } from "react";
import { useChat, type ChatMessage, type ToolCall, type Attachment } from "../hooks/useChat";
import type { ConnectionStatus, Frame } from "../hooks/useWebSocket";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { Badge, MetaText, EmptyState, Modal } from "../components/ui";
import { PageHeader } from "../components/ui/PageLayout";
import JoiOrb from "../components/JoiOrb";

function shortModelName(model: string): string {
  return model
    .replace("claude-sonnet-4-20250514", "Sonnet 4")
    .replace("claude-opus-4-20250514", "Opus 4")
    .replace("claude-haiku-3-20240307", "Haiku 3")
    .replace("anthropic/claude-sonnet-4", "Sonnet 4")
    .replace("anthropic/claude-opus-4", "Opus 4")
    .replace("anthropic/claude-3-haiku", "Haiku 3")
    .replace("anthropic/claude-3.5-haiku", "Haiku 3.5")
    .replace("openai/gpt-4o-mini", "GPT-4o Mini")
    .replace("openai/gpt-4o", "GPT-4o")
    .replace("google/gemini-2.0-flash-001", "Gemini Flash")
    .replace("google/gemini-2.5-pro-preview", "Gemini Pro")
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("google/", "")
    .replace("deepseek/", "")
    .replace("meta-llama/", "");
}

function formatDuration(ms: number): string {
  return ms < 1000
    ? `${Math.round(ms)}ms`
    : `${(ms / 1000).toFixed(1)}s`;
}

function formatToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === "contacts_search") return "Contact search";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

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

interface ChatProps {
  ws: {
    status: ConnectionStatus;
    send: (type: string, data?: unknown, id?: string) => void;
    on: (type: string, handler: (frame: Frame) => void) => () => void;
  };
  chatMode?: "api" | "claude-code";
}

interface QualitySuiteOption {
  id: string;
  name: string;
  agent_id?: string;
  tags?: string[];
}

type ChatExecutionMode = "live" | "shadow" | "dry_run";
type ChatLatencyPreset = "none" | "light" | "realistic" | "stress";

interface QaCaseDraft {
  suiteId: string;
  name: string;
  inputMessage: string;
  expectedTools: string;
  unexpectedTools: string;
  expectedContentPatterns: string;
  maxLatencyMs: string;
  minQualityScore: string;
  description: string;
}

function csvToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultQaSuiteId(suites: QualitySuiteOption[]): string {
  if (suites.length === 0) return "";
  const preferred = suites.find((suite) => suite.name.toLowerCase() === "core agent behavior");
  return preferred?.id || suites[0].id;
}

function chatLatencyProfileFromPreset(preset: ChatLatencyPreset): Record<string, number> | null {
  if (preset === "none") return null;
  if (preset === "light") {
    return { toolMinMs: 80, toolMaxMs: 250, responseMinMs: 120, responseMaxMs: 380, jitterMs: 40 };
  }
  if (preset === "realistic") {
    return { toolMinMs: 180, toolMaxMs: 900, responseMinMs: 300, responseMaxMs: 1400, jitterMs: 200 };
  }
  return { toolMinMs: 500, toolMaxMs: 2200, responseMinMs: 1200, responseMaxMs: 4200, jitterMs: 650 };
}

export default function Chat({ ws, chatMode = "api" }: ChatProps) {
  const { messages, isStreaming, conversationId, sendMessage, loadConversation } = useChat({
    send: ws.send,
    on: ws.on,
  });
  const [input, setInput] = useState("");
  const [chatExecutionMode, setChatExecutionMode] = useState<ChatExecutionMode>("live");
  const [chatLatencyPreset, setChatLatencyPreset] = useState<ChatLatencyPreset>("none");
  const [qaSuites, setQaSuites] = useState<QualitySuiteOption[]>([]);
  const [qaSuitesLoading, setQaSuitesLoading] = useState(false);
  const [qaCaseModalOpen, setQaCaseModalOpen] = useState(false);
  const [qaCaseSaving, setQaCaseSaving] = useState(false);
  const [qaCaseError, setQaCaseError] = useState<string | null>(null);
  const [qaCaseDraft, setQaCaseDraft] = useState<QaCaseDraft>({
    suiteId: "",
    name: "",
    inputMessage: "",
    expectedTools: "",
    unexpectedTools: "",
    expectedContentPatterns: "",
    maxLatencyMs: "",
    minQualityScore: "0.5",
    description: "",
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convFilter, setConvFilter] = useState<ConversationFilter>("inbox");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const ensureQaSuites = useCallback(async (): Promise<QualitySuiteOption[]> => {
    if (qaSuites.length > 0) return qaSuites;
    setQaSuitesLoading(true);
    try {
      const response = await fetch("/api/quality/suites");
      if (!response.ok) throw new Error("Failed to load quality suites");
      const data = await response.json();
      const suites = Array.isArray(data) ? data as QualitySuiteOption[] : [];
      setQaSuites(suites);
      return suites;
    } catch {
      return [];
    } finally {
      setQaSuitesLoading(false);
    }
  }, [qaSuites]);

  const openQaCaseFromAssistant = useCallback(async (assistantMessage: ChatMessage, userPrompt: string) => {
    const suites = await ensureQaSuites();
    if (suites.length === 0) {
      setQaCaseError("No QA suites available. Create one in /quality first.");
      setQaCaseModalOpen(true);
      return;
    }

    const expectedTools = Array.from(new Set(
      (assistantMessage.toolCalls || [])
        .map((call) => call.name)
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0),
    ));
    const normalizedPrompt = userPrompt.trim();
    const promptForCase = normalizedPrompt || "TODO: add user prompt";
    const nameSeed = promptForCase.replace(/\s+/g, " ").slice(0, 72);
    const suiteId = defaultQaSuiteId(suites);
    const latencyBudget = assistantMessage.latencyMs
      ? String(Math.max(1000, Math.round(assistantMessage.latencyMs * 1.25)))
      : "";

    setQaCaseDraft({
      suiteId,
      name: nameSeed ? `Chat case: ${nameSeed}` : "Chat case",
      inputMessage: promptForCase,
      expectedTools: expectedTools.join(", "),
      unexpectedTools: "",
      expectedContentPatterns: "",
      maxLatencyMs: latencyBudget,
      minQualityScore: "0.5",
      description: `Created from chat${conversationId ? ` ${conversationId}` : ""}`,
    });
    setQaCaseError(null);
    setQaCaseModalOpen(true);
  }, [conversationId, ensureQaSuites]);

  const saveQaCase = useCallback(async () => {
    if (!qaCaseDraft.suiteId.trim()) {
      setQaCaseError("Pick a suite.");
      return;
    }
    if (!qaCaseDraft.name.trim() || !qaCaseDraft.inputMessage.trim()) {
      setQaCaseError("Case name and input message are required.");
      return;
    }

    setQaCaseSaving(true);
    setQaCaseError(null);
    try {
      const response = await fetch(`/api/quality/suites/${qaCaseDraft.suiteId}/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: qaCaseDraft.name.trim(),
          description: qaCaseDraft.description.trim() || null,
          input_message: qaCaseDraft.inputMessage.trim(),
          expected_tools: csvToArray(qaCaseDraft.expectedTools),
          unexpected_tools: csvToArray(qaCaseDraft.unexpectedTools),
          expected_content_patterns: csvToArray(qaCaseDraft.expectedContentPatterns),
          max_latency_ms: qaCaseDraft.maxLatencyMs.trim() ? Number.parseInt(qaCaseDraft.maxLatencyMs, 10) : null,
          min_quality_score: Number.parseFloat(qaCaseDraft.minQualityScore) || 0.5,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to create QA case");
      }
      setQaCaseModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create QA case";
      setQaCaseError(message);
    } finally {
      setQaCaseSaving(false);
    }
  }, [qaCaseDraft]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const latencyProfile = chatLatencyProfileFromPreset(chatLatencyPreset);
    const simulationMetadata = chatMode === "claude-code"
      ? undefined
      : {
          executionMode: chatExecutionMode,
          ...(latencyProfile ? { latencyProfile } : {}),
        };
    sendMessage(input.trim(), chatMode, "personal", simulationMetadata);
    setInput("");
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

  // Derive unique accounts for filter chips
  const accounts = [...new Set(conversations.map((c) => c.channel_id).filter(Boolean))] as string[];

  const filteredConversations = conversations.filter((conv) => {
    if (accountFilter === "all") return true;
    return conv.channel_id === accountFilter;
  });
  const isInboxConversation = conversations.find((conv) => conv.id === conversationId)?.type === "inbox";

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
        <PageHeader title="Chats" />

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <JoiOrb
                className="chat-welcome-avatar"
                size={64}
                active
                intensity={0.24}
                variant="transparent"
                rings={3}
                ariaLabel="JOI"
              />
              <h3 className="chat-welcome-title">
                JOI
              </h3>
              <p>How can I help you today?</p>
            </div>
          )}

          {messages.map((msg, index) => {
            let previousUserText = "";
            for (let i = index - 1; i >= 0; i--) {
              if (messages[i].role === "user") {
                previousUserText = messages[i].content;
                break;
              }
            }

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                onInstruct={isInboxConversation ? (text) => {
                  setInput(text);
                  // Focus the textarea
                  const textarea = document.querySelector<HTMLTextAreaElement>(".chat-compose textarea");
                  textarea?.focus();
                } : undefined}
                onCreateQaCase={msg.role === "assistant" && !msg.isStreaming
                  ? () => { void openQaCaseFromAssistant(msg, previousUserText); }
                  : undefined}
              />
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        <ConversationTotals messages={messages} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "0 16px 8px" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            Mode
            <select
              value={chatExecutionMode}
              onChange={(e) => setChatExecutionMode(e.target.value as ChatExecutionMode)}
              disabled={chatMode === "claude-code"}
            >
              <option value="live">live</option>
              <option value="shadow">shadow</option>
              <option value="dry_run">dry_run</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            Latency
            <select
              value={chatLatencyPreset}
              onChange={(e) => setChatLatencyPreset(e.target.value as ChatLatencyPreset)}
              disabled={chatMode === "claude-code"}
            >
              <option value="none">none</option>
              <option value="light">light</option>
              <option value="realistic">realistic</option>
              <option value="stress">stress</option>
            </select>
          </label>
          {chatMode === "claude-code" && <MetaText size="xs">Simulation controls work in API mode only.</MetaText>}
        </div>
        <Modal
          open={qaCaseModalOpen}
          onClose={() => setQaCaseModalOpen(false)}
          title="Create QA Case from Chat"
          width={720}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <MetaText size="xs">Suite</MetaText>
              <select
                value={qaCaseDraft.suiteId}
                onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, suiteId: e.target.value }))}
                disabled={qaSuitesLoading || qaCaseSaving}
              >
                {qaSuites.length === 0 && <option value="">No suites</option>}
                {qaSuites.map((suite) => (
                  <option key={suite.id} value={suite.id}>{suite.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <MetaText size="xs">Case Name</MetaText>
              <input
                type="text"
                value={qaCaseDraft.name}
                onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, name: e.target.value }))}
                disabled={qaCaseSaving}
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <MetaText size="xs">Input Message</MetaText>
              <textarea
                rows={3}
                value={qaCaseDraft.inputMessage}
                onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, inputMessage: e.target.value }))}
                disabled={qaCaseSaving}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <MetaText size="xs">Expected Tools (CSV)</MetaText>
                <input
                  type="text"
                  value={qaCaseDraft.expectedTools}
                  onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, expectedTools: e.target.value }))}
                  disabled={qaCaseSaving}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <MetaText size="xs">Unexpected Tools (CSV)</MetaText>
                <input
                  type="text"
                  value={qaCaseDraft.unexpectedTools}
                  onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, unexpectedTools: e.target.value }))}
                  disabled={qaCaseSaving}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <MetaText size="xs">Expected Content Patterns (CSV)</MetaText>
                <input
                  type="text"
                  value={qaCaseDraft.expectedContentPatterns}
                  onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, expectedContentPatterns: e.target.value }))}
                  disabled={qaCaseSaving}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <MetaText size="xs">Max Latency (ms)</MetaText>
                <input
                  type="number"
                  value={qaCaseDraft.maxLatencyMs}
                  onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, maxLatencyMs: e.target.value }))}
                  disabled={qaCaseSaving}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <MetaText size="xs">Min Quality Score</MetaText>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={qaCaseDraft.minQualityScore}
                  onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, minQualityScore: e.target.value }))}
                  disabled={qaCaseSaving}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <MetaText size="xs">Description</MetaText>
              <input
                type="text"
                value={qaCaseDraft.description}
                onChange={(e) => setQaCaseDraft((prev) => ({ ...prev, description: e.target.value }))}
                disabled={qaCaseSaving}
              />
            </label>

            {qaCaseError && <MetaText size="xs" style={{ color: "var(--red)" }}>{qaCaseError}</MetaText>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="msg-action-btn" onClick={() => setQaCaseModalOpen(false)} disabled={qaCaseSaving}>Cancel</button>
              <button type="button" className="msg-action-btn msg-action-btn--primary" onClick={() => { void saveQaCase(); }} disabled={qaCaseSaving || qaSuitesLoading}>
                {qaCaseSaving ? "Creating..." : "Create Case"}
              </button>
            </div>
          </div>
        </Modal>
        <form className="chat-compose" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || ws.status !== "connected"}
          >
            {isStreaming ? "..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ConversationTotals({ messages }: { messages: ChatMessage[] }) {
  const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.isStreaming);
  if (assistantMsgs.length === 0) return null;

  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;

  for (const m of assistantMsgs) {
    if (m.usage) totalTokens += m.usage.inputTokens + m.usage.outputTokens;
    if (m.costUsd) totalCost += m.costUsd;
    if (m.latencyMs) totalLatency += m.latencyMs;
  }

  if (totalTokens === 0) return null;

  const parts: string[] = [];
  parts.push(`${totalTokens.toLocaleString()} tok`);
  if (totalCost > 0) {
    parts.push(totalCost < 0.01 ? `$${totalCost.toFixed(4)}` : `$${totalCost.toFixed(3)}`);
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
      a { color: #a78bfa; }
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

          // Inline thumbnail for downloaded images
          if (hasMedia && isImage && att.thumbnailUrl) {
            return (
              <img
                key={i}
                src={att.thumbnailUrl}
                alt={att.filename || "photo"}
                className="chat-attachment-thumb"
                onClick={() => setLightboxAtt(att)}
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
  onInstruct,
  onCreateQaCase,
}: {
  message: ChatMessage;
  onInstruct?: (text: string) => void;
  onCreateQaCase?: () => void;
}) {
  const [copied, setCopied] = useState(false);

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

  return (
    <div className={`chat-message ${message.role}${emailMode ? " chat-message-email" : ""}`}>
      {message.role === "assistant" ? (
        <>
          <div className="joi-avatar-row">
            <JoiOrb
              className="joi-msg-avatar"
              size={22}
              active={Boolean(message.isStreaming)}
              intensity={message.isStreaming ? 0.44 : 0.14}
              variant={message.isStreaming ? "firestorm" : "transparent"}
              rings={2}
              animated={Boolean(message.isStreaming)}
              ariaLabel="JOI"
            />
            <MetaText size="xs" className="text-accent font-semibold joi-label">JOI</MetaText>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{message.content}</ReactMarkdown>
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
          {!message.isStreaming && onCreateQaCase && (
            <div className="msg-actions">
              <button type="button" className="msg-action-btn" onClick={onCreateQaCase} title="Create a QA test case from this assistant turn">
                QA Case
              </button>
              <button type="button" className="msg-action-btn" onClick={handleCopy} title="Copy message">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
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
          {hasAttachments && <AttachmentBadges attachments={message.attachments!} />}
          {message.role === "user" && onInstruct && (
            <MessageActions copied={copied} onCopy={handleCopy} onInstruct={handleInstruct} onTask={handleTask} onExtract={handleExtract} />
          )}
        </>
      )}
    </div>
  );
}

function ChatToolBadge({ tc }: { tc: ToolCall }) {
  const isError = tc.error;
  const isPending = tc.result === undefined;
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
