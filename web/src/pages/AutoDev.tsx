import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Badge, Button } from "../components/ui";
import type { useWebSocket } from "../hooks/useWebSocket";
import { splitExecutorLogs } from "../lib/autodevLogFormat";

interface SystemInfo {
  cwd: string;
  obsidianVault: string | null;
  devLogDir: string | null;
  devLogFile: string | null;
  memoryEnabled: boolean;
  startedAt: number;
  executorMode?: "auto" | "claude-code" | "gemini-cli" | "codex-cli";
  parallelExecution?: boolean;
  discussionMode?: boolean;
  discussionMaxTurns?: number;
  claudeModel?: string | null;
  codexModel?: string | null;
  geminiModel?: string | null;
}

interface AutoDevStatus {
  state: "waiting" | "picking" | "working" | "completing";
  paused?: boolean;
  workerConnected?: boolean;
  executorMode?: "auto" | "claude-code" | "gemini-cli" | "codex-cli";
  parallelExecution?: boolean;
  currentExecutor?: "claude-code" | "gemini-cli" | "codex-cli" | null;
  activeExecutors?: Array<"claude-code" | "gemini-cli" | "codex-cli">;
  executorStates?: Partial<Record<"claude-code" | "gemini-cli" | "codex-cli", "idle" | "running" | "success" | "error">>;
  currentAgentId?: string | null;
  currentSkill?: string | null;
  currentRouteReason?: string | null;
  projectUuid: string | null;
  projectTitle: string | null;
  currentTask: { uuid: string; title: string; notes?: string; checklist?: Array<{ title: string; completed: boolean }> } | null;
  completedCount: number;
  queue: Array<{ uuid: string; title: string }>;
  systemInfo?: SystemInfo;
}

interface ThingsTaskItem {
  uuid: string;
  title: string;
  list: string;
  notes: string | null;
  checklist: Array<{ title: string; completed: boolean }>;
  tags: string[];
  projectUuid: string | null;
  projectTitle: string | null;
  headingTitle: string | null;
}

type TaskDispatchLane = "codex" | "claude" | "gemini";

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

const TASK_DISPATCH_LANE_TO_HEADING: Record<TaskDispatchLane, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
};

