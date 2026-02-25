import { useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { TooltipProvider } from "./components/ui";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useDebug } from "./hooks/useDebug";
import DebugPanel from "./components/DebugPanel";
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
import Media from "./pages/Media";
import QualityCenter from "./pages/QualityCenter";
import AgentSocial from "./pages/AgentSocial";
import CloudSync from "./pages/CloudSync";
import Bookmarks from "./pages/Bookmarks";
import Quotes from "./pages/Quotes";
import QuoteDetail from "./pages/QuoteDetail";
import AssistantChat from "./components/AssistantChat";
import JoiOrb from "./components/JoiOrb";

type ChatMode = "api" | "claude-code";

type ServiceHealth = Record<string, { status: "green" | "orange" | "red"; detail?: string }>;
type HealthResponse = {
  services?: ServiceHealth;
  uptime?: number;
  debug?: Record<string, unknown>;
};

function App() {
  const ws = useWebSocket();
  const [chatMode, setChatMode] = useState<ChatMode>("api");
  const { theme, toggle: toggleTheme } = useTheme();
  const debug = useDebug();
  const navigate = useNavigate();
  const [autodevState, setAutodevState] = useState<string>("waiting");
  const [health, setHealth] = useState<ServiceHealth>({});
  const [healthResponse, setHealthResponse] = useState<HealthResponse | null>(null);
  const [watchdogAutoRestart, setWatchdogAutoRestart] = useState(true);
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [healthCopied, setHealthCopied] = useState(false);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json() as HealthResponse;
      if (data.services) setHealth(data.services);
      setHealthResponse(data);
    } catch {
      // Keep last known health on fetch errors.
    }
  }, []);

  const restartService = async (service: string) => {
    setRestartingService(service);
    try {
      await fetch(`/api/services/${service}/restart`, { method: "POST" });
      // Refresh health after a brief delay
      setTimeout(() => {
        void refreshHealth();
        setRestartingService(null);
      }, 3000);
    } catch {
      setRestartingService(null);
    }
  };

  const copyHealthDebug = useCallback(async () => {
    if (!navigator?.clipboard) return;
    const payload = {
      capturedAt: new Date().toISOString(),
      ws: { status: ws.status },
      ui: {
        autodevState,
        watchdogAutoRestart,
        restartingService,
      },
      services: health,
      healthResponse,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setHealthCopied(true);
      setTimeout(() => setHealthCopied(false), 1600);
    } catch {
      setHealthCopied(false);
    }
  }, [autodevState, health, healthResponse, restartingService, watchdogAutoRestart, ws.status]);

  // Fetch health + autodev state on WS connect/reconnect
  useEffect(() => {
    if (ws.status !== "connected") return;
    void refreshHealth();
    fetch("/api/autodev/status")
      .then((r) => r.json())
      .then((data) => { if (data.state) setAutodevState(data.state); })
      .catch(() => {});
    fetch("/api/services/watchdog/mode")
      .then((r) => r.json())
      .then((data) => { if (typeof data.autoRestartEnabled === "boolean") setWatchdogAutoRestart(data.autoRestartEnabled); })
      .catch(() => {});
  }, [refreshHealth, ws.status]);

  // Refresh health every 30s
  useEffect(() => {
    const id = setInterval(() => {
      void refreshHealth();
    }, 30_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    return ws.on("autodev.status", (frame) => {
      const data = frame.data as { state: string; workerConnected?: boolean };
      if (data.state) setAutodevState(data.state);
      setHealth((prev) => ({
        ...prev,
        autodev: data.workerConnected !== false
          ? { status: "green", detail: data.state }
          : { status: "red", detail: "Worker disconnected" },
      }));
    });
  }, [ws]);

  return (
    <TooltipProvider>
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <JoiOrb
              className="sidebar-avatar"
              size={30}
              active={ws.status === "connected"}
              intensity={ws.status === "connected" ? 0.18 : 0.08}
              variant="transparent"
              rings={2}
              animated={false}
              ariaLabel="JOI"
            />
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
          <NavLink to="/quotes">
            Quotes
          </NavLink>
          <NavLink to="/agents">
            Agents
          </NavLink>
          <NavLink to="/agent-social">
            Agent Social
          </NavLink>
          <NavLink to="/knowledge">
            Knowledge
          </NavLink>
          <NavLink to="/media">
            Media
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
          <NavLink to="/quality">
            Quality
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
          <NavLink to="/bookmarks">
            Bookmarks
          </NavLink>
          <NavLink to="/cloud-sync">
            Cloud Sync
          </NavLink>
          <NavLink to="/integrations">
            Integrations
          </NavLink>
          <NavLink to="/settings">
            Settings
          </NavLink>
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
          onClick={() => {
            const next = !watchdogAutoRestart;
            setWatchdogAutoRestart(next);
            fetch("/api/services/watchdog/mode", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ autoRestartEnabled: next }),
            }).catch(() => setWatchdogAutoRestart(!next));
          }}
        >
          <div
            className="sidebar-toggle-track"
            style={{ background: watchdogAutoRestart ? "var(--accent)" : "var(--bg-tertiary)" }}
          >
            <div
              className="sidebar-toggle-thumb"
              style={{ left: watchdogAutoRestart ? 16 : 2 }}
            />
          </div>
          <span style={{ fontWeight: watchdogAutoRestart ? 600 : 400 }}>
            Watchdog
          </span>
        </div>
        <div className="sidebar-health">
          <div className="sidebar-health-header">
            <span className="sidebar-health-title">System Health</span>
            <button
              className={`sidebar-health-copy${healthCopied ? " copied" : ""}`}
              title="Copy full health debug snapshot"
              onClick={copyHealthDebug}
            >
              {healthCopied ? "copied" : "copy"}
            </button>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${ws.status === "connected" ? "green" : "red"}`} />
            <span>Gateway</span>
            <button
              className={`sidebar-health-restart ${restartingService === "gateway" ? "spinning" : ""}`}
              title="Restart Gateway (watchdog will auto-start)"
              onClick={() => restartService("gateway")}
            >↻</button>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.database?.status || "red"}`} />
            <span>Database</span>
            {health.database?.status !== "green" && health.database?.detail && (
              <span className="sidebar-health-detail" title={health.database.detail}>{health.database.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row sidebar-health-clickable" onClick={() => navigate("/autodev")}>
            <span className={`sidebar-health-dot ${health.autodev?.status || "red"}`} />
            <span>AutoDev</span>
            <span className="sidebar-health-detail" title={autodevState}>{autodevState}</span>
            <button
              className={`sidebar-health-restart ${restartingService === "autodev" ? "spinning" : ""}`}
              title="Restart AutoDev"
              onClick={(e) => { e.stopPropagation(); restartService("autodev"); }}
            >↻</button>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.livekit?.status || "red"}`} />
            <span>LiveKit</span>
            <button
              className={`sidebar-health-restart ${restartingService === "livekit" ? "spinning" : ""}`}
              title="Restart LiveKit"
              onClick={() => restartService("livekit")}
            >↻</button>
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.memory?.status || "orange"}`} />
            <span>Memory</span>
            {health.memory?.status !== "green" && health.memory?.detail && (
              <span className="sidebar-health-detail" title={health.memory.detail}>{health.memory.detail}</span>
            )}
          </div>
          <div className="sidebar-health-row">
            <span className={`sidebar-health-dot ${health.watchdog?.status || "red"}`} />
            <span>Watchdog</span>
            {health.watchdog?.detail && (
              <span className="sidebar-health-detail" title={health.watchdog.detail}>{health.watchdog.detail}</span>
            )}
            <button
              className={`sidebar-health-restart ${restartingService === "watchdog" ? "spinning" : ""}`}
              title="Restart Watchdog"
              onClick={() => restartService("watchdog")}
            >↻</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat ws={ws} chatMode={chatMode} />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agent-social" element={<AgentSocial />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/media" element={<Media />} />
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
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/cloud-sync" element={<CloudSync />} />
          <Route path="/integrations" element={<Channels ws={ws} />} />
          <Route path="/autodev" element={<AutoDev ws={ws} />} />
          <Route path="/quality" element={<QualityCenter ws={ws} />} />
          <Route path="/channels" element={<Navigate to="/integrations" replace />} />
        </Routes>
      </main>
      <AssistantChat ws={ws} chatMode={chatMode} />
      <DebugPanel />
    </div>
    </TooltipProvider>
  );
}

export default App;
