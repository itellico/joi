import { useCallback, useEffect, useRef, useState } from "react";
import type { Frame } from "./useWebSocket";

export interface PtySessionInfo {
  sessionId: string;
  cwd: string;
  createdAt: number;
}

interface UseTerminalOptions {
  send: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: Frame) => void) => () => void;
}

export function useTerminal({ send, on }: UseTerminalOptions) {
  const [session, setSession] = useState<PtySessionInfo | null>(null);
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const onDataRef = useRef<((data: string) => void) | null>(null);
  const onExitRef = useRef<(() => void) | null>(null);

  // Use refs for session ID so callbacks don't go stale
  const sessionIdRef = useRef<string | null>(null);
  const spawnedRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    sessionIdRef.current = session?.sessionId ?? null;
  }, [session]);

  // Listen for PTY frames — no dependency on session (use ref instead)
  useEffect(() => {
    const unsubs = [
      on("pty.output", (frame) => {
        const data = frame.data as { sessionId: string; data: string };
        // Only accept output for our current session
        if (!sessionIdRef.current || data.sessionId === sessionIdRef.current) {
          onDataRef.current?.(data.data);
        }
      }),

      on("pty.data", (frame) => {
        const data = frame.data as {
          sessionId?: string;
          cwd?: string;
          createdAt?: number;
          scrollback?: string;
          sessions?: PtySessionInfo[];
        };

        // Session spawn/reattach response
        if (data.sessionId && data.cwd) {
          sessionIdRef.current = data.sessionId;
          setSession({ sessionId: data.sessionId, cwd: data.cwd, createdAt: data.createdAt || Date.now() });
          // Replay scrollback for reattach
          if (data.scrollback) {
            onDataRef.current?.(data.scrollback);
          }
        }

        // Session list response
        if (data.sessions) {
          setSessions(data.sessions as PtySessionInfo[]);
        }
      }),

      on("pty.exit", (frame) => {
        const data = frame.data as { sessionId: string };
        if (data.sessionId === sessionIdRef.current) {
          spawnedRef.current = false;
          sessionIdRef.current = null;
          onExitRef.current?.();
          setSession(null);
        }
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [on]); // Only depends on `on` — session tracked via ref

  const spawn = useCallback((opts?: { sessionId?: string; cwd?: string; cols?: number; rows?: number }) => {
    if (spawnedRef.current && !opts?.sessionId) return; // prevent double-spawn
    spawnedRef.current = true;
    send("pty.spawn", opts || {});
  }, [send]);

  // Use ref-based write so xterm handler never goes stale
  const write = useCallback((data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    send("pty.input", { sessionId: sid, data });
  }, [send]);

  const resize = useCallback((cols: number, rows: number) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    send("pty.resize", { sessionId: sid, cols, rows });
  }, [send]);

  const kill = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    send("pty.kill", { sessionId: sid });
    spawnedRef.current = false;
    sessionIdRef.current = null;
    setSession(null);
  }, [send]);

  const listPtySessions = useCallback(() => {
    send("pty.list");
  }, [send]);

  // Set callback refs (avoids re-renders on xterm)
  const onData = useCallback((handler: (data: string) => void) => {
    onDataRef.current = handler;
  }, []);

  const onExit = useCallback((handler: () => void) => {
    onExitRef.current = handler;
  }, []);

  return {
    session,
    sessions,
    spawn,
    write,
    resize,
    kill,
    listPtySessions,
    onData,
    onExit,
  };
}
