import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTerminal } from "../hooks/useTerminal";
import type { useWebSocket } from "../hooks/useWebSocket";
import { Badge, Button } from "../components/ui";

interface TerminalProps {
  ws: ReturnType<typeof useWebSocket>;
}

// Persist session ID across reconnects so we reattach instead of spawning new
let lastSessionId: string | null = null;

export default function Terminal({ ws }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const spawnSentRef = useRef(false);

  const pty = useTerminal({ send: ws.send, on: ws.on });

  // Track session ID for reattach
  useEffect(() => {
    if (pty.session) {
      lastSessionId = pty.session.sessionId;
    }
  }, [pty.session]);

  // Initialize xterm — runs once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
      lineHeight: 1.3,
      theme: {
        background: "#0f1117",
        foreground: "#e4e6eb",
        cursor: "#6366f1",
        cursorAccent: "#0f1117",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        black: "#1a1d27",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#6366f1",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e6eb",
        brightBlack: "#6b7280",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#818cf8",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#f9fafb",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    setIsReady(true);

    const observer = new ResizeObserver(() => {
      fit.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setIsReady(false);
    };
  }, []);

  // Wire PTY output → xterm (runs once when ready, uses stable refs)
  useEffect(() => {
    if (!isReady || !termRef.current) return;

    const term = termRef.current;

    pty.onData((data) => {
      term.write(data);
    });

    pty.onExit(() => {
      term.write("\r\n\x1b[90m[Session ended. Click 'New Session' to restart.]\x1b[0m\r\n");
    });
  }, [isReady, pty.onData, pty.onExit]);

  // Wire xterm keystrokes → PTY (stable because write uses ref internally)
  useEffect(() => {
    if (!isReady || !termRef.current) return;

    const term = termRef.current;
    const disposable = term.onData((data) => {
      pty.write(data);
    });

    return () => disposable.dispose();
  }, [isReady, pty.write]);

  // Send resize events to gateway
  useEffect(() => {
    if (!isReady || !termRef.current) return;

    const term = termRef.current;
    const disposable = term.onResize(({ cols, rows }) => {
      pty.resize(cols, rows);
    });

    return () => disposable.dispose();
  }, [isReady, pty.resize]);

  // Auto-spawn or reattach on connect — only once
  useEffect(() => {
    if (ws.status !== "connected" || !isReady || spawnSentRef.current) return;

    spawnSentRef.current = true;
    const cols = termRef.current?.cols || 120;
    const rows = termRef.current?.rows || 40;

    if (lastSessionId) {
      // Reattach to existing session (scrollback will be replayed)
      pty.spawn({ sessionId: lastSessionId, cols, rows });
    } else {
      pty.spawn({ cols, rows });
    }
  }, [ws.status, isReady, pty.spawn]);

  // Reset spawn guard on disconnect so we reattach when reconnected
  useEffect(() => {
    if (ws.status === "disconnected") {
      spawnSentRef.current = false;
    }
  }, [ws.status]);

  const handleNewSession = () => {
    pty.kill();
    lastSessionId = null;
    spawnSentRef.current = false;
    termRef.current?.clear();
    setTimeout(() => {
      const cols = termRef.current?.cols || 120;
      const rows = termRef.current?.rows || 40;
      pty.spawn({ cols, rows });
    }, 300);
  };

  return (
    <div className="terminal-page">
      <div className="terminal-header">
        <div className="terminal-title">
          <h2>Claude Code</h2>
          {pty.session && (
            <Badge status="success">Connected</Badge>
          )}
          {!pty.session && ws.status === "connected" && (
            <Badge status="warning">No session</Badge>
          )}
          {ws.status !== "connected" && (
            <Badge status="error">Disconnected</Badge>
          )}
        </div>
        <div className="terminal-actions">
          {pty.session && (
            <span className="terminal-session-id">
              {pty.session.sessionId.slice(0, 8)}
            </span>
          )}
          <Button size="sm" onClick={handleNewSession}>
            New Session
          </Button>
          {pty.session && (
            <Button size="sm" variant="danger" onClick={pty.kill}>
              Kill
            </Button>
          )}
        </div>
      </div>

      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
