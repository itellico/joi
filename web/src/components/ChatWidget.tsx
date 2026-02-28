import { useEffect, useRef, useState } from "react";
import { useChat, type ChatMessage } from "../hooks/useChat";
import type { Frame } from "../hooks/useWebSocket";
import { buildSimulationMetadata } from "../chat/simulation";
import { CHAT_SURFACE_PROFILES } from "../chat/surfaces";
import { createThingsTicketFromChat, parseTicketCommand } from "../chat/ticketCapture";

interface Task {
  uuid: string;
  title: string;
  notes: string | null;
  checklist: Array<{ uuid: string; title: string; completed: boolean; index: number }>;
}

interface ChatWidgetProps {
  ws: {
    send: (type: string, data?: unknown, id?: string) => void;
    on: (type: string, handler: (frame: Frame) => void) => () => void;
    status: string;
  };
  chatMode?: "api" | "claude-code"; // unused -- coder always uses claude-code
  task: Task;
  conversationId: string | null;
  onConversationCreated: () => void;
  onClose: () => void;
  mode: "panel" | "sheet";
  onModeChange: (mode: "panel" | "sheet") => void;
}

export default function ChatWidget({
  ws,
  task,
  conversationId: initialConversationId,
  onConversationCreated,
  onClose,
  mode,
  onModeChange,
}: ChatWidgetProps) {
  const surface = CHAT_SURFACE_PROFILES.task_widget;
  const selectedMode = surface.modeLock || "claude-code";
  const { messages, isStreaming, conversationId, sendMessage, loadConversation, newConversation } = useChat({
    send: ws.send,
    on: ws.on,
  });
  const [input, setInput] = useState("");
  const [ticketNote, setTicketNote] = useState("");
  const [initialized, setInitialized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConvIdRef = useRef<string | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Track when server assigns a conversationId and notify parent
  useEffect(() => {
    if (conversationId && conversationId !== prevConvIdRef.current) {
      prevConvIdRef.current = conversationId;
      onConversationCreated();
    }
  }, [conversationId, onConversationCreated]);

  // Initialize: load existing conversation or auto-send task context
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    if (initialConversationId) {
      loadConversation(initialConversationId);
    } else {
      // Build a prompt from task context
      newConversation();
      const parts = [`## Task: ${task.title}`];
      if (task.notes) parts.push(`\n### Notes\n${task.notes}`);
      if (task.checklist.length > 0) {
        parts.push("\n### Checklist");
        for (const ci of task.checklist) {
          parts.push(`- [${ci.completed ? "x" : " "}] ${ci.title}`);
        }
      }
      parts.push("\n---\nPlease work on this task. Start by analyzing what needs to be done, then implement it.");

      const prompt = parts.join("\n");
      // Small delay to let the hook mount
      // Task widget is mode/agent locked by surface profile.
      setTimeout(() => {
        sendMessage(prompt, selectedMode, surface.agentId, {
          ...(buildSimulationMetadata(selectedMode, surface.defaultExecutionMode, surface.defaultLatencyPreset) || {}),
          taskUuid: task.uuid,
          taskTitle: task.title,
        });
      }, 100);
    }
  }, [initialized, initialConversationId, task, loadConversation, newConversation, selectedMode, sendMessage, surface.agentId, surface.defaultExecutionMode, surface.defaultLatencyPreset]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const ticketCommand = parseTicketCommand(trimmed);
    if (ticketCommand) {
      void createThingsTicketFromChat({
        conversationId,
        messages,
        note: ticketCommand.note,
        kind: ticketCommand.kind,
        pendingUserMessage: trimmed,
        commandText: trimmed,
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
      return;
    }

    sendMessage(
      trimmed,
      selectedMode,
      surface.agentId,
      buildSimulationMetadata(selectedMode, surface.defaultExecutionMode, surface.defaultLatencyPreset),
    );
    setTicketNote("");
    setInput("");
  };

  return (
    <div className={`chat-widget chat-widget-${mode}`}>
      {/* Header */}
      <div className="chat-widget-header">
        <div className="chat-widget-header-left">
          <span className="chat-widget-title">{task.title}</span>
          <span className="chat-widget-badge">{surface.label}</span>
        </div>
        <div className="chat-widget-header-right">
          <button
            className="chat-widget-mode-btn"
            onClick={() => onModeChange(mode === "panel" ? "sheet" : "panel")}
            title={mode === "panel" ? "Expand" : "Collapse"}
          >
            {mode === "panel" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            )}
          </button>
          <button className="chat-widget-close-btn" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-widget-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose */}
      <div className="chat-widget-compose">
        <textarea
          className="chat-widget-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={isStreaming ? "JOI is routing voice + tools..." : "Send or dictate a message..."}
          disabled={isStreaming}
          rows={1}
        />
        <button className="chat-widget-send" onClick={handleSend} disabled={isStreaming || !input.trim()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      {ticketNote && <div className="chat-widget-ticket-note">{ticketNote}</div>}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`chat-widget-msg ${isUser ? "user" : isSystem ? "system" : "assistant"}`}>
      {message.content && (
        <div className="chat-widget-msg-text">{message.content}</div>
      )}
      {message.isStreaming && !message.content && (
        <div className="chat-widget-msg-text chat-widget-typing">Routing through sources...</div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="chat-widget-tools">
          {message.toolCalls.map((tc) => (
            <span key={tc.id} className={`chat-widget-tool${tc.result !== undefined ? " done" : ""}${tc.error ? " error" : ""}`}>
              {tc.name}
              {tc.result === undefined && !tc.error && <span className="chat-widget-tool-spinner" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
