import { useRef, useEffect, useState, useCallback } from "react";
import { useChat, type ChatMessage, type ToolCall } from "../hooks/useChat";
import type { ConnectionStatus, Frame } from "../hooks/useWebSocket";
import { useVoiceSession, type VoiceTranscript } from "../hooks/useVoiceSession";
import VoiceOverlay from "./VoiceOverlay";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AssistantMode = "closed" | "modal" | "docked";

interface Conversation {
  id: string;
  title: string;
  agent_id: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
  type?: string;
}

interface AssistantChatProps {
  ws: {
    status: ConnectionStatus;
    send: (type: string, data?: unknown, id?: string) => void;
    on: (type: string, handler: (frame: Frame) => void) => () => void;
  };
  chatMode?: "api" | "claude-code";
}

export default function AssistantChat({ ws, chatMode = "api" }: AssistantChatProps) {
  const { messages, isStreaming, conversationId, sendMessage, loadConversation, newConversation, addMessage } = useChat({
    send: ws.send,
    on: ws.on,
  });
  const [mode, setMode] = useState<AssistantMode>("closed");
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleFinalTranscript = useCallback(
    (transcript: VoiceTranscript) => {
      addMessage({
        id: crypto.randomUUID(),
        role: transcript.speaker === "user" ? "user" : "assistant",
        content: transcript.text,
        createdAt: new Date().toISOString(),
      });
    },
    [addMessage],
  );

  const voice = useVoiceSession({
    conversationId,
    agentId: "personal",
    onFinalTranscript: handleFinalTranscript,
  });

  const fetchConversations = useCallback(() => {
    fetch("/api/conversations?type=direct")
      .then((res) => res.json())
      .then((data) => {
        if (data.conversations) setConversations(data.conversations);
      })
      .catch(console.error);
  }, []);

  // Fetch conversations when history panel opens
  useEffect(() => {
    if (mode === "docked" && historyOpen) fetchConversations();
  }, [mode, historyOpen, fetchConversations]);

  // Refresh conversation list after a response completes
  useEffect(() => {
    if (!isStreaming && messages.length > 0 && mode === "docked" && historyOpen) {
      fetchConversations();
    }
  }, [isStreaming, messages.length, mode, historyOpen, fetchConversations]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim(), chatMode, "personal");
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (convId === conversationId) newConversation();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const copyDebug = useCallback(() => {
    const debug = {
      conversationId,
      chatMode,
      agent: "personal",
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        provider: m.provider,
        ...(m.toolModel ? { toolModel: m.toolModel, toolProvider: m.toolProvider } : {}),
        ...(m.toolCalls?.length ? {
          toolCalls: m.toolCalls.map((tc) => ({
            name: tc.name,
            input: tc.input,
            result: tc.result,
            error: tc.error,
            durationMs: tc.durationMs,
          })),
        } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.costUsd ? { costUsd: m.costUsd } : {}),
        ...(m.latencyMs ? { latencyMs: m.latencyMs } : {}),
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(debug, null, 2)).then(() => {
      setDebugCopied(true);
      setTimeout(() => setDebugCopied(false), 2000);
    });
  }, [conversationId, chatMode, messages]);

  // ── Bubble ──
  if (mode === "closed") {
    return (
      <button className="assistant-bubble" onClick={() => setMode("modal")} title="Chat with JOI">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  const messagesArea = (
    <div className="assistant-messages">
      {messages.length === 0 && (
        <div className="assistant-welcome">
          <img src="/joi-avatar.jpg" alt="JOI" className="assistant-welcome-avatar" />
          <p className="assistant-welcome-text">How can I help you?</p>
        </div>
      )}
      {messages.map((msg) => (
        <AssistantMessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );

  const micButton = (
    <button
      type="button"
      className={`assistant-voice-btn${voice.state === "connecting" ? " assistant-voice-btn--connecting" : ""}${voice.state === "connected" ? " assistant-voice-btn--active" : ""}`}
      onClick={() => voice.state === "idle" ? voice.connect() : voice.disconnect()}
      disabled={ws.status !== "connected"}
      title={voice.state === "idle" ? "Start voice" : "End voice"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );

  const voiceOverlay = voice.state !== "idle" ? (
    <VoiceOverlay
      state={voice.state}
      activity={voice.activity}
      isMuted={voice.isMuted}
      audioLevel={voice.audioLevel}
      agentAudioLevel={voice.agentAudioLevel}
      interimTranscript={voice.interimTranscript}
      error={voice.error}
      onToggleMute={voice.toggleMute}
      onEnd={voice.disconnect}
    />
  ) : null;

  const composeArea = (
    <form className="assistant-compose" onSubmit={handleSubmit}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message JOI..."
        disabled={ws.status !== "connected"}
        rows={1}
      />
      {micButton}
      <button type="submit" disabled={!input.trim() || isStreaming || ws.status !== "connected"}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );

  // ── Modal (floating overlay) ──
  if (mode === "modal") {
    return (
      <div className="assistant-modal">
        <div className="assistant-modal-header">
          <div className="assistant-header-left">
            <img src="/joi-avatar.jpg" alt="JOI" className="assistant-header-avatar" />
            <span className="assistant-header-title">JOI</span>
          </div>
          <div className="assistant-header-actions">
            {messages.length > 0 && (
              <button onClick={copyDebug} title="Copy debug JSON" className={`assistant-header-btn assistant-debug-btn${debugCopied ? " assistant-debug-btn--copied" : ""}`}>
                {debugCopied ? "ok" : "dbg"}
              </button>
            )}
            <button onClick={() => setMode("docked")} title="Dock to side" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button onClick={() => setMode("closed")} title="Close" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        {messagesArea}
        {voiceOverlay}
        {composeArea}
      </div>
    );
  }

  // ── Docked (layout flow, right panel) ──
  return (
    <div className="assistant-docked">
      <div className="assistant-docked-chat">
        <div className="assistant-docked-header">
          <div className="assistant-header-left">
            <img src="/joi-avatar.jpg" alt="JOI" className="assistant-docked-avatar" />
            <div>
              <span className="assistant-docked-name">JOI</span>
              <span className="assistant-docked-subtitle">Personal Assistant</span>
            </div>
          </div>
          <div className="assistant-header-actions">
            {messages.length > 0 && (
              <button onClick={copyDebug} title="Copy debug JSON" className={`assistant-header-btn assistant-debug-btn${debugCopied ? " assistant-debug-btn--copied" : ""}`}>
                {debugCopied ? "ok" : "dbg"}
              </button>
            )}
            <button
              onClick={() => { setHistoryOpen(!historyOpen); }}
              title={historyOpen ? "Hide history" : "Show history"}
              className={`assistant-header-btn${historyOpen ? " assistant-header-btn--active" : ""}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
            <button
              onClick={() => voice.state === "idle" ? voice.connect() : voice.disconnect()}
              title={voice.state === "idle" ? "Start voice" : "End voice"}
              className={`assistant-header-btn${voice.state === "connected" ? " assistant-header-btn--active" : ""}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <button onClick={() => newConversation()} title="New conversation" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button onClick={() => setMode("modal")} title="Undock to floating window" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button onClick={() => setMode("closed")} title="Close" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        {messagesArea}
        {voiceOverlay}
        {composeArea}
      </div>
      {historyOpen && (
        <div className="assistant-docked-history">
          <div className="assistant-docked-history-header">
            <span className="assistant-docked-history-title">History</span>
          </div>
          <div className="assistant-docked-history-list">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`assistant-docked-conv${conv.id === conversationId ? " active" : ""}`}
                onClick={() => loadConversation(conv.id)}
              >
                <div className="assistant-docked-conv-title">
                  {conv.title || "Untitled"}
                </div>
                <div className="assistant-docked-conv-meta">
                  <span>{conv.message_count} msgs</span>
                  <span>{formatTime(conv.updated_at)}</span>
                </div>
                <button
                  className="assistant-docked-conv-delete"
                  onClick={(e) => handleDelete(e, conv.id)}
                  title="Delete conversation"
                >
                  &times;
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <div className="assistant-docked-empty">No conversations yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantMessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="assistant-msg system">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="assistant-msg user">
        {message.content}
      </div>
    );
  }

  const fillerWords = ["Hmm, let me think...", "One moment...", "Let me see...", "Working on it...", "Thinking..."];
  const filler = fillerWords[Math.abs(message.id.charCodeAt(0)) % fillerWords.length];

  return (
    <div className="assistant-msg assistant">
      <div className="assistant-msg-avatar-row">
        <img src="/joi-avatar.jpg" alt="JOI" className="assistant-msg-avatar" />
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      {message.isStreaming && !message.content && (
        <div className="assistant-thinking">
          <span className="assistant-thinking-text">{filler}</span>
          <div className="assistant-typing">
            <span /><span /><span />
          </div>
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="assistant-tools">
          {message.toolCalls.map((tc) => (
            <AssistantToolBadge key={tc.id} tc={tc} />
          ))}
        </div>
      )}
      {!message.isStreaming && message.content && (
        <AssistantMsgMeta message={message} />
      )}
    </div>
  );
}

function AssistantMsgMeta({ message }: { message: ChatMessage }) {
  const parts: string[] = [];

  if (message.latencyMs) {
    parts.push(`${(message.latencyMs / 1000).toFixed(1)}s`);
  }
  if (message.usage) {
    const total = message.usage.inputTokens + message.usage.outputTokens;
    parts.push(`${total.toLocaleString()} tok`);
  }
  if (message.costUsd) {
    parts.push(message.costUsd >= 0.01
      ? `$${message.costUsd.toFixed(3)}`
      : `$${message.costUsd.toFixed(4)}`);
  }
  if (message.model) {
    // Show short model name
    const short = message.model.replace(/^(claude-|gpt-|llama-)/, "").replace(/-\d{8}$/, "");
    parts.push(short);
  }

  if (parts.length === 0) return null;

  return (
    <div className="assistant-msg-meta">
      {parts.join(" · ")}
    </div>
  );
}

function AssistantToolBadge({ tc }: { tc: ToolCall }) {
  const isPending = tc.result === undefined;
  const isError = tc.error;

  return (
    <span className={`assistant-tool-badge${isError ? " error" : isPending ? "" : " done"}`}>
      {tc.name}
      {isPending && !isError && <span className="assistant-tool-spinner" />}
    </span>
  );
}
