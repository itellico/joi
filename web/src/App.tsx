import { useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { TooltipProvider } from "./components/ui";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useDebug } from "./hooks/useDebug";
import { useIntegrationWatchdog } from "./hooks/useIntegrationWatchdog";
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
import AgentSocial from "./pages/AgentSocial";
import CloudSync from "./pages/CloudSync";
import Bookmarks from "./pages/Bookmarks";
import Quotes from "./pages/Quotes";
import QuoteDetail from "./pages/QuoteDetail";
import Organizations from "./pages/Organizations";
import Humanizer from "./pages/Humanizer";
import AssistantChat from "./components/AssistantChat";
import JoiOrb from "./components/JoiOrb";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { SidebarSection } from "./components/layout/SidebarSection";
import { SidebarToggle } from "./components/layout/SidebarToggle";
import { SidebarHealthRow } from "./components/layout/SidebarHealthRow";

type ChatMode = "api" | "claude-code";

type HealthStatus = "green" | "orange" | "red";
type ServiceHealth = Record<string, { status: HealthStatus; detail?: string }>;
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

  useIntegrationWatchdog(ws);

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

  const serviceStatuses: HealthStatus[] = [
    ws.status === "connected" ? "green" : "red",
    health.database?.status || "red",
    health.autodev?.status || "red",
    health.livekit?.status || "red",
    health.memory?.status || "orange",
    health.watchdog?.status || "red",
  ];
  const healthyServices = serviceStatuses.filter((status) => status === "green").length;
  const overallHealth: HealthStatus = serviceStatuses.includes("red")
    ? "red"
    : serviceStatuses.includes("orange")
      ? "orange"
      : "green";

  return (
    <TooltipProvider>
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <JoiOrb
              className="sidebar-avatar"
              size={30}
              active
              intensity={ws.status === "connected" ? 0.3 : 0.16}
              variant="firestorm"
              rings={2}
              animated
              ariaLabel="JOI"
            />
            <div>
              <h1>JOI</h1>
              <p>Voice-First AI Assistant</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/chat">Chats</NavLink>

          <SidebarSection label="CRM">
            <NavLink to="/contacts">Contacts</NavLink>
            <NavLink to="/quotes">Quotes</NavLink>
            <NavLink to="/organizations">Organizations</NavLink>
          </SidebarSection>

          <SidebarSection label="AI">
            <NavLink to="/agents">Agents</NavLink>
            <NavLink to="/agent-social">Agent Social</NavLink>
            <NavLink to="/knowledge">Knowledge</NavLink>
            <NavLink to="/store">Store</NavLink>
          </SidebarSection>

          <SidebarSection label="Workspace">
            <NavLink to="/okrs">OKRs</NavLink>
            <NavLink to="/tasks">Tasks</NavLink>
            <NavLink to="/bookmarks">Bookmarks</NavLink>
            <NavLink to="/media">Media</NavLink>
            <NavLink to="/reports">Reports</NavLink>
          </SidebarSection>

          <SidebarSection label="DevOps" defaultOpen={false}>
            <NavLink to="/autodev">AutoDev</NavLink>
            <NavLink to="/cron">Cron</NavLink>
            <NavLink to="/reviews">Reviews</NavLink>
            <NavLink to="/terminal">Terminal</NavLink>
            <NavLink to="/logs">Logs</NavLink>
          </SidebarSection>

          <SidebarSection label="System" defaultOpen={false}>
            <NavLink to="/integrations">Integrations</NavLink>
            <NavLink to="/cloud-sync">Cloud Sync</NavLink>
            <NavLink to="/humanizer">Humanizer</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </SidebarSection>
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
      </aside>

      <div className="main-content">
        <details className="main-system-bar">
          <summary className="main-system-summary">
            <span className={`sidebar-health-dot ${overallHealth}`} />
            <span className="main-system-summary-title">System</span>
            <span className="main-system-summary-meta">{healthyServices}/{serviceStatuses.length} healthy</span>
            <span className="main-system-summary-chevron" aria-hidden="true" />
          </summary>
          <div className="main-system-panel">
            <div className="main-system-controls">
              <SidebarToggle
                label={`Mode: ${chatMode === "claude-code" ? "CLI" : "API"}`}
                active={chatMode === "claude-code"}
                onToggle={() => setChatMode(chatMode === "api" ? "claude-code" : "api")}
              />
              <SidebarToggle
                label="Debug"
                active={debug.enabled}
                onToggle={debug.toggle}
              />
              <SidebarToggle
                label="Watchdog"
                active={watchdogAutoRestart}
                onToggle={() => {
                  const next = !watchdogAutoRestart;
                  setWatchdogAutoRestart(next);
                  fetch("/api/services/watchdog/mode", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ autoRestartEnabled: next }),
                  }).catch(() => setWatchdogAutoRestart(!next));
                }}
              />
              <button
                type="button"
                className={`main-system-copy${healthCopied ? " copied" : ""}`}
                title="Copy full health debug snapshot"
                onClick={copyHealthDebug}
              >
                {healthCopied ? "copied" : "copy"}
              </button>
            </div>
            <div className="main-system-services">
              <SidebarHealthRow
                label="Gateway"
                status={ws.status === "connected" ? "green" : "red"}
                onRestart={() => restartService("gateway")}
                restarting={restartingService === "gateway"}
              />
              <SidebarHealthRow
                label="Database"
                status={health.database?.status || "red"}
                detail={health.database?.status !== "green" ? health.database?.detail : undefined}
              />
              <SidebarHealthRow
                label="AutoDev"
                status={health.autodev?.status || "red"}
                detail={autodevState}
                onRestart={() => restartService("autodev")}
                restarting={restartingService === "autodev"}
                onClick={() => navigate("/autodev")}
              />
              <SidebarHealthRow
                label="LiveKit"
                status={health.livekit?.status || "red"}
                onRestart={() => restartService("livekit")}
                restarting={restartingService === "livekit"}
              />
              <SidebarHealthRow
                label="Memory"
                status={health.memory?.status || "orange"}
                detail={health.memory?.status !== "green" ? health.memory?.detail : undefined}
              />
              <SidebarHealthRow
                label="Watchdog"
                status={health.watchdog?.status || "red"}
                detail={health.watchdog?.detail}
                onRestart={() => restartService("watchdog")}
                restarting={restartingService === "watchdog"}
              />
            </div>
          </div>
        </details>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat ws={ws} chatMode={chatMode} />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/organizations" element={<Organizations />} />
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
          <Route
            path="/reviews"
            element={(
              <RouteErrorBoundary title="Reviews">
                <Reviews ws={ws} />
              </RouteErrorBoundary>
            )}
          />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/cloud-sync" element={<CloudSync />} />
          <Route path="/humanizer" element={<Humanizer />} />
          <Route path="/integrations" element={<Channels ws={ws} />} />
          <Route
            path="/autodev"
            element={(
              <RouteErrorBoundary title="AutoDev">
                <AutoDev ws={ws} />
              </RouteErrorBoundary>
            )}
          />
          <Route path="/quality/*" element={<Navigate to="/autodev" replace />} />
          <Route path="/channels" element={<Navigate to="/integrations" replace />} />
        </Routes>
      </div>
      <RouteErrorBoundary title="Assistant Chat">
        <AssistantChat ws={ws} chatMode={chatMode} />
      </RouteErrorBoundary>
      <DebugPanel />
    </div>
    </TooltipProvider>
  );
}

export default App;
