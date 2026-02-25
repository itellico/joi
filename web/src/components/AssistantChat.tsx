import { useRef, useEffect, useState, useCallback } from "react";
import { useChat, type ChatMessage, type ToolCall } from "../hooks/useChat";
import type { ConnectionStatus, Frame } from "../hooks/useWebSocket";
import { useVoiceSession, type VoiceTranscript } from "../hooks/useVoiceSession";
import { getAgentMeta, formatAgentName } from "../lib/agentMeta";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import JoiOrb from "./JoiOrb";

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

const TOOL_FILLER_CACHE = new Map<string, string>();
const GENERIC_FILLERS = [
  "One moment, I am on it...",
  "Working on that now...",
  "Let me check that for you...",
  "I am pulling that up now...",
  "On it...",
];
const TOOL_FILLER_RULES: Array<{ pattern: RegExp; filler: string }> = [
  { pattern: /(calendar|event|schedule)/i, filler: "Checking your calendar now..." },
  { pattern: /(gmail|email|inbox|mail)/i, filler: "Checking your inbox now..." },
  { pattern: /(weather|forecast)/i, filler: "Checking the weather now..." },
  { pattern: /(memory|knowledge|search|lookup|find)/i, filler: "Looking that up now..." },
  { pattern: /(contact|person|people)/i, filler: "Looking up that contact now..." },
  { pattern: /(task|todo|things|okr)/i, filler: "Checking your task list now..." },
  { pattern: /(channel_send|whatsapp|telegram|imessage|sms|message)/i, filler: "Preparing that message now..." },
  { pattern: /(code|autodev|terminal|shell|command|git)/i, filler: "Running that task now..." },
];

