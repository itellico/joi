import { useEffect, useState, useRef, useCallback } from "react";
import { Badge, Button } from "../components/ui";
import type { useWebSocket } from "../hooks/useWebSocket";

interface SystemInfo {
  cwd: string;
  obsidianVault: string | null;
  devLogDir: string | null;
  devLogFile: string | null;
  memoryEnabled: boolean;
  startedAt: number;
}

interface AutoDevStatus {
  state: "waiting" | "picking" | "working" | "completing";
  paused?: boolean;
  workerConnected?: boolean;
  projectUuid: string | null;
  projectTitle: string | null;
  currentTask: { uuid: string; title: string; notes?: string; checklist?: Array<{ title: string; completed: boolean }> } | null;
  completedCount: number;
  queue: Array<{ uuid: string; title: string }>;
  systemInfo?: SystemInfo;
}

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

const stateBadge: Record<string, { label: string; status: "muted" | "warning" | "accent" | "success" }> = {
  waiting: { label: "Waiting", status: "muted" },
  picking: { label: "Picking", status: "warning" },
  working: { label: "Working", status: "accent" },
  completing: { label: "Completing", status: "success" },
};

export default function AutoDev({ ws }: Props) {
  const [status, setStatus] = useState<AutoDevStatus>({
    state: "waiting",
    projectUuid: null,
    projectTitle: null,
    currentTask: null,
    completedCount: 0,
    queue: [],
  });
  const [log, setLog] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [completions, setCompletions] = useState<Array<{ title: string; summary: string; expanded?: boolean }>>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const [elapsed, setElapsed] = useState("");

  // Fetch status + log on mount AND on WS reconnect (stale state recovery)
  useEffect(() => {
    if (ws.status !== "connected" && loaded) return;
    Promise.all([
      fetch("/api/autodev/status").then((r) => r.json()).catch(() => null),
      fetch("/api/autodev/log").then((r) => r.json()).catch(() => null),
    ]).then(([statusData, logData]) => {
      if (statusData) setStatus(statusData);
      if (logData?.log !== undefined) setLog(logData.log);
      setLoaded(true);
    });
  }, [ws.status]);

  // Subscribe to WS events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(ws.on("autodev.status", (frame) => {
      setStatus(frame.data as AutoDevStatus);
    }));

    unsubs.push(ws.on("autodev.log", (frame) => {
      const data = frame.data as { delta: string; full?: boolean };
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

  // Elapsed timer (uptime since gateway start)
  useEffect(() => {
    const startedAt = status.systemInfo?.startedAt;
    if (!startedAt) return;
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      setElapsed(h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status.systemInfo?.startedAt]);

  const handlePause = useCallback(() => ws.send("autodev.pause"), [ws]);
  const handleResume = useCallback(() => ws.send("autodev.resume"), [ws]);
  const handleStopCurrent = useCallback(() => ws.send("autodev.stop-current"), [ws]);

  const toggleCompletion = (i: number) => {
    setCompletions((prev) => prev.map((c, idx) => idx === i ? { ...c, expanded: !c.expanded } : c));
  };

  const isPaused = status.paused === true;
  const isDisconnected = status.workerConnected === false;
  const badge = isPaused
    ? { label: "Paused", status: "warning" as const }
    : isDisconnected
      ? { label: "Disconnected", status: "muted" as const }
      : stateBadge[status.state] || stateBadge.waiting;
  const isWorking = status.state === "working";
  const checklist = status.currentTask?.checklist;
  const checklistDone = checklist?.filter((c) => c.completed).length ?? 0;
  const sysInfo = status.systemInfo;

  return (
    <div className="autodev-page">
      {/* Header */}
      <div className="autodev-page-header">
        <div className="autodev-page-title">
          <h2>Auto Developer</h2>
          <Badge status={badge.status}>{badge.label}</Badge>
          {elapsed && <span className="autodev-page-elapsed">{elapsed}</span>}
        </div>
        <div className="autodev-page-actions">
          {isWorking && (
            <Button size="sm" variant="danger" onClick={handleStopCurrent}>Skip Task</Button>
          )}
          <Button size="sm" variant={isPaused ? "ghost" : "danger"} onClick={isPaused ? handleResume : handlePause}>
            {isPaused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="autodev-page-body">
        {/* Left: Log viewer */}
        <div className="autodev-log-viewer">
          <pre ref={logRef}>
            {log || (!loaded ? "" : "Initializing...")}
          </pre>
        </div>

        {/* Right: Sidebar */}
        <div className="autodev-page-sidebar">
          {/* System Info */}
          <div className="autodev-sidebar-card autodev-sidebar-system">
            <div className="autodev-sidebar-label">System</div>
            <div className="autodev-sidebar-stat-row">
              <span>cwd</span>
              <span className="autodev-sidebar-mono">{sysInfo?.cwd || "~/dev_mm/joi"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>CLAUDE.md</span>
              <span className="autodev-sidebar-dot" data-ok="true" />
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Obsidian</span>
              <span className="autodev-sidebar-dot" data-ok={sysInfo?.obsidianVault ? "true" : "false"} />
            </div>
            {sysInfo?.devLogFile && (
              <div className="autodev-sidebar-stat-row">
                <span>Dev log</span>
                <span className="autodev-sidebar-mono">{sysInfo.devLogFile}</span>
              </div>
            )}
            {sysInfo?.devLogDir && !sysInfo.devLogFile && (
              <div className="autodev-sidebar-stat-row">
                <span>Log dir</span>
                <span className="autodev-sidebar-mono">{sysInfo.devLogDir}/</span>
              </div>
            )}
            <div className="autodev-sidebar-stat-row">
              <span>Memory</span>
              <span className="autodev-sidebar-dot" data-ok={sysInfo?.memoryEnabled ? "true" : "false"} />
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Context</span>
              <span>last 5 tasks</span>
            </div>
          </div>

          {/* Current task */}
          {status.currentTask && (
            <div className="autodev-sidebar-card">
              <div className="autodev-sidebar-label">Current Task</div>
              <div className="autodev-sidebar-task-title">{status.currentTask.title}</div>
              {status.currentTask.notes && (
                <div className="autodev-sidebar-notes">{status.currentTask.notes.slice(0, 200)}</div>
              )}
              {checklist && checklist.length > 0 && (
                <div className="autodev-sidebar-checklist">
                  <span className="autodev-sidebar-checklist-progress">{checklistDone}/{checklist.length}</span>
                  <div className="autodev-sidebar-checklist-bar">
                    <div style={{ width: `${(checklistDone / checklist.length) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Queue */}
          {status.queue.length > 0 && (
            <div className="autodev-sidebar-card">
              <div className="autodev-sidebar-label">Queue ({status.queue.length})</div>
              {status.queue.map((t) => (
                <div key={t.uuid} className="autodev-sidebar-queue-item">{t.title}</div>
              ))}
            </div>
          )}

          {/* Completed */}
          {completions.length > 0 && (
            <div className="autodev-sidebar-card">
              <div className="autodev-sidebar-label">Completed ({completions.length})</div>
              {completions.map((c, i) => (
                <div key={i} className="autodev-sidebar-completion" onClick={() => toggleCompletion(i)}>
                  <div className="autodev-sidebar-completion-row">
                    <span className="autodev-sidebar-completion-check">&#10003;</span>
                    <span className="autodev-sidebar-completion-title">{c.title}</span>
                    <span className="autodev-sidebar-completion-chevron">{c.expanded ? "\u25B4" : "\u25BE"}</span>
                  </div>
                  {c.expanded && c.summary && (
                    <div className="autodev-sidebar-completion-summary">{c.summary}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="autodev-sidebar-card autodev-sidebar-stats">
            <div className="autodev-sidebar-label">Stats</div>
            <div className="autodev-sidebar-stat-row">
              <span>Completed</span>
              <span>{status.completedCount}</span>
            </div>
            {elapsed && (
              <div className="autodev-sidebar-stat-row">
                <span>Uptime</span>
                <span>{elapsed}</span>
              </div>
            )}
            <div className="autodev-sidebar-stat-row">
              <span>State</span>
              <span>{isPaused ? "paused" : status.state}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Worker</span>
              <span className="autodev-sidebar-dot" data-ok={status.workerConnected ? "true" : "false"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
