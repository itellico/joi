import { useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { TooltipProvider } from "./components/ui";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useDebug } from "./hooks/useDebug";
import { useDownloads } from "./hooks/useDownloads";
import DebugPanel from "./components/DebugPanel";
import DownloadPanel from "./components/DownloadPanel";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Agents from "./pages/Agents";
import Knowledge from "./pages/Knowledge";
import Cron from "./pages/Cron";
import Logs from "./pages/Logs";
import Terminal from "./pages/Terminal";
import Settings from "./pages/Settings";
import Tasks from "./pages/Tasks";
import Reviews from "./pages/Reviews";
import Channels from "./pages/Channels";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import Store from "./pages/Store";
import OKRs from "./pages/OKRs";
import Reports from "./pages/Reports";
import AutoDev from "./pages/AutoDev";
import AssistantChat from "./components/AssistantChat";

type ChatMode = "api" | "claude-code";

type ServiceHealth = Record<string, { status: "green" | "orange" | "red"; detail?: string }>;

function App() {
  const ws = useWebSocket();
  const [chatMode, setChatMode] = useState<ChatMode>("api");
  const { theme, toggle: toggleTheme } = useTheme();
  const debug = useDebug();
  const navigate = useNavigate();
  const [autodevState, setAutodevState] = useState<string>("waiting");
  const [health, setHealth] = useState<ServiceHealth>({});
  const [watchdogAutoRestartEnabled, setWatchdogAutoRestartEnabled] = useState(true);
  const [watchdogModePending, setWatchdogModePending] = useState(false);
  const downloads = useDownloads(ws);
  const [dlPanelOpen, setDlPanelOpen] = useState(false);
  const dlPanelManualClose = useRef(false);

  const refreshWatchdogMode = async () => {
    try {
      const res = await fetch("/api/services/watchdog/mode");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.autoRestartEnabled === "boolean") {
        setWatchdogAutoRestartEnabled(data.autoRestartEnabled);
      }
    } catch (err) {
      console.error("Failed to fetch watchdog mode:", err);
    }
  };

  const toggleWatchdogMode = async () => {
    if (watchdogModePending) return;
    setWatchdogModePending(true);
    try {
      const next = !watchdogAutoRestartEnabled;
      const res = await fetch("/api/services/watchdog/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRestartEnabled: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.autoRestartEnabled === "boolean") {
        setWatchdogAutoRestartEnabled(data.autoRestartEnabled);
      } else {
        setWatchdogAutoRestartEnabled(next);
      }
      const healthRes = await fetch("/api/health");
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        if (healthData.services) setHealth(healthData.services as ServiceHealth);
      }
    } catch (err) {
      console.error("Failed to toggle watchdog mode:", err);
    } finally {
      setWatchdogModePending(false);
    }
  };

  // Fetch health + autodev state on WS connect/reconnect
  useEffect(() => {
    if (ws.status !== "connected") return;
    void refreshWatchdogMode();
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => { if (data.services) setHealth(data.services); })
      .catch(() => {});
    fetch("/api/autodev/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.workerConnected === false) {
          setAutodevState("disconnected");
        } else if (data.state) {
          setAutodevState(data.state);
        }
      })
      .catch(() => {});
  }, [ws.status]);

  // Refresh health every 30s
  useEffect(() => {
    void refreshWatchdogMode();
    const id = setInterval(() => {
      fetch("/api/health")
        .then((r) => r.json())
        .then((data) => { if (data.services) setHealth(data.services); })
        .catch(() => {});
      fetch("/api/autodev/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.workerConnected === false) {
            setAutodevState("disconnected");
          } else if (data.state) {
            setAutodevState(data.state);
          }
        })
        .catch(() => {});
      void refreshWatchdogMode();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return ws.on("autodev.status", (frame) => {
      const data = frame.data as { state: string; workerConnected?: boolean };
      if (data.workerConnected === false) {
        setAutodevState("disconnected");
      } else if (data.state) {
        setAutodevState(data.state);
      }
      setHealth((prev) => ({
        ...prev,
        autodev: data.workerConnected !== false
          ? { status: "green", detail: data.state }
          : { status: "red", detail: "Worker disconnected" },
      }));
    });
  }, [ws]);

  // Auto-open panel when downloads start; respect manual close
  useEffect(() => {
    if (downloads.activeCount > 0 && !dlPanelOpen && !dlPanelManualClose.current) {
      setDlPanelOpen(true);
    }
    // Reset manual close flag when all downloads finish
    if (downloads.activeCount === 0) {
      dlPanelManualClose.current = false;
    }
  }, [downloads.activeCount]);

  const closeDlPanel = () => {
    setDlPanelOpen(false);
    dlPanelManualClose.current = true;
  };

  return (
    <TooltipProvider>
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <img src="/joi-avatar.jpg" alt="JOI" className="sidebar-avatar" />
            <div>
              <h1>JOI</h1>
              <p>Personal AI Assistant</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/chat">
            Chats
          </NavLink>
          <NavLink to="/contacts">
            Contacts
          </NavLink>
          <NavLink to="/agents">
            Agents
          </NavLink>
          <NavLink to="/knowledge">
            Knowledge
          </NavLink>
          <NavLink to="/store">
            Store
          </NavLink>
          <NavLink to="/okrs">
            OKRs
          </NavLink>
          <NavLink to="/cron">
            Cron
          </NavLink>
          <NavLink to="/tasks">
            Tasks
          </NavLink>
          <NavLink to="/reviews">
            Reviews
          </NavLink>
          <NavLink to="/autodev">
            AutoDev
          </NavLink>
          <NavLink to="/terminal">
            Terminal
          </NavLink>
          <NavLink to="/logs">
            Logs
          </NavLink>
          <NavLink to="/reports">
            Reports
          </NavLink>
          <NavLink to="/integrations">
            Integrations
          </NavLink>
          <NavLink to="/settings">
            Settings
          </NavLink>
          <button
            className={`sidebar-dl-btn ${dlPanelOpen ? "sidebar-dl-btn--active" : ""}`}
            onClick={() => dlPanelOpen ? closeDlPanel() : setDlPanelOpen(true)}
          >
            Downloads
            {downloads.activeCount > 0 && (
              <span className="sidebar-dl-badge">{downloads.activeCount}</span>
            )}
          </button>
        </nav>

        <button
          onClick={toggleTheme}
          className="sidebar-theme-toggle"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="sidebar-theme-icon">
            {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
          </span>
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>

        <div
          className="sidebar-mode-toggle"
          onClick={() => setChatMode(chatMode === "api" ? "claude-code" : "api")}
        >
          <div
            className="sidebar-toggle-track"
            style={{ background: chatMode === "claude-code" ? "var(--accent)" : "var(--bg-tertiary)" }}
          >
            <div
              className="sidebar-toggle-thumb"
              style={{ left: chatMode === "claude-code" ? 16 : 2 }}
            />
          </div>
          <span style={{ fontWeight: chatMode === "claude-code" ? 600 : 400 }}>
            {chatMode === "claude-code" ? "Claude Code CLI" : "API Mode"}
          </span>
        </div>
        <div
          className="sidebar-mode-toggle"
          onClick={debug.toggle}
        >
          <div
            className="sidebar-toggle-track"
            style={{ background: debug.enabled ? "var(--accent)" : "var(--bg-tertiary)" }}
          >
            <div
              className="sidebar-toggle-thumb"
              style={{ left: debug.enabled ? 16 : 2 }}
            />
          </div>
          <span style={{ fontWeight: debug.enabled ? 600 : 400 }}>
            Debug
          </span>
        </div>
        <div
          className="sidebar-mode-toggle"
          onClick={() => { void toggleWatchdogMode(); }}
          style={{ opacity: watchdogModePending ? 0.65 : 1, cursor: watchdogModePending ? "wait" : "pointer" }}
        >
          <div
            className="sidebar-toggle-track"
            style={{ background: watchdogAutoRestartEnabled ? "var(--accent)" : "var(--bg-tertiary)" }}
          >
            <div
              className="sidebar-toggle-thumb"
              style={{ left: watchdogAutoRestartEnabled ? 16 : 2 }}
            />
          </div>
          <span style={{ fontWeight: watchdogAutoRestartEnabled ? 600 : 400 }}>
            {watchdogAutoRestartEnabled ? "Watchdog Auto-Restart" : "Watchdog Paused"}
          </span>
        </div>
        <div className="sidebar-health">
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${ws.status === "connected" ? "green" : "red"}`} />
            <span>Gateway</span>
            <span className="sidebar-health-detail">
              {ws.status === "connected" ? (health.gateway?.detail || "connected") : "ws disconnected"}
            </span>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.database?.status || "red"}`} />
            <span>Database</span>
            {health.database?.detail && (
              <span className="sidebar-health-detail">{health.database.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row sidebar-health-clickable" onClick={() => navigate("/autodev")}>
            <span className={`sidebar-health-dot ${health.autodev?.status || "red"}`} />
            <span>AutoDev</span>
            <span className="sidebar-health-detail">{health.autodev?.detail || autodevState}</span>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.livekit?.status || "red"}`} />
            <span>LiveKit</span>
            {health.livekit?.detail && (
              <span className="sidebar-health-detail">{health.livekit.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.web?.status || "orange"}`} />
            <span>Web</span>
            {health.web?.detail && (
              <span className="sidebar-health-detail">{health.web.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.memory?.status || "orange"}`} />
            <span>Memory</span>
            {health.memory?.detail && (
              <span className="sidebar-health-detail">{health.memory.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.watchdog?.status || "red"}`} />
            <span>Watchdog</span>
            {health.watchdog?.detail && (
              <span className="sidebar-health-detail">{health.watchdog.detail}</span>
            )}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat ws={ws} chatMode={chatMode} />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/store" element={<Store />} />
          <Route path="/okrs" element={<OKRs />} />
          <Route path="/cron" element={<Cron />} />
          <Route path="/skills" element={<Navigate to="/agents" replace />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/terminal" element={<Terminal ws={ws} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tasks" element={<Tasks ws={ws} chatMode={chatMode} />} />
          <Route path="/reviews" element={<Reviews ws={ws} />} />
          <Route path="/integrations" element={<Channels ws={ws} />} />
          <Route path="/autodev" element={<AutoDev ws={ws} />} />
          <Route path="/channels" element={<Navigate to="/integrations" replace />} />
        </Routes>
      </main>
      <AssistantChat ws={ws} chatMode={chatMode} />
      <DebugPanel />
      <DownloadPanel
        open={dlPanelOpen}
        onClose={closeDlPanel}
        active={downloads.active}
        recentlyCompleted={downloads.recentlyCompleted}
        stats={downloads.stats}
        paused={downloads.paused}
        onPauseAll={downloads.pauseAll}
        onResumeAll={downloads.resumeAll}
        onCancel={downloads.cancel}
      />
    </div>
    </TooltipProvider>
  );
}

export default App;
