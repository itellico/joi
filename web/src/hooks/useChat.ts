import { useCallback, useEffect, useRef, useState } from "react";
import type { Frame } from "./useWebSocket";

export interface ToolCall {
  name: string;
  input: unknown;
  id: string;
  result?: unknown;
  error?: boolean;
  startedAt?: number;
  durationMs?: number;
}

export interface Attachment {
  type: "photo" | "video" | "audio" | "document" | "sticker" | "voice" | "unknown";
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  provider?: string;
  toolModel?: string;
  toolProvider?: string;
  toolCalls?: ToolCall[];
  attachments?: Attachment[];
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  isStreaming?: boolean;
  createdAt?: string;
  costUsd?: number;
}

interface UseChatOptions {
  send: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: Frame) => void) => () => void;
}

/** Strip <think> blocks and [emotion] tags (LLM instructions, not user-facing) */
function stripInternalTags(text: string): string {
  // Strip complete <think>...</think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  // Strip unclosed <think> at the end (model still outputting thinking)
  cleaned = cleaned.replace(/<think>[\s\S]*$/, "");
  // Strip emotion tags like [happy], [thinking], [curious] etc.
  cleaned = cleaned.replace(/\[(happy|thinking|surprised|sad|excited|curious|amused|playful|warm|gentle|earnest|confident|thoughtful|serious|empathetic)\]\s*/gi, "");
  return cleaned;
}

export function useChat({ send, on }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const streamBufferRef = useRef("");
  const streamStartRef = useRef(0);
  const requestIdRef = useRef(0);

  // Listen for stream events
  useEffect(() => {
    const unsubs = [
      on("chat.stream", (frame) => {
        const data = frame.data as { delta: string; conversationId?: string };
        streamBufferRef.current += data.delta;

        // Track conversation ID from server
        if (data.conversationId && !conversationId) {
          setConversationId(data.conversationId as string);
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: stripInternalTags(streamBufferRef.current) },
            ];
          }
          return prev;
        });
      }),

      on("chat.done", (frame) => {
        const data = frame.data as {
          content: string;
          model: string;
          provider?: string;
          toolModel?: string;
          toolProvider?: string;
          messageId: string;
          conversationId?: string;
          usage?: { inputTokens: number; outputTokens: number };
          latencyMs?: number;
          costUsd?: number;
        };

        // Update conversation ID if server provided one
        if (data.conversationId) {
          setConversationId(data.conversationId);
        }

        const latencyMs = data.latencyMs || (Date.now() - streamStartRef.current);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                id: data.messageId || last.id,
                content: stripInternalTags(data.content || streamBufferRef.current),
                model: data.model,
                provider: data.provider,
                toolModel: data.toolModel,
                toolProvider: data.toolProvider,
                usage: data.usage,
                costUsd: data.costUsd,
                latencyMs,
                isStreaming: false,
              },
            ];
          }
          return prev;
        });

        setIsStreaming(false);
        streamBufferRef.current = "";
      }),

      on("chat.tool_use", (frame) => {
        const data = frame.data as {
          toolName: string;
          toolInput: unknown;
          toolUseId: string;
        };

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.isStreaming) {
            const toolCalls: ToolCall[] = [
              ...(last.toolCalls || []),
              { name: data.toolName, input: data.toolInput, id: data.toolUseId, startedAt: Date.now() },
            ];
            return [...prev.slice(0, -1), { ...last, toolCalls }];
          }
          return prev;
        });
      }),

      on("chat.tool_result", (frame) => {
        const data = frame.data as {
          toolUseId: string;
          result: unknown;
        };

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.toolCalls) {
            const toolCalls = last.toolCalls.map((tc) => {
              if (tc.id === data.toolUseId) {
                const now = Date.now();
                const isError = typeof data.result === "object" && data.result !== null && "error" in data.result;
                return {
                  ...tc,
                  result: data.result,
                  error: isError,
                  durationMs: tc.startedAt ? now - tc.startedAt : undefined,
                };
              }
              return tc;
            });
            return [...prev.slice(0, -1), { ...last, toolCalls }];
          }
          return prev;
        });
      }),

      on("chat.error", (frame) => {
        const data = frame.data as { error: string };
        setMessages((prev) => [
          ...prev.filter((m) => !m.isStreaming),
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Error: ${data.error}`,
          },
        ]);
        setIsStreaming(false);
        streamBufferRef.current = "";
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [on, conversationId]);

  const sendMessage = useCallback(
    (content: string, mode?: "api" | "claude-code", agentId?: string, metadata?: Record<string, unknown>) => {
      if (!content.trim() || isStreaming) return;

      const reqId = String(++requestIdRef.current);
      streamBufferRef.current = "";
      streamStartRef.current = Date.now();

      // Add user message
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };

      // Add placeholder for assistant response
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      send("chat.send", {
        conversationId,
        agentId: agentId || "personal",
        content,
        mode: mode || "api",
        ...(metadata ? { metadata } : {}),
      }, reqId);
    },
    [send, conversationId, isStreaming],
  );

  const loadConversation = useCallback(
    (id: string) => {
      setConversationId(id);
      fetch(`/api/conversations/${id}/messages`)
        .then((res) => res.json())
        .then((data) => {
          if (data.messages) {
            interface RawMsg {
              id: string;
              role: string;
              content: string;
              model?: string;
              tool_calls?: Array<{ id: string; name: string; input: unknown }>;
              tool_results?: Array<{ tool_use_id: string; content: string }>;
              token_usage?: { inputTokens: number; outputTokens: number };
              attachments?: Attachment[];
              created_at: string;
            }
            const raw: RawMsg[] = data.messages;

            // Build a map of tool results keyed by tool_use_id
            const toolResultMap = new Map<string, string>();
            for (const m of raw) {
              if (m.role === "tool" && m.tool_results) {
                for (const tr of m.tool_results) {
                  toolResultMap.set(tr.tool_use_id, tr.content);
                }
              }
            }

            setMessages(
              raw
                .filter((m) => m.role !== "tool")
                .map((m) => {
                  const msg: ChatMessage = {
                    id: m.id,
                    role: m.role as ChatMessage["role"],
                    content: m.content || "",
                    model: m.model,
                    usage: m.token_usage || undefined,
                    attachments: m.attachments || undefined,
                    createdAt: m.created_at,
                  };
                  // Attach tool calls with their results
                  if (m.tool_calls && m.tool_calls.length > 0) {
                    msg.toolCalls = m.tool_calls.map((tc) => {
                      const resultStr = toolResultMap.get(tc.id);
                      let result: unknown;
                      let isError = false;
                      if (resultStr !== undefined) {
                        try { result = JSON.parse(resultStr); } catch { result = resultStr; }
                        isError = typeof result === "object" && result !== null && "error" in result;
                      }
                      return {
                        name: tc.name,
                        input: tc.input,
                        id: tc.id,
                        result,
                        error: isError,
                      };
                    });
                  }
                  return msg;
                }),
            );
          }
        })
        .catch(console.error);
    },
    [],
  );

  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  return {
    messages,
    isStreaming,
    conversationId,
    sendMessage,
    loadConversation,
    newConversation,
    addMessage,
  };
}