function getToolAwareFiller(message: ChatMessage): string {
  const pendingTool = message.toolCalls?.find((tc) => tc.result === undefined && !tc.error);
  if (pendingTool?.name) {
    const key = pendingTool.name.toLowerCase();
    const cached = TOOL_FILLER_CACHE.get(key);
    if (cached) return cached;
    const rule = TOOL_FILLER_RULES.find((r) => r.pattern.test(key));
    const filler = rule?.filler ?? "Working on that now...";
    TOOL_FILLER_CACHE.set(key, filler);
    return filler;
  }
  return GENERIC_FILLERS[Math.abs(message.id.charCodeAt(0)) % GENERIC_FILLERS.length];
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

export default function AssistantChat({ ws, chatMode = "api" }: AssistantChatProps) {
  const { messages, isStreaming, conversationId, sendMessage, loadConversation, newConversation } = useChat({
    send: ws.send,
    on: ws.on,
  });
  const [mode, setMode] = useState<AssistantMode>("closed");
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const voiceSyncTimerRef = useRef<number | null>(null);

  const scheduleVoiceSync = useCallback((convId: string) => {
    if (voiceSyncTimerRef.current !== null) {
      window.clearTimeout(voiceSyncTimerRef.current);
    }
    // Try immediately for snappier bubble updates, then retry once after the backend persists.
    loadConversation(convId);
    voiceSyncTimerRef.current = window.setTimeout(() => {
      loadConversation(convId);
      voiceSyncTimerRef.current = null;
    }, 350);
  }, [loadConversation]);

  const handleFinalTranscript = useCallback(
    (_transcript: VoiceTranscript) => {
      if (!conversationId) return;
      scheduleVoiceSync(conversationId);
    },
    [conversationId, scheduleVoiceSync],
  );

  const handleVoiceConversationReady = useCallback((voiceConversationId: string) => {
    if (!voiceConversationId) return;
    if (voiceConversationId !== conversationId) {
      loadConversation(voiceConversationId);
    }
  }, [conversationId, loadConversation]);

  const voice = useVoiceSession({
    conversationId,
    agentId: "personal",
    onFinalTranscript: handleFinalTranscript,
    onConversationReady: handleVoiceConversationReady,
  });

  useEffect(() => {
    return () => {
      if (voiceSyncTimerRef.current !== null) {
        window.clearTimeout(voiceSyncTimerRef.current);
      }
    };
  }, []);

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

  // Auto-start voice globally (including closed bubble mode).
  // Skip auto-connect if LiveKit URL is not configured or server is unreachable.
  const [voiceAutoConnectAttempted, setVoiceAutoConnectAttempted] = useState(false);
  useEffect(() => {
    if (ws.status !== "connected") return;
    if (voice.state !== "idle") return;
    if (voice.error) return;
    if (voiceAutoConnectAttempted) return;
    setVoiceAutoConnectAttempted(true);
    void voice.connect();
  }, [ws.status, voice.state, voice.error, voice.connect, voiceAutoConnectAttempted]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep the latest live transcript in view while speaking.
  useEffect(() => {
    if (voice.interimTranscript?.text) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [voice.interimTranscript?.text]);

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
        ...(m.plannedSteps?.length ? { plannedSteps: m.plannedSteps } : {}),
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

  const handleVoiceMuteToggle = useCallback(() => {
    if (voice.state === "idle") {
      void voice.connect();
      return;
    }
    void voice.toggleMute();
  }, [voice.state, voice.connect, voice.toggleMute]);

  // ── Bubble ──
  if (mode === "closed") {
    const bubbleActive = voice.state !== "idle" && !voice.isMuted && !voice.error;
    const bubbleIntensity = Math.max(voice.audioLevel, voice.agentAudioLevel, bubbleActive ? 0.30 : 0.08);
    return (
      <button className="assistant-bubble" onClick={() => setMode("modal")} title="Chat with JOI">
        <JoiOrb
          size={32}
          active={bubbleActive}
          intensity={bubbleIntensity}
          variant={bubbleActive ? "firestorm" : "transparent"}
          rings={3}
          ariaLabel="JOI"
        />
      </button>
    );
  }

  const messagesArea = (
    <div className="assistant-messages">
      {messages.length === 0 && (
        <div className="assistant-welcome">
          <JoiOrb
            className="assistant-welcome-avatar"
            size={48}
            active={voice.state !== "idle" && !voice.isMuted}
            intensity={Math.max(voice.audioLevel, voice.agentAudioLevel, 0.10)}
            variant={(voice.state !== "idle" && !voice.error && !voice.isMuted) ? "firestorm" : "transparent"}
            rings={3}
            ariaLabel="JOI"
          />
          <p className="assistant-welcome-text">How can I help you?</p>
        </div>
      )}
      {messages.map((msg) => (
        <AssistantMessageBubble key={msg.id} message={msg} />
      ))}
      {voice.state !== "idle"
        && voice.interimTranscript?.speaker === "user"
        && voice.interimTranscript?.text?.trim() && (
        <LiveTranscriptBubble transcript={voice.interimTranscript} />
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  const voiceStatus = voice.state === "idle"
    ? "Voice off"
    : voice.error
      ? "Voice error"
      : voice.state === "connecting"
        ? "Connecting..."
        : voice.isMuted
          ? "Muted"
          : voice.activity === "agentSpeaking"
            ? "Speaking..."
            : voice.activity === "processing"
              ? "Thinking..."
              : voice.activity === "waitingForAgent"
                ? "Waiting..."
                : "Listening...";

  const voiceSubtitle = voice.state !== "idle"
    ? (voice.error ? "Voice error" : voiceStatus)
    : "Personal Assistant";

  const voiceOrbActive = voice.state !== "idle" && !voice.error && !voice.isMuted;
  const voiceOrbIntensity = (() => {
    const level = Math.max(voice.audioLevel, voice.agentAudioLevel);
    if (voice.state === "idle") return 0.10;
    switch (voice.activity) {
      case "agentSpeaking":
        return Math.max(level, 0.54);
      case "processing":
        return Math.max(level, 0.42);
      case "listening":
        return Math.max(level, 0.36);
      default:
        return Math.max(level, 0.30);
    }
  })();

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
            <JoiOrb
              className="assistant-header-avatar"
              size={24}
              active={voiceOrbActive}
              intensity={voiceOrbIntensity}
              variant={voiceOrbActive ? "firestorm" : "transparent"}
              rings={2}
              ariaLabel="JOI"
            />
            <div className="assistant-header-title-wrap">
              <span className="assistant-header-title">JOI</span>
              <span className={`assistant-header-subtitle${voice.state !== "idle" ? " assistant-header-subtitle--live" : ""}`}>
                {voiceSubtitle}
              </span>
            </div>
          </div>
          <div className="assistant-header-actions">
            {messages.length > 0 && (
              <button onClick={copyDebug} title="Copy debug JSON" className={`assistant-header-btn assistant-debug-btn${debugCopied ? " assistant-debug-btn--copied" : ""}`}>
                {debugCopied ? "ok" : "dbg"}
              </button>
            )}
            <button
              onClick={handleVoiceMuteToggle}
              title={voice.state === "idle" ? "Reconnect voice" : (voice.isMuted ? "Unmute mic + speaker" : "Mute mic + speaker")}
              className={`assistant-header-btn${voice.isMuted ? " assistant-header-btn--active" : ""}`}
              disabled={ws.status !== "connected" || voice.state === "connecting"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {voice.isMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </>
                )}
              </svg>
            </button>
            <button onClick={() => setMode("docked")} title="Dock to side" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button onClick={() => setMode("closed")} title="Close" className="assistant-header-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        {messagesArea}
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
            <JoiOrb
              className="assistant-docked-avatar"
              size={32}
              active={voiceOrbActive}
              intensity={voiceOrbIntensity}
              variant={voiceOrbActive ? "firestorm" : "transparent"}
              rings={2}
              ariaLabel="JOI"
            />
            <div>
              <span className="assistant-docked-name">JOI</span>
              <span className={`assistant-docked-subtitle${voice.state !== "idle" ? " assistant-docked-subtitle--live" : ""}`}>
                {voiceSubtitle}
              </span>
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
              onClick={handleVoiceMuteToggle}
              title={voice.state === "idle" ? "Reconnect voice" : (voice.isMuted ? "Unmute mic + speaker" : "Mute mic + speaker")}
              className={`assistant-header-btn${voice.isMuted ? " assistant-header-btn--active" : ""}`}
              disabled={ws.status !== "connected" || voice.state === "connecting"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {voice.isMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </>
                )}
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

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(iv);
  }, [startedAt]);

  return (
    <span className="assistant-elapsed-timer">
      {(elapsed / 1000).toFixed(1)}s
    </span>
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

  const filler = getToolAwareFiller(message);
  const hasTextContent = message.content.trim().length > 0;
  const hasToolCalls = Boolean(message.toolCalls?.length);
  const hasPlannedSteps = Boolean(message.plannedSteps?.length);
  const hasDelegations = Boolean(message.delegations?.length);
  const inlineToolBadges = hasToolCalls && !hasTextContent;
  const showAgentBadge = message.agentId && message.agentId !== "personal";

  return (
    <div className="assistant-msg assistant">
      <div className={`assistant-msg-avatar-row${inlineToolBadges ? " assistant-msg-avatar-row--inline-tools" : ""}`}>
        <JoiOrb
          className="assistant-msg-avatar"
          size={18}
          active={Boolean(message.isStreaming)}
          intensity={message.isStreaming ? 0.44 : 0.14}
          variant={message.isStreaming ? "firestorm" : "transparent"}
          rings={2}
          animated={Boolean(message.isStreaming)}
          ariaLabel="JOI"
        />
        {showAgentBadge && (
          <AgentBadge agentId={message.agentId!} agentName={message.agentName} />
        )}
        {message.isStreaming && message.streamStartedAt && (
          <ElapsedTimer startedAt={message.streamStartedAt} />
        )}
        {inlineToolBadges && (
          <div className="assistant-tools assistant-tools--inline">
            {message.toolCalls?.map((tc) => (
              <AssistantToolBadge key={tc.id} tc={tc} />
            ))}
          </div>
        )}
      </div>
      {hasTextContent && (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      )}
      {message.isStreaming && !message.content && (
        <div className="assistant-thinking">
          <span className="assistant-thinking-text">{filler}</span>
          <div className="assistant-typing">
            <span /><span /><span />
          </div>
        </div>
      )}
      {hasToolCalls && !inlineToolBadges && (
        <div className="assistant-tools">
          {message.toolCalls?.map((tc) => (
            <AssistantToolBadge key={tc.id} tc={tc} />
          ))}
        </div>
      )}
      {(hasToolCalls || hasPlannedSteps) && (
        <AssistantToolChecklist toolCalls={message.toolCalls || []} plannedSteps={message.plannedSteps} />
      )}
      {hasDelegations && (
        <DelegationAccordion delegations={message.delegations!} />
      )}
      {!message.isStreaming && (hasTextContent || hasToolCalls) && (
        <AssistantMsgMeta message={message} />
      )}
    </div>
  );
}

function LiveTranscriptBubble({ transcript }: { transcript: VoiceTranscript }) {
  return (
    <div className="assistant-msg user assistant-msg-live assistant-msg-live-user">
      {transcript.text}
    </div>
  );
}

function AssistantToolChecklist({ toolCalls, plannedSteps }: { toolCalls: ToolCall[]; plannedSteps?: string[] }) {
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
    <div className="assistant-tool-checklist">
      <div className="assistant-tool-checklist-title">{title}</div>
      <ul className="assistant-tool-checklist-list">
        {checklist.map((item) => {
          return (
            <li key={item.id} className={`assistant-tool-checklist-item ${item.status}`}>
              <span className={`assistant-tool-checklist-icon ${item.status}`} />
              <span className="assistant-tool-checklist-name">{item.name}</span>
              {item.durationMs != null && (
                <span className="assistant-tool-checklist-time">{formatDuration(item.durationMs)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AssistantMsgMeta({ message }: { message: ChatMessage }) {
  const parts: string[] = [];

  if (message.timings) {
    // Show timing breakdown — only phases >10ms to reduce noise
    const t = message.timings;
    const phases: string[] = [];
    if (t.setupMs > 10) phases.push(`setup ${formatDuration(t.setupMs)}`);
    if (t.memoryMs > 10) phases.push(`mem ${formatDuration(t.memoryMs)}`);
    if (t.promptMs > 10) phases.push(`prompt ${formatDuration(t.promptMs)}`);
    if (t.historyMs > 10) phases.push(`hist ${formatDuration(t.historyMs)}`);
    if (t.llmMs > 10) phases.push(`llm ${formatDuration(t.llmMs)}`);
    if (message.ttftMs) phases.push(`ttft ${formatDuration(message.ttftMs)}`);
    phases.push(`${formatDuration(t.totalMs)} total`);
    parts.push(phases.join(" · "));
  } else if (message.latencyMs) {
    // Fallback: show TTFT → total if both available, otherwise just total
    if (message.ttftMs) {
      parts.push(`${formatDuration(message.ttftMs)} ttft · ${formatDuration(message.latencyMs)} total`);
    } else {
      parts.push(formatDuration(message.latencyMs));
    }
  }
  if (message.toolCalls?.length) {
    const finishedToolTimes = message.toolCalls
      .map((tc) => tc.durationMs)
      .filter((ms): ms is number => typeof ms === "number");
    if (finishedToolTimes.length > 0) {
      const totalToolMs = finishedToolTimes.reduce((sum, ms) => sum + ms, 0);
      if (message.toolCalls.length === 1) {
        parts.push(`${formatToolName(message.toolCalls[0].name)} ${formatDuration(totalToolMs)}`);
      } else {
        parts.push(`tools ${formatDuration(totalToolMs)}`);
      }
    }
  }
  if (message.usage) {
    const total = message.usage.inputTokens + message.usage.outputTokens;
    parts.push(`${total.toLocaleString()} tok`);
    if (message.usage.voiceCache) {
      const hits = Number(message.usage.voiceCache.cacheHits || 0);
      const misses = Number(message.usage.voiceCache.cacheMisses || 0);
      const totalSegments = Number(message.usage.voiceCache.segments || (hits + misses));
      if (totalSegments > 0) {
        const rate = Math.round((hits / totalSegments) * 100);
        parts.push(`cache ${rate}% (${hits}/${totalSegments})`);
      }
    }
  }
  if (message.costUsd) {
    parts.push(message.costUsd >= 0.01
      ? `$${message.costUsd.toFixed(3)}`
      : `$${message.costUsd.toFixed(4)}`);
  }
  if (message.cacheStats && message.cacheStats.cacheHitPercent > 0) {
    parts.push(`cache ${message.cacheStats.cacheHitPercent}%`);
  }
  if (message.model) {
    // Show short model name
    const short = message.model.replace(/^(claude-|gpt-|llama-)/, "").replace(/-\d{8}$/, "");
    parts.push(short);
  }
  if (message.agentId && message.agentId !== "personal") {
    parts.push(`via ${message.agentName || formatAgentName(message.agentId)}`);
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
      className={`assistant-tool-badge${isError ? " error" : isPending ? "" : " done"}`}
      title={tc.name}
    >
      <span className="assistant-tool-name">{toolLabel}</span>
      {durationLabel && <span className="assistant-tool-duration">{durationLabel}</span>}
      {isPending && !isError && <span className="assistant-tool-spinner" />}
    </span>
  );
}

function AgentBadge({ agentId, agentName }: { agentId: string; agentName?: string }) {
  const meta = getAgentMeta(agentId);
  const displayName = agentName || formatAgentName(agentId);
  return (
    <span
      className="assistant-agent-badge"
      style={{ borderColor: meta.color, color: meta.color }}
      title={`Handled by ${displayName}`}
    >
      <span className="assistant-agent-badge-icon">{meta.icon}</span>
      <span className="assistant-agent-badge-name">{displayName}</span>
    </span>
  );
}

function DelegationAccordion({ delegations }: { delegations: Array<{ agentId: string; agentName?: string; task: string; durationMs?: number; status: "pending" | "success" | "error" }> }) {
  const [open, setOpen] = useState(false);
  if (delegations.length === 0) return null;

  const hasPending = delegations.some((d) => d.status === "pending");
  const allSuccess = !hasPending && delegations.every((d) => d.status === "success");
  const title = hasPending
    ? `${delegations.length} delegation${delegations.length > 1 ? "s" : ""} in progress...`
    : `${delegations.length} delegation${delegations.length > 1 ? "s" : ""} ${allSuccess ? "completed" : "finished"}`;

  return (
    <div className="assistant-delegation-accordion">
      <button
        className="assistant-delegation-toggle"
        onClick={() => setOpen(!open)}
      >
        <span className={`assistant-delegation-chevron${open ? " open" : ""}`} />
        <span className="assistant-delegation-title">{title}</span>
      </button>
      {open && (
        <ul className="assistant-delegation-list">
          {delegations.map((d, i) => {
            const meta = getAgentMeta(d.agentId);
            return (
              <li key={i} className={`assistant-delegation-item ${d.status}`}>
                <span className="assistant-delegation-agent" style={{ color: meta.color }}>
                  {meta.icon} {d.agentName || formatAgentName(d.agentId)}
                </span>
                <span className="assistant-delegation-task">{d.task}</span>
                {d.durationMs != null && (
                  <span className="assistant-delegation-duration">{formatDuration(d.durationMs)}</span>
                )}
                <span className={`assistant-delegation-status ${d.status}`}>
                  {d.status === "pending" ? "running..." : d.status === "success" ? "done" : "failed"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
