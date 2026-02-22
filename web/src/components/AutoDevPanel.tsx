import { useEffect, useState, useRef } from "react";

interface WsHandle {
  send: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: { type: string; id?: string; data?: unknown }) => void) => () => void;
  status: string;
}

interface AutoDevStatus {
  state: "waiting" | "picking" | "working" | "completing";
  paused?: boolean;
  workerConnected?: boolean;
  projectUuid: string | null;
  projectTitle: string | null;
  currentTask: { uuid: string; title: string } | null;
  completedCount: number;
  queue: Array<{ uuid: string; title: string }>;
}

interface Props {
  ws?: WsHandle;
}

const LS_KEY_OPEN = "autodev-open";

export default function AutoDevPanel({ ws }: Props) {
  const [open, setOpen] = useState(() => localStorage.getItem(LS_KEY_OPEN) === "true");
  const [status, setStatus] = useState<AutoDevStatus>({
    state: "waiting",
    projectUuid: null,
    projectTitle: null,
    currentTask: null,
    completedCount: 0,
    queue: [],
  });
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const [completions, setCompletions] = useState<Array<{ title: string; summary: string }>>([]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_OPEN, String(open));
  }, [open]);

  // Fetch initial status + log
  useEffect(() => {
    Promise.all([
      fetch("/api/autodev/status").then((r) => r.json()).catch(() => null),
      fetch("/api/autodev/log").then((r) => r.json()).catch(() => null),
    ]).then(([statusData, logData]) => {
      if (statusData) setStatus(statusData);
      if (logData?.log) setLog(logData.log);
    });
  }, []);

  // Subscribe to WS events
  useEffect(() => {
    if (!ws) return;
    const unsubs: Array<() => void> = [];

    unsubs.push(ws.on("autodev.status", (frame) => {
      setStatus(frame.data as AutoDevStatus);
    }));

    unsubs.push(ws.on("autodev.log", (frame) => {
      const data = frame.data as { delta: string; taskUuid?: string; full?: boolean };
      if (data.full) {
        setLog(data.delta);
      } else {
        setLog((prev) => prev + data.delta);
      }
    }));

    unsubs.push(ws.on("autodev.task_complete", (frame) => {
      const data = frame.data as { taskUuid: string; taskTitle: string; summary: string; completedCount: number };
      setCompletions((prev) => [...prev, { title: data.taskTitle, summary: data.summary }]);
    }));

    unsubs.push(ws.on("autodev.error", (frame) => {
      const data = frame.data as { error: string };
      setLog((prev) => prev + `\n[ERROR] ${data.error}\n`);
    }));

    return () => unsubs.forEach((u) => u());
  }, [ws]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const isPaused = status.paused === true;
  const isDisconnected = status.workerConnected === false;
  const isActive = !isPaused && !isDisconnected && status.state !== "waiting";

  const stateColors: Record<string, string> = {
    waiting: "var(--t3-text-faint)",
    picking: "var(--warning)",
    working: "var(--accent)",
    completing: "var(--success)",
  };

  return (
    <div className="autodev-panel">
      {/* Header */}
      <div className="autodev-header" onClick={() => setOpen(!open)}>
        <span className={`autodev-chevron${open ? "" : " collapsed"}`}>&#9662;</span>
        <svg className="autodev-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <span className="autodev-title">Auto Developer</span>
        {isActive && (
          <span className="autodev-running-badge">
            <span className="autodev-pulse-dot" />
            {status.state === "working" ? "Working" : status.state === "picking" ? "Picking" : "Completing"}
          </span>
        )}
      </div>

      {/* Collapsible body */}
      <div className={`autodev-body${open ? " open" : ""}`}>
        <div className="autodev-body-inner">
          {/* Status line */}
          <div className="autodev-status">
            <span className="autodev-dot" style={{ background: isPaused ? "var(--warning)" : isDisconnected ? "var(--t3-text-faint)" : stateColors[status.state] || stateColors.waiting }} />
            <span className="autodev-state">
              {isDisconnected && "Worker not connected"}
              {!isDisconnected && isPaused && "Paused"}
              {!isDisconnected && !isPaused && status.state === "waiting" && "Waiting for tasks"}
              {!isDisconnected && !isPaused && status.state === "picking" && "Picking next task..."}
              {!isDisconnected && !isPaused && status.state === "working" && status.currentTask && (
                <>Working on: <strong>{status.currentTask.title}</strong></>
              )}
              {!isDisconnected && !isPaused && status.state === "completing" && "Completing task..."}
            </span>
            {status.completedCount > 0 && (
              <span className="autodev-completed-count">{status.completedCount} done</span>
            )}
          </div>

          {/* Log output (last portion) */}
          {log && (
            <div className="autodev-log" ref={logRef}>
              {log.slice(-2000)}
            </div>
          )}

          {/* Completions */}
          {completions.length > 0 && (
            <div className="autodev-completions">
              {completions.slice(-5).map((c, i) => (
                <div key={i} className="autodev-completion">
                  <span className="autodev-completion-check">&#10003;</span>
                  <span className="autodev-completion-title">{c.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Queue preview */}
          {status.queue.length > 0 && (
            <div className="autodev-queue">
              <span className="autodev-queue-label">Queue ({status.queue.length})</span>
              {status.queue.slice(0, 5).map((t) => (
                <div key={t.uuid} className="autodev-queue-item">{t.title}</div>
              ))}
              {status.queue.length > 5 && (
                <div className="autodev-queue-more">+{status.queue.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