const stateBadge: Record<string, { label: string; status: "muted" | "warning" | "accent" | "success" }> = {
  waiting: { label: "Waiting", status: "muted" },
  picking: { label: "Picking", status: "warning" },
  working: { label: "Working", status: "accent" },
  completing: { label: "Completing", status: "success" },
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function normalizeTextBlock(value: unknown): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value : String(value);
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatusPayload(value: unknown): AutoDevStatus {
  const base: AutoDevStatus = {
    state: "waiting",
    projectUuid: null,
    projectTitle: null,
    currentTask: null,
    completedCount: 0,
    queue: [],
  };

  const raw = asObject(value);
  if (!raw) return base;

  const rawTask = asObject(raw.currentTask);
  const rawChecklist = Array.isArray(rawTask?.checklist) ? rawTask.checklist : [];
  const checklist = rawChecklist
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: safeString(item.title),
      completed: item.completed === true,
    }))
    .filter((item) => item.title.length > 0);

  const currentTask = rawTask && typeof rawTask.uuid === "string" && typeof rawTask.title === "string"
    ? {
        uuid: rawTask.uuid,
        title: rawTask.title,
        notes: typeof rawTask.notes === "string" ? rawTask.notes : undefined,
        checklist,
      }
    : null;

  const queue = Array.isArray(raw.queue)
    ? raw.queue
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          uuid: safeString(item.uuid),
          title: safeString(item.title),
        }))
        .filter((item) => item.uuid.length > 0 && item.title.length > 0)
    : [];

  const state = (typeof raw.state === "string" && stateBadge[raw.state]) ? raw.state as AutoDevStatus["state"] : base.state;

  return {
    ...base,
    ...(raw as Partial<AutoDevStatus>),
    state,
    projectUuid: typeof raw.projectUuid === "string" || raw.projectUuid === null ? raw.projectUuid : null,
    projectTitle: typeof raw.projectTitle === "string" || raw.projectTitle === null ? raw.projectTitle : null,
    currentTask,
    completedCount: typeof raw.completedCount === "number" ? raw.completedCount : 0,
    queue,
  };
}

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
  const [taskDispatchLane, setTaskDispatchLane] = useState<TaskDispatchLane>("codex");
  const [selectedTaskUuid, setSelectedTaskUuid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyTaskDispatchUuid, setBusyTaskDispatchUuid] = useState<string | null>(null);
  const [busyShowTaskUuid, setBusyShowTaskUuid] = useState<string | null>(null);
  const [openThingsTasks, setOpenThingsTasks] = useState<ThingsTaskItem[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const claudeLogRef = useRef<HTMLPreElement>(null);
  const codexLogRef = useRef<HTMLPreElement>(null);
  const geminiLogRef = useRef<HTMLPreElement>(null);
  const [elapsed, setElapsed] = useState("");
  const splitLogs = useMemo(() => splitExecutorLogs(log), [log]);

  const refreshOpenLists = useCallback(async () => {
    const projectTitle = (status.projectTitle || "JOI").trim().toLowerCase();
    const tasksData = await fetch("/api/tasks").then((r) => r.json()).catch(() => null);

    const taskGroups = asObject(tasksData)?.tasks as Record<string, unknown> | undefined;
    const allTasks = taskGroups
      ? Object.values(taskGroups).flatMap((value) => (Array.isArray(value) ? value : []))
      : [];

    const normalizedTasks = allTasks
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => {
        const checklistRaw = Array.isArray(item.checklist) ? item.checklist : [];
        const checklist = checklistRaw
          .map((ci) => asObject(ci))
          .filter((ci): ci is Record<string, unknown> => Boolean(ci))
          .map((ci) => ({
            title: safeString(ci.title),
            completed: ci.completed === true,
          }))
          .filter((ci) => ci.title.length > 0);
        const tags = Array.isArray(item.tags)
          ? item.tags.map((tag) => safeString(tag)).filter((tag) => tag.length > 0)
          : [];
        return {
          uuid: safeString(item.uuid),
          title: safeString(item.title),
          list: safeString(item.list),
          notes: normalizeTextBlock(item.notes),
          checklist,
          tags,
          projectUuid: typeof item.projectUuid === "string" ? item.projectUuid : null,
          projectTitle: typeof item.projectTitle === "string" ? item.projectTitle : null,
          headingTitle: typeof item.headingTitle === "string" ? item.headingTitle : null,
        };
      })
      .filter((item) => item.uuid.length > 0 && item.title.length > 0);

    const projectTasks = normalizedTasks
      .filter((item) => (item.projectTitle || "").trim().toLowerCase() === projectTitle)
      .sort((a, b) => a.title.localeCompare(b.title));
    setOpenThingsTasks(projectTasks);
    setListsLoaded(true);
  }, [status.projectTitle]);

  useEffect(() => {
    if (!selectedTaskUuid) return;
    if (!openThingsTasks.some((task) => task.uuid === selectedTaskUuid)) {
      setSelectedTaskUuid(null);
    }
  }, [openThingsTasks, selectedTaskUuid]);

  // Fetch status + log on mount AND on WS reconnect (stale state recovery)
  useEffect(() => {
    if (ws.status !== "connected" && loaded) return;
    Promise.all([
      fetch("/api/autodev/status").then((r) => r.json()).catch(() => null),
      fetch("/api/autodev/log").then((r) => r.json()).catch(() => null),
    ]).then(([statusData, logData]) => {
      if (statusData) setStatus(normalizeStatusPayload(statusData));
      const logObj = asObject(logData);
      if (logObj && "log" in logObj) setLog(safeString(logObj.log));
      setLoaded(true);
    });
  }, [ws.status]);

  useEffect(() => {
    if (ws.status !== "connected" && listsLoaded) return;
    void refreshOpenLists();
  }, [ws.status, listsLoaded, refreshOpenLists]);

  useEffect(() => {
    if (ws.status !== "connected") return;
    const id = setInterval(() => { void refreshOpenLists(); }, 30_000);
    return () => clearInterval(id);
  }, [ws.status, refreshOpenLists]);

  // Subscribe to WS events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(ws.on("autodev.status", (frame) => {
      setStatus(normalizeStatusPayload(frame.data));
    }));

    unsubs.push(ws.on("autodev.log", (frame) => {
      const data = asObject(frame.data);
      const delta = safeString(data?.delta);
      const full = data?.full === true;
      if (full) setLog(delta);
      else if (delta) setLog((prev) => prev + delta);
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

  // Auto-scroll executor logs
  useEffect(() => {
    if (claudeLogRef.current) claudeLogRef.current.scrollTop = claudeLogRef.current.scrollHeight;
  }, [splitLogs.claude]);

  useEffect(() => {
    if (codexLogRef.current) codexLogRef.current.scrollTop = codexLogRef.current.scrollHeight;
  }, [splitLogs.codex]);

  useEffect(() => {
    if (geminiLogRef.current) geminiLogRef.current.scrollTop = geminiLogRef.current.scrollHeight;
  }, [splitLogs.gemini]);

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

  const selectedTask = useMemo(
    () => (selectedTaskUuid ? openThingsTasks.find((task) => task.uuid === selectedTaskUuid) || null : null),
    [openThingsTasks, selectedTaskUuid],
  );

  const parseApiError = useCallback(async (response: Response): Promise<string> => {
    try {
      const payload = await response.json();
      const raw = asObject(payload);
      const message = safeString(raw?.error || raw?.detail);
      if (message) return message;
    } catch {
      // fallback to status text below
    }
    return response.statusText || `HTTP ${response.status}`;
  }, []);

  const selectTask = useCallback((taskUuid: string) => {
    setSelectedTaskUuid(taskUuid);
    setFeedback(null);
  }, []);

  const openTaskInThings = useCallback(async (taskUuid: string) => {
    setBusyShowTaskUuid(taskUuid);
    setFeedback(null);
    try {
      const response = await fetch(`/api/tasks/${taskUuid}/show`, { method: "POST" });
      if (!response.ok) throw new Error(await parseApiError(response));
      setFeedback({ tone: "success", text: "Opened task in Things." });
    } catch (err) {
      setFeedback({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyShowTaskUuid(null);
    }
  }, [parseApiError]);

  const dispatchTaskToAutodev = useCallback(async (task: ThingsTaskItem) => {
    setBusyTaskDispatchUuid(task.uuid);
    setFeedback(null);
    try {
      const projectUuid = status.projectUuid || task.projectUuid;
      if (!projectUuid) throw new Error("AutoDev project UUID is missing. Open AutoDev status first.");

      const headingsResponse = await fetch(`/api/tasks/projects/${projectUuid}/headings`);
      if (!headingsResponse.ok) throw new Error(await parseApiError(headingsResponse));
      const headingsPayload = await headingsResponse.json();
      const headingsRaw = asObject(headingsPayload)?.headings;
      const headings = Array.isArray(headingsRaw)
        ? headingsRaw
            .map((item) => asObject(item))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              uuid: safeString(item.uuid),
              title: safeString(item.title),
            }))
            .filter((item) => item.uuid.length > 0 && item.title.length > 0)
        : [];

      const headingTitle = TASK_DISPATCH_LANE_TO_HEADING[taskDispatchLane];
      const heading = headings.find((item) => item.title.trim().toLowerCase() === headingTitle.toLowerCase());
      if (!heading) {
        throw new Error(`Missing "${headingTitle}" section in this project. Add it in Things and retry.`);
      }

      const updateResponse = await fetch(`/api/tasks/${task.uuid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          when: "today",
          headingId: heading.uuid,
          addTags: ["autodev", "autodev-dispatched"],
        }),
      });
      if (!updateResponse.ok) throw new Error(await parseApiError(updateResponse));

      await refreshOpenLists();
      setFeedback({
        tone: "success",
        text: status.paused
          ? `Task moved to ${headingTitle} and queued. AutoDev is paused, press Resume to run.`
          : `Task moved to ${headingTitle} and queued for AutoDev.`,
      });
    } catch (err) {
      setFeedback({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyTaskDispatchUuid(null);
    }
  }, [parseApiError, refreshOpenLists, status.paused, status.projectUuid, taskDispatchLane]);

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
  const executorStates = status.executorStates || {};
  const parallelExecution = status.parallelExecution ?? sysInfo?.parallelExecution ?? false;
  const isClaudeRunning = executorStates["claude-code"] === "running";
  const isCodexRunning = executorStates["codex-cli"] === "running";
  const isGeminiRunning = executorStates["gemini-cli"] === "running";

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
          <div className="autodev-log-split">
            <section
              className={`autodev-log-panel ${isClaudeRunning ? "is-active" : ""}`}
              aria-label="Claude output"
            >
              <div className="autodev-log-panel-header">
                <span>Claude</span>
                {isClaudeRunning ? <Badge status="accent">Live</Badge> : null}
              </div>
              <pre ref={claudeLogRef}>{splitLogs.claude || (!loaded ? "" : "No Claude output yet.")}</pre>
            </section>

            <section
              className={`autodev-log-panel ${isCodexRunning ? "is-active" : ""}`}
              aria-label="Codex output"
            >
              <div className="autodev-log-panel-header">
                <span>Codex</span>
                {isCodexRunning ? <Badge status="accent">Live</Badge> : null}
              </div>
              <pre ref={codexLogRef}>{splitLogs.codex || (!loaded ? "" : "No Codex output yet.")}</pre>
            </section>

            <section
              className={`autodev-log-panel ${isGeminiRunning ? "is-active" : ""}`}
              aria-label="Gemini output"
            >
              <div className="autodev-log-panel-header">
                <span>Gemini</span>
                {isGeminiRunning ? <Badge status="accent">Live</Badge> : null}
              </div>
              <pre ref={geminiLogRef}>{splitLogs.gemini || (!loaded ? "" : "No Gemini output yet.")}</pre>
            </section>
          </div>
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
              <span>Mode</span>
              <span>{status.executorMode || sysInfo?.executorMode || "auto"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Parallel</span>
              <span>{parallelExecution ? "on" : "off"}</span>
            </div>
            {typeof sysInfo?.discussionMode === "boolean" && (
              <div className="autodev-sidebar-stat-row">
                <span>Discussion</span>
                <span>{sysInfo.discussionMode ? `on (${sysInfo.discussionMaxTurns || 5})` : "off"}</span>
              </div>
            )}
            <div className="autodev-sidebar-stat-row">
              <span>Executor</span>
              <span>{status.currentExecutor || "n/a"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Claude</span>
              <span>{executorStates["claude-code"] || "idle"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Codex</span>
              <span>{executorStates["codex-cli"] || "idle"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Gemini</span>
              <span>{executorStates["gemini-cli"] || "idle"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Agent</span>
              <span>{status.currentAgentId || "n/a"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Skill</span>
              <span>{status.currentSkill || "n/a"}</span>
            </div>
            <div className="autodev-sidebar-stat-row">
              <span>Context</span>
              <span>last 5 tasks</span>
            </div>
            {status.currentRouteReason && (
              <div className="autodev-sidebar-route-reason">{status.currentRouteReason}</div>
            )}
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

          {/* Open Things tasks */}
          <div className="autodev-sidebar-card">
            <div className="autodev-sidebar-label">
              Open Things ({openThingsTasks.length})
            </div>
            {openThingsTasks.length === 0 ? (
              <div className="autodev-sidebar-empty">{listsLoaded ? "No open project tasks." : "Loading..."}</div>
            ) : (
              <>
                {openThingsTasks.slice(0, 12).map((t) => (
                  <button
                    key={t.uuid}
                    type="button"
                    className={`autodev-sidebar-list-item ${selectedTaskUuid === t.uuid ? "is-selected" : ""}`}
                    onClick={() => selectTask(t.uuid)}
                  >
                    <div>{t.title}</div>
                    <div className="autodev-sidebar-item-meta">
                      {t.headingTitle || "No section"} · {t.list || "anytime"}
                    </div>
                  </button>
                ))}
                {openThingsTasks.length > 12 && (
                  <div className="autodev-sidebar-empty">+{openThingsTasks.length - 12} more</div>
                )}
              </>
            )}
          </div>

          {/* Inspector */}
          <div className="autodev-sidebar-card">
            <div className="autodev-sidebar-label">Inspector</div>
            {!selectedTask && (
              <div className="autodev-sidebar-empty">
                Click an Open Things task to inspect details and dispatch it to AutoDev.
              </div>
            )}

            {selectedTask && (
              <div className="autodev-inspector-block">
                <div className="autodev-inspector-kind">Things Task</div>
                <div className="autodev-sidebar-task-title">{selectedTask.title}</div>
                <div className="autodev-sidebar-item-meta">
                  {selectedTask.headingTitle || "No section"} · {selectedTask.list || "anytime"}
                </div>
                {selectedTask.notes ? (
                  <pre className="autodev-inspector-pre">{selectedTask.notes.slice(0, 2600)}</pre>
                ) : (
                  <div className="autodev-sidebar-empty">No notes on this task.</div>
                )}
                {selectedTask.checklist.length > 0 && (
                  <div className="autodev-inspector-checklist">
                    {selectedTask.checklist.slice(0, 8).map((item, idx) => (
                      <div key={`${selectedTask.uuid}-${idx}`} className="autodev-inspector-check-item">
                        <span>{item.completed ? "x" : " "}</span>
                        <span>{item.title}</span>
                      </div>
                    ))}
                    {selectedTask.checklist.length > 8 && (
                      <div className="autodev-sidebar-empty">+{selectedTask.checklist.length - 8} more checklist items</div>
                    )}
                  </div>
                )}
                <div className="autodev-inspector-actions">
                  <Button
                    size="sm"
                    onClick={() => openTaskInThings(selectedTask.uuid)}
                    disabled={busyShowTaskUuid === selectedTask.uuid}
                  >
                    {busyShowTaskUuid === selectedTask.uuid ? "Opening..." : "Open in Things"}
                  </Button>
                  <select
                    className="autodev-inspector-select"
                    value={taskDispatchLane}
                    onChange={(event) => setTaskDispatchLane(event.target.value as TaskDispatchLane)}
                  >
                    <option value="codex">Codex lane</option>
                    <option value="claude">Claude lane</option>
                    <option value="gemini">Gemini lane</option>
                  </select>
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => dispatchTaskToAutodev(selectedTask)}
                    disabled={busyTaskDispatchUuid === selectedTask.uuid}
                  >
                    {busyTaskDispatchUuid === selectedTask.uuid ? "Sending..." : "Send to AutoDev"}
                  </Button>
                </div>
              </div>
            )}

            {feedback && (
              <div className={`autodev-sidebar-feedback ${feedback.tone === "error" ? "is-error" : "is-success"}`}>
                {feedback.text}
              </div>
            )}
          </div>

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
