import { useCallback, useEffect, useRef, useState } from "react";

export type Frame = {
  type: string;
  id?: string;
  data?: unknown;
  error?: string;
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type FrameHandler = (frame: Frame) => void;

export function useWebSocket(url?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<FrameHandler>>>(new Map());
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wsUrl = url || `ws://${window.location.hostname}:3100/ws`;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus("connected");
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as Frame;
        const handlers = handlersRef.current.get(frame.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(frame);
          }
        }
        // Also notify wildcard handlers
        const wildcardHandlers = handlersRef.current.get("*");
        if (wildcardHandlers) {
          for (const handler of wildcardHandlers) {
            handler(frame);
          }
        }
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      console.log("[WS] Disconnected, reconnecting in 3s...");
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
    };

    wsRef.current = ws;
  }, [wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((type: string, data?: unknown, id?: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn("[WS] Not connected, cannot send");
      return;
    }
    const frame: Frame = { type };
    if (data !== undefined) frame.data = data;
    if (id !== undefined) frame.id = id;
    wsRef.current.send(JSON.stringify(frame));
  }, []);

  const on = useCallback((type: string, handler: FrameHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  return { status, send, on };
}
