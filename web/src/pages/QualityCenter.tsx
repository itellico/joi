import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterGroup,
  FormField,
  FormGrid,
  MetaText,
  Modal,
  PageBody,
  PageHeader,
  Row,
  SearchInput,
  Stack,
  Tabs,
  UnifiedList,
  type UnifiedListColumn,
} from "../components/ui";
import { useChat, type ChatMessage } from "../hooks/useChat";

// ─── Types ───

interface Suite {
  id: string;
  name: string;
  description: string | null;
  agent_id: string;
  tags: string[];
  enabled: boolean;
  case_count: number;
  last_run_status: string | null;
  last_run_at: string | null;
  cases?: TestCase[];
}

interface TurnDefinition {
  role: string;
  message: string;
  expected_tools?: string[];
  unexpected_tools?: string[];
  expected_content_patterns?: string[];
  description?: string;
}

interface TurnResult {
  turn_index: number;
  actual_content: string;
  actual_tools: Array<{ name: string; input: unknown }>;
  judge_scores: { correctness: number; tool_accuracy: number; response_quality: number; reasoning: string } | null;
  rule_checks: { tools_ok: boolean; patterns_ok: boolean; latency_ok: boolean; details: string[] } | null;
  latency_ms: number;
  model: string | null;
}

interface TestCase {
  id: string;
  suite_id: string;
  name: string;
  description: string | null;
  input_message: string;
  expected_tools: string[];
  unexpected_tools: string[];
  expected_content_patterns: string[];
  max_latency_ms: number | null;
  min_quality_score: number;
  enabled: boolean;
  turns: TurnDefinition[] | null;
  turn_count: number;
  category: string;
}

interface FlatCase extends TestCase {
  suite_name: string;
}

interface TestRun {
  id: string;
  suite_id: string;
  suite_name: string;
  status: string;
  triggered_by: string;
  model_config: Record<string, unknown> | null;
  total_cases: number;
  passed: number;
  failed: number;
  errored: number;
  avg_correctness: number | null;
  avg_tool_accuracy: number | null;
  avg_response_quality: number | null;
  total_latency_ms: number | null;
  total_cost_usd: number;
  started_at: string;
  completed_at: string | null;
}

interface TestResult {
  id: string;
  case_name: string;
  input_message: string;
  status: string;
  actual_content: string | null;
  actual_tools: Array<{ name: string; input: unknown }>;
  judge_scores: { correctness: number; tool_accuracy: number; response_quality: number; reasoning: string } | null;
  rule_checks: { tools_ok: boolean; patterns_ok: boolean; latency_ok: boolean; details: string[] } | null;
  failure_reasons: string[];
  latency_ms: number | null;
  cost_usd: number;
  model: string | null;
  turn_results: TurnResult[] | null;
  flow_coherence_score: number | null;
  flow_reasoning: string | null;
}

interface Issue {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  category: string;
  status: string;
  autodev_task_id: string | null;
  created_at: string;
  updated_at: string;
  evidence?: unknown;
  tags?: string[];
}

interface Stats {
  total_suites: number;
  total_cases: number;
  total_runs: number;
  pass_rate: number | null;
  open_issues: number;
  critical_issues: number;
  last_run: TestRun | null;
}

interface SoulRollout {
  id: string;
  agent_id: string;
  status: "canary_active" | "promoted" | "rolled_back" | "cancelled";
  traffic_percent: number;
  minimum_sample_size: number;
  metrics: Record<string, unknown>;
  decision_reason: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

interface SoulGovernanceSummary {
  generatedAt: string;
  policyVersion: string;
  active: number;
  overdueActive: number;
  openSoulIssues: number;
  statusCounts: Record<string, number>;
  coverage: {
    totalAgents: number;
    soulCoverage: number;
    qaCoverage: number;
    soulCoverageRate: number;
    qaCoverageRate: number;
  };
  recentRollouts: SoulRollout[];
}

interface WsHandle {
  status: string;
  send?: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: { type: string; id?: string; data?: unknown; error?: string }) => void) => () => void;
}

// ─── Form state ───

const emptySuiteForm = { name: "", description: "", agent_id: "personal", tags: "" };
const emptyCaseForm = { name: "", input_message: "", expected_tools: "", unexpected_tools: "", expected_content_patterns: "", max_latency_ms: "", min_quality_score: "0.5" };
const SOUL_REVIEW_DELTA_WARN = 0.05;
const SOUL_QA_DELTA_WARN = 0.03;

// ─── Helpers ───

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scoreColor(score: number | null): "success" | "warning" | "error" | "muted" {
  if (score === null) return "muted";
  if (score >= 0.7) return "success";
  if (score >= 0.4) return "warning";
  return "error";
}

function statusBadge(status: string) {
  const map: Record<string, "success" | "warning" | "error" | "muted" | "info" | "accent"> = {
    passed: "success", completed: "success", fixed: "success", verified: "success", closed: "muted",
    failed: "error", critical: "error", errored: "error",
    running: "accent", investigating: "accent", autodev_assigned: "accent", testing: "accent",
    open: "warning", high: "warning",
    medium: "info", low: "muted", skipped: "muted",
  };
  return <Badge status={map[status] || "muted"}>{status}</Badge>;
}

function pct(n: number | null): string {
  return n !== null ? `${(n * 100).toFixed(0)}%` : "\u2014";
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === "contacts_search") return "Contact search";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function tokenCount(message: ChatMessage): number | null {
  if (!message.usage) return null;
  return message.usage.inputTokens + message.usage.outputTokens;
}

/** Split comma-separated string to trimmed array, filtering empties */
function csvToArr(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function formatIssueEvidence(evidence: unknown): string {
  if (evidence == null) return "";
  if (typeof evidence === "string") {
    try {
      return JSON.stringify(JSON.parse(evidence), null, 2);
    } catch {
      return evidence;
    }
  }
  try {
    return JSON.stringify(evidence, null, 2);
  } catch {
    return String(evidence);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRunExecutionMode(run: TestRun): "live" | "shadow" | "dry_run" {
  const cfg = asRecord(run.model_config);
  const mode = cfg?.executionMode;
  if (mode === "shadow" || mode === "dry_run" || mode === "live") return mode;
  return "live";
}

function parseRunCaseTimeout(run: TestRun): number | null {
  const cfg = asRecord(run.model_config);
  return asNumber(cfg?.caseTimeoutMs ?? null);
}

function parseRunLatencyProfile(run: TestRun): Record<string, number> | null {
  const cfg = asRecord(run.model_config);
  const latency = asRecord(cfg?.latencyProfile ?? null);
  if (!latency) return null;
  const parsed: Record<string, number> = {};
  for (const [key, value] of Object.entries(latency)) {
    const num = asNumber(value);
    if (num !== null) parsed[key] = num;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function modeBadgeStatus(mode: "live" | "shadow" | "dry_run"): "success" | "warning" | "accent" {
  if (mode === "live") return "warning";
  if (mode === "shadow") return "accent";
  return "success";
}

function latencyProfileFromPreset(
  preset: "none" | "light" | "realistic" | "stress",
): Record<string, number> | null {
  if (preset === "none") return null;
  if (preset === "light") {
    return { toolMinMs: 80, toolMaxMs: 250, responseMinMs: 120, responseMaxMs: 380, jitterMs: 40 };
  }
  if (preset === "realistic") {
    return { toolMinMs: 180, toolMaxMs: 900, responseMinMs: 300, responseMaxMs: 1400, jitterMs: 200 };
  }
  return { toolMinMs: 500, toolMaxMs: 2200, responseMinMs: 1200, responseMaxMs: 4200, jitterMs: 650 };
}

function rolloutMetricNumber(rollout: SoulRollout, path: string[]): number | null {
  let cursor: unknown = rollout.metrics;
  for (const segment of path) {
    const record = asRecord(cursor);
    if (!record) return null;
    cursor = record[segment];
  }
  return asNumber(cursor);
}

// ─── Component ───

export default function QualityCenter({ ws }: { ws?: WsHandle }) {
  const [tab, setTab] = useState("cases");
  const [suites, setSuites] = useState<Suite[]>([]);
  const [allCases, setAllCases] = useState<FlatCase[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedRun, setSelectedRun] = useState<(TestRun & { results: TestResult[] }) | null>(null);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runProgress, setRunProgress] = useState<Record<string, { runId: string; suiteId: string; total: number; completed: number; currentCase: string; results: Array<{ caseName: string; status: string }> }>>({});
  const [runExecutionMode, setRunExecutionMode] = useState<"live" | "shadow" | "dry_run">("shadow");
  const [runLatencyPreset, setRunLatencyPreset] = useState<"none" | "light" | "realistic" | "stress">("realistic");
  const [runTimeoutMs, setRunTimeoutMs] = useState("90000");
  const [runKeepArtifacts, setRunKeepArtifacts] = useState(false);
  const [issueFilter, setIssueFilter] = useState<string>("open");
  const [search, setSearch] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [soulSummary, setSoulSummary] = useState<SoulGovernanceSummary | null>(null);
  const [soulRollouts, setSoulRollouts] = useState<SoulRollout[]>([]);
  const [soulBusy, setSoulBusy] = useState(false);
  const [soulActionKey, setSoulActionKey] = useState<string | null>(null);

  // Create/edit modals
  const [showSuiteModal, setShowSuiteModal] = useState(false);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [suiteForm, setSuiteForm] = useState({ ...emptySuiteForm });

  const [showCaseModal, setShowCaseModal] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [caseForSuiteId, setCaseForSuiteId] = useState<string | null>(null);
  const [caseForm, setCaseForm] = useState({ ...emptyCaseForm });

  // Live Chat Lab (always open in page)
  const [liveInput, setLiveInput] = useState("");
  const [liveCaptureSuiteId, setLiveCaptureSuiteId] = useState("");
  const [liveCaptureSavingId, setLiveCaptureSavingId] = useState<string | null>(null);
  const [liveCaptureError, setLiveCaptureError] = useState<string | null>(null);
  const [liveCaptureSuccess, setLiveCaptureSuccess] = useState<string | null>(null);
  const [liveCapturedMessageIds, setLiveCapturedMessageIds] = useState<Set<string>>(new Set());

  const liveWsSend = useCallback((type: string, data?: unknown, id?: string) => {
    ws?.send?.(type, data, id);
  }, [ws]);
  const liveWsOn = useCallback((type: string, handler: (frame: { type: string; id?: string; data?: unknown; error?: string }) => void) => {
    if (!ws) return () => {};
    return ws.on(type, handler);
  }, [ws]);
  const {
    messages: liveMessages,
    isStreaming: liveStreaming,
    conversationId: liveConversationId,
    sendMessage: sendLiveMessageRaw,
    newConversation: newLiveConversation,
  } = useChat({
    send: liveWsSend,
    on: liveWsOn,
  });

  // ─── Data Loading ───

  const loadSuites = useCallback(async () => {
    const res = await fetch("/api/quality/suites");
    if (res.ok) setSuites(await res.json());
  }, []);

  const loadAllCases = useCallback(async () => {
    const res = await fetch("/api/quality/cases");
    if (res.ok) setAllCases(await res.json());
  }, []);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/quality/runs?limit=50");
    if (res.ok) setRuns(await res.json());
  }, []);

  const loadIssues = useCallback(async () => {
    const params = issueFilter !== "all" ? `?status=${issueFilter}` : "";
    const res = await fetch(`/api/quality/issues${params}`);
    if (res.ok) {
      const data = await res.json();
      setIssues(data.issues || data);
    }
  }, [issueFilter]);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/quality/stats");
    if (res.ok) setStats(await res.json());
  }, []);

  const loadSoulGovernance = useCallback(async () => {
    const [summaryRes, rolloutsRes] = await Promise.all([
      fetch("/api/soul/governance/summary"),
      fetch("/api/soul/rollouts?limit=120"),
    ]);

    if (summaryRes.ok) {
      const payload = await summaryRes.json() as { summary?: SoulGovernanceSummary };
      setSoulSummary(payload.summary || null);
    }

    if (rolloutsRes.ok) {
      const payload = await rolloutsRes.json() as { rollouts?: SoulRollout[] };
      setSoulRollouts(Array.isArray(payload.rollouts) ? payload.rollouts : []);
    }
  }, []);

  const loadAll = useCallback(() => {
    loadSuites(); loadAllCases(); loadRuns(); loadIssues(); loadStats(); loadSoulGovernance();
  }, [loadSuites, loadAllCases, loadRuns, loadIssues, loadStats, loadSoulGovernance]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadIssues(); }, [loadIssues]);

  // ─── WebSocket — Live Updates ───

  useEffect(() => {
    if (!ws) return;
    const unsubs = [
      ws.on("qa.run_started", (frame) => {
        const d = frame.data as { runId: string; suiteId: string; suiteName: string; totalCases: number } | undefined;
        if (d) {
          setRunProgress((prev) => ({ ...prev, [d.suiteId]: { runId: d.runId, suiteId: d.suiteId, total: d.totalCases, completed: 0, currentCase: "Starting...", results: [] } }));
          setRunningIds((prev) => new Set([...prev, d.suiteId]));
        }
        loadRuns(); loadStats();
      }),
      ws.on("qa.case_result", (frame) => {
        const d = frame.data as { runId: string; caseName: string; status: string } | undefined;
        if (d) {
          setRunProgress((prev) => {
            const updated = { ...prev };
            for (const [suiteId, prog] of Object.entries(updated)) {
              if (prog.runId === d.runId) {
                updated[suiteId] = {
                  ...prog,
                  completed: prog.completed + 1,
                  currentCase: d.caseName,
                  results: [...prog.results, { caseName: d.caseName, status: d.status }],
                };
                break;
              }
            }
            return updated;
          });
        }
        if (selectedRun) loadRunDetail(selectedRun.id);
      }),
      ws.on("qa.run_completed", (frame) => {
        const d = frame.data as { suiteId: string } | undefined;
        if (d) {
          setRunProgress((prev) => { const next = { ...prev }; delete next[d.suiteId]; return next; });
          setRunningIds((prev) => { const next = new Set(prev); next.delete(d.suiteId); return next; });
        } else {
          setRunProgress({});
          setRunningIds(new Set());
        }
        loadRuns(); loadStats(); loadSuites();
      }),
      ws.on("qa.issue_created", () => { loadIssues(); loadStats(); }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [ws, selectedRun, loadRuns, loadStats, loadSuites, loadIssues]);

  // ─── Suite CRUD ───

  const openCreateSuite = () => {
    setEditingSuiteId(null);
    setSuiteForm({ ...emptySuiteForm });
    setShowSuiteModal(true);
  };

  const openEditSuite = (s: Suite) => {
    setEditingSuiteId(s.id);
    setSuiteForm({ name: s.name, description: s.description || "", agent_id: s.agent_id, tags: s.tags.join(", ") });
    setShowSuiteModal(true);
  };

  const saveSuite = async () => {
    const body = {
      name: suiteForm.name,
      description: suiteForm.description || null,
      agent_id: suiteForm.agent_id,
      tags: csvToArr(suiteForm.tags),
    };
    if (editingSuiteId) {
      await fetch(`/api/quality/suites/${editingSuiteId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/quality/suites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setShowSuiteModal(false);
    loadSuites();
    loadAllCases();
    loadStats();
  };

  const deleteSuite = async (id: string) => {
    await fetch(`/api/quality/suites/${id}`, { method: "DELETE" });
    if (expandedSuite === id) setExpandedSuite(null);
    loadSuites();
    loadAllCases();
    loadStats();
  };

  // ─── Case CRUD ───

  const openCreateCase = (suiteId: string) => {
    setEditingCaseId(null);
    setCaseForSuiteId(suiteId);
    setCaseForm({ ...emptyCaseForm });
    setShowCaseModal(true);
  };

  const openEditCase = (c: TestCase) => {
    setEditingCaseId(c.id);
    setCaseForSuiteId(c.suite_id);
    setCaseForm({
      name: c.name,
      input_message: c.input_message,
      expected_tools: c.expected_tools.join(", "),
      unexpected_tools: c.unexpected_tools.join(", "),
      expected_content_patterns: c.expected_content_patterns.join(", "),
      max_latency_ms: c.max_latency_ms != null ? String(c.max_latency_ms) : "",
      min_quality_score: String(c.min_quality_score),
    });
    setShowCaseModal(true);
  };

  const saveCase = async () => {
    const body = {
      name: caseForm.name,
      input_message: caseForm.input_message,
      expected_tools: csvToArr(caseForm.expected_tools),
      unexpected_tools: csvToArr(caseForm.unexpected_tools),
      expected_content_patterns: csvToArr(caseForm.expected_content_patterns),
      max_latency_ms: caseForm.max_latency_ms ? parseInt(caseForm.max_latency_ms) : null,
      min_quality_score: parseFloat(caseForm.min_quality_score) || 0.5,
    };
    if (editingCaseId) {
      await fetch(`/api/quality/cases/${editingCaseId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch(`/api/quality/suites/${caseForSuiteId}/cases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setShowCaseModal(false);
    // Refresh expanded suite
    if (caseForSuiteId) loadSuiteDetail(caseForSuiteId, true);
    loadSuites();
    loadAllCases();
    loadStats();
  };

  const deleteCase = async (id: string) => {
    await fetch(`/api/quality/cases/${id}`, { method: "DELETE" });
    if (expandedSuite) loadSuiteDetail(expandedSuite, true);
    loadSuites();
    loadAllCases();
    loadStats();
  };

  // ─── Actions ───

  const runSuite = async (suiteId: string) => {
    setRunningIds((prev) => new Set([...prev, suiteId]));
    const latencyProfile = latencyProfileFromPreset(runLatencyPreset);
    const timeout = Number.parseInt(runTimeoutMs, 10);
    try {
      const res = await fetch(`/api/quality/suites/${suiteId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionMode: runExecutionMode,
          ...(Number.isFinite(timeout) && timeout > 0 ? { caseTimeoutMs: timeout } : {}),
          ...(latencyProfile ? { latencyProfile } : {}),
          ...(runKeepArtifacts ? { keepConversationArtifacts: true } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to start suite run");
    } catch {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(suiteId);
        return next;
      });
    } finally {
      loadRuns();
    }
  };

  const loadRunDetail = async (runId: string) => {
    const res = await fetch(`/api/quality/runs/${runId}`);
    if (res.ok) setSelectedRun(await res.json());
  };

  const loadSuiteDetail = async (suiteId: string, force?: boolean) => {
    if (!force && expandedSuite === suiteId) { setExpandedSuite(null); return; }
    const res = await fetch(`/api/quality/suites/${suiteId}`);
    if (res.ok) {
      const data = await res.json();
      setSuites((prev) => prev.map((s) => s.id === suiteId ? { ...s, cases: data.cases } : s));
      setExpandedSuite(suiteId);
    }
  };

  const pushIssueToAutodev = async (issueId: string) => {
    const res = await fetch(`/api/quality/issues/${issueId}/autodev`, { method: "POST" });
    const data = res.ok ? await res.json() as { issue?: Issue } : null;
    const updated = data?.issue;
    await Promise.all([loadIssues(), loadStats()]);
    setSelectedIssue((prev) => {
      if (!prev || prev.id !== issueId) return prev;
      if (updated) return updated;
      return { ...prev, status: "autodev_assigned" };
    });
  };

  const openTaskInThings = async (taskUuid: string) => {
    await fetch(`/api/tasks/${taskUuid}/show`, { method: "POST" });
  };

  const runSoulRolloutAction = async (
    rolloutId: string,
    action: "evaluate" | "promote" | "rollback" | "cancel",
  ) => {
    const actionKey = `${rolloutId}:${action}`;
    setSoulActionKey(actionKey);
    try {
      const response = await fetch(`/api/soul/rollouts/${rolloutId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "evaluate"
            ? { applyDecision: true }
            : { reason: `Manual ${action} from Quality Center` },
        ),
      });
      if (!response.ok) {
        throw new Error(`Soul rollout action failed: ${action}`);
      }
      await Promise.all([loadSoulGovernance(), loadIssues(), loadStats()]);
    } finally {
      setSoulActionKey(null);
    }
  };

  const evaluateAllSoulRolloutsNow = async () => {
    setSoulBusy(true);
    try {
      await fetch("/api/soul/rollouts/evaluate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyDecision: true }),
      });
      await Promise.all([loadSoulGovernance(), loadIssues(), loadStats()]);
    } finally {
      setSoulBusy(false);
    }
  };

  const sendLiveChatMessage = () => {
    if (!liveInput.trim() || liveStreaming || ws?.status !== "connected") return;
    const latencyProfile = latencyProfileFromPreset(runLatencyPreset);
    sendLiveMessageRaw(liveInput.trim(), "api", "personal", {
      executionMode: runExecutionMode,
      ...(latencyProfile ? { latencyProfile } : {}),
      source: "quality-live-chat",
    });
    setLiveInput("");
  };

  const captureLiveResult = useCallback(async (
    assistantMessage: ChatMessage,
    previousUserInput: string,
    options?: {
      status?: "passed" | "failed" | "errored";
      reason?: string;
      silent?: boolean;
    },
  ) => {
    const status = options?.status || "passed";
    const reason = options?.reason?.trim() || "Captured issue from live chat simulation";
    const inputMessage = previousUserInput.trim() || "Captured from live chat";
    const baseCaseName = inputMessage.replace(/\s+/g, " ").slice(0, 72);
    const failureReasons = status === "passed" ? [] : [reason];
    const latencyProfile = latencyProfileFromPreset(runLatencyPreset);

    setLiveCaptureSavingId(assistantMessage.id);
    if (!options?.silent) {
      setLiveCaptureError(null);
      setLiveCaptureSuccess(null);
    }

    try {
      const res = await fetch("/api/quality/live-captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId: liveCaptureSuiteId || null,
          caseName: baseCaseName ? `Live Chat: ${baseCaseName}` : "Live Chat Capture",
          inputMessage,
          status,
          failureReasons,
          expectedTools: (assistantMessage.toolCalls || []).map((tc) => tc.name).filter(Boolean),
          assistant: {
            content: assistantMessage.content || "",
            toolCalls: assistantMessage.toolCalls || [],
            latencyMs: assistantMessage.latencyMs ?? null,
            ttftMs: assistantMessage.ttftMs ?? null,
            timings: assistantMessage.timings ?? null,
            model: assistantMessage.model ?? null,
            provider: assistantMessage.provider ?? null,
            costUsd: assistantMessage.costUsd ?? 0,
            usage: assistantMessage.usage ?? null,
            routeReason: assistantMessage.routeReason ?? null,
            routeConfidence: assistantMessage.routeConfidence ?? null,
            agentId: assistantMessage.agentId ?? null,
            agentName: assistantMessage.agentName ?? null,
            delegations: assistantMessage.delegations ?? [],
            executionMode: runExecutionMode,
            latencyProfile,
            conversationId: liveConversationId,
          },
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Failed to save live capture");

      setLiveCapturedMessageIds((prev) => {
        const next = new Set(prev);
        next.add(assistantMessage.id);
        return next;
      });
      await Promise.all([loadRuns(), loadStats(), loadIssues(), loadSuites()]);
      if (!options?.silent) {
        setLiveCaptureSuccess(`Saved run ${payload?.run?.id?.slice(0, 8) || "ok"}`);
      }
    } catch (err) {
      if (!options?.silent) {
        const message = err instanceof Error ? err.message : "Failed to save live capture";
        setLiveCaptureError(message);
      }
    } finally {
      setLiveCaptureSavingId(null);
    }
  }, [
    liveCaptureSuiteId,
    runExecutionMode,
    runLatencyPreset,
    liveConversationId,
    loadRuns,
    loadStats,
    loadIssues,
    loadSuites,
  ]);

  const onLiveInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendLiveChatMessage();
    }
  };

  const previousUserMessageForIndex = useCallback((messageIndex: number): string => {
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (liveMessages[i]?.role === "user") {
        return liveMessages[i].content || "";
      }
    }
    return "";
  }, [liveMessages]);

  useEffect(() => {
    if (liveCaptureSuiteId) return;
    const liveSuite = suites.find((s) => s.name.toLowerCase() === "live chat captures");
    if (liveSuite) {
      setLiveCaptureSuiteId(liveSuite.id);
      return;
    }
    const coreSuite = suites.find((s) => s.name.toLowerCase() === "core agent behavior");
    if (coreSuite) {
      setLiveCaptureSuiteId(coreSuite.id);
    }
  }, [liveCaptureSuiteId, suites]);

  useEffect(() => {
    if (liveCaptureSavingId) return;
    const nextIndex = liveMessages.findIndex((message) =>
      message.role === "assistant"
      && !message.isStreaming
      && !liveCapturedMessageIds.has(message.id));
    if (nextIndex < 0) return;

    const assistantMessage = liveMessages[nextIndex];
    const previousUserInput = previousUserMessageForIndex(nextIndex);
    const hasToolError = (assistantMessage.toolCalls || []).some((tool) => tool.error);

    void captureLiveResult(assistantMessage, previousUserInput, {
      status: hasToolError ? "failed" : "passed",
      reason: hasToolError ? "Tool call failed during live simulation" : "",
      silent: true,
    });
  }, [
    liveMessages,
    liveCaptureSavingId,
    liveCapturedMessageIds,
    previousUserMessageForIndex,
    captureLiveResult,
  ]);

  // ─── Filtered Data ───

  const filteredSuites = useMemo(() => {
    if (!search) return suites;
    const q = search.toLowerCase();
    return suites.filter((s) => s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
  }, [suites, search]);

  const filteredAllCases = useMemo(() => {
    if (!search) return allCases;
    const q = search.toLowerCase();
    return allCases.filter((c) =>
      c.name.toLowerCase().includes(q)
      || c.suite_name.toLowerCase().includes(q)
      || c.category.toLowerCase().includes(q),
    );
  }, [allCases, search]);

  const filteredRuns = useMemo(() => {
    if (!search) return runs;
    const q = search.toLowerCase();
    return runs.filter((r) => r.suite_name.toLowerCase().includes(q));
  }, [runs, search]);

  const filteredIssues = useMemo(() => {
    if (!search) return issues;
    const q = search.toLowerCase();
    return issues.filter((i) => i.title.toLowerCase().includes(q) || i.category.includes(q));
  }, [issues, search]);

  const filteredSoulRollouts = useMemo(() => {
    if (!search) return soulRollouts;
    const q = search.toLowerCase();
    return soulRollouts.filter((r) =>
      r.agent_id.toLowerCase().includes(q)
      || r.status.toLowerCase().includes(q)
      || (r.decision_reason || "").toLowerCase().includes(q));
  }, [soulRollouts, search]);

  // ─── Column Definitions ───

  const suiteColumns: UnifiedListColumn<Suite>[] = [
    { key: "name", header: "Suite", render: (s) => <strong>{s.name}</strong>, sortValue: (s) => s.name },
    { key: "agent", header: "Agent", render: (s) => <MetaText>{s.agent_id}</MetaText>, width: 120 },
    { key: "cases", header: "Cases", render: (s) => s.case_count, width: 70, align: "center", sortValue: (s) => s.case_count },
    { key: "tags", header: "Tags", render: (s) => <Row gap={4}>{s.tags.map((t) => <Badge key={t} status="muted">{t}</Badge>)}</Row>, width: 200 },
    {
      key: "last_run", header: "Status", width: 220,
      render: (s) => {
        const prog = runProgress[s.id];
        if (prog) {
          const pct = prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
          const passCount = prog.results.filter((r) => r.status === "passed").length;
          const failCount = prog.results.filter((r) => r.status !== "passed").length;
          return (
            <Stack gap={4} style={{ width: "100%" }}>
              <Row gap={6} style={{ alignItems: "center" }}>
                <span className="qa-spinner" />
                <MetaText style={{ fontWeight: 600 }}>{prog.completed}/{prog.total} cases</MetaText>
                {passCount > 0 && <span style={{ color: "var(--green)", fontSize: 12 }}>{passCount}P</span>}
                {failCount > 0 && <span style={{ color: "var(--red)", fontSize: 12 }}>{failCount}F</span>}
              </Row>
              <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: failCount > 0 ? "var(--orange)" : "var(--green)", borderRadius: 2, transition: "width 0.3s ease" }} />
              </div>
              <MetaText style={{ fontSize: 11 }}>{prog.currentCase}</MetaText>
            </Stack>
          );
        }
        return s.last_run_at
          ? <Row gap={6}>{statusBadge(s.last_run_status || "\u2014")}<MetaText>{timeAgo(s.last_run_at)}</MetaText></Row>
          : <MetaText>never run</MetaText>;
      },
      sortValue: (s) => s.last_run_at || "",
    },
    {
      key: "actions", header: "", width: 180, align: "right",
      render: (s) => (
        <Row gap={4}>
          <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEditSuite(s); }}>Edit</Button>
          <Button
            size="sm"
            variant={runningIds.has(s.id) ? "ghost" : "primary"}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); runSuite(s.id); }}
            disabled={runningIds.has(s.id)}
          >
            {runningIds.has(s.id) ? "Running..." : "Run"}
          </Button>
        </Row>
      ),
    },
  ];

  const allCaseColumns: UnifiedListColumn<FlatCase>[] = [
    { key: "name", header: "Case", render: (c) => <strong>{c.name}</strong>, sortValue: (c) => c.name },
    { key: "suite", header: "Suite", width: 220, render: (c) => <MetaText>{c.suite_name}</MetaText>, sortValue: (c) => c.suite_name },
    {
      key: "category",
      header: "Category",
      width: 130,
      render: (c) => <Badge status={c.category === "single-turn" ? "muted" : "accent"}>{c.category}</Badge>,
      sortValue: (c) => c.category,
    },
    {
      key: "latency",
      header: "Latency",
      width: 100,
      render: (c) => c.max_latency_ms ? <MetaText>{c.max_latency_ms}ms</MetaText> : <MetaText>—</MetaText>,
      sortValue: (c) => c.max_latency_ms || 0,
    },
    {
      key: "enabled",
      header: "Status",
      width: 90,
      render: (c) => <Badge status={c.enabled ? "success" : "muted"}>{c.enabled ? "on" : "off"}</Badge>,
      sortValue: (c) => (c.enabled ? 1 : 0),
    },
    {
      key: "actions",
      header: "",
      width: 160,
      align: "right",
      render: (c) => (
        <Row gap={4}>
          <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEditCase(c); }}>Edit</Button>
          <Button size="sm" variant="danger" onClick={(e: React.MouseEvent) => { e.stopPropagation(); if (confirm(`Delete case "${c.name}"?`)) deleteCase(c.id); }}>Del</Button>
        </Row>
      ),
    },
  ];

  const runColumns: UnifiedListColumn<TestRun>[] = [
    { key: "suite", header: "Suite", render: (r) => <strong>{r.suite_name}</strong>, sortValue: (r) => r.suite_name },
    {
      key: "mode",
      header: "Mode",
      width: 120,
      render: (r) => {
        const mode = parseRunExecutionMode(r);
        return <Badge status={modeBadgeStatus(mode)}>{mode}</Badge>;
      },
      sortValue: (r) => parseRunExecutionMode(r),
    },
    {
      key: "status", header: "Status", width: 140,
      render: (r) => {
        if (r.status === "running") {
          // Find matching progress by runId
          const prog = Object.values(runProgress).find((p) => p.runId === r.id);
          if (prog) {
            return (
              <Row gap={6} style={{ alignItems: "center" }}>
                <span className="qa-spinner" />
                <MetaText style={{ fontWeight: 600 }}>{prog.completed}/{prog.total}</MetaText>
              </Row>
            );
          }
          return <Row gap={6}><span className="qa-spinner" /><MetaText>running</MetaText></Row>;
        }
        return statusBadge(r.status);
      },
    },
    { key: "triggered", header: "Trigger", width: 80, render: (r) => <MetaText>{r.triggered_by}</MetaText> },
    {
      key: "results", header: "Pass/Fail", width: 120,
      render: (r) => (
        <Row gap={6}>
          <span style={{ color: "var(--green)" }}>{r.passed}</span>/<span style={{ color: r.failed > 0 ? "var(--red)" : "inherit" }}>{r.failed}</span>
          {r.errored > 0 && <span style={{ color: "var(--orange)" }}>({r.errored} err)</span>}
        </Row>
      ),
    },
    {
      key: "scores", header: "Avg Scores", width: 200,
      render: (r) => (
        <Row gap={8}>
          <Badge status={scoreColor(r.avg_correctness)}>C: {pct(r.avg_correctness)}</Badge>
          <Badge status={scoreColor(r.avg_tool_accuracy)}>T: {pct(r.avg_tool_accuracy)}</Badge>
          <Badge status={scoreColor(r.avg_response_quality)}>Q: {pct(r.avg_response_quality)}</Badge>
        </Row>
      ),
    },
    { key: "cost", header: "Cost", width: 80, align: "right", render: (r) => <MetaText>${r.total_cost_usd.toFixed(3)}</MetaText>, sortValue: (r) => r.total_cost_usd },
    { key: "date", header: "Date", width: 100, render: (r) => <MetaText>{timeAgo(r.started_at)}</MetaText>, sortValue: (r) => r.started_at },
  ];

  const issueColumns: UnifiedListColumn<Issue>[] = [
    { key: "title", header: "Title", render: (i) => <strong>{i.title}</strong>, sortValue: (i) => i.title },
    { key: "severity", header: "Severity", width: 90, render: (i) => statusBadge(i.severity) },
    { key: "category", header: "Category", width: 100, render: (i) => <Badge status="muted">{i.category}</Badge> },
    { key: "status", header: "Status", width: 120, render: (i) => statusBadge(i.status) },
    {
      key: "autodev", header: "AutoDev", width: 100,
      render: (i) => i.autodev_task_id
        ? (
            <Row gap={4}>
              <Badge status="accent">assigned</Badge>
              <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openTaskInThings(i.autodev_task_id!); }}>Open</Button>
            </Row>
          )
        : i.status === "autodev_assigned"
          ? <Badge status="accent">assigned</Badge>
          : <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); pushIssueToAutodev(i.id); }}>Push</Button>,
    },
    { key: "date", header: "Created", width: 100, render: (i) => <MetaText>{timeAgo(i.created_at)}</MetaText>, sortValue: (i) => i.created_at },
  ];

  const soulRolloutColumns: UnifiedListColumn<SoulRollout>[] = [
    { key: "agent", header: "Agent", width: 120, render: (r) => <strong>{r.agent_id}</strong>, sortValue: (r) => r.agent_id },
    { key: "status", header: "Status", width: 140, render: (r) => statusBadge(r.status) },
    { key: "traffic", header: "Traffic", width: 90, align: "right", render: (r) => <MetaText>{r.traffic_percent}%</MetaText> },
    {
      key: "sample",
      header: "Samples",
      width: 100,
      align: "right",
      render: (r) => <MetaText>{rolloutMetricNumber(r, ["sampleSize"]) ?? 0}/{r.minimum_sample_size}</MetaText>,
      sortValue: (r) => rolloutMetricNumber(r, ["sampleSize"]) ?? -1,
    },
    {
      key: "risk",
      header: "Risk",
      width: 230,
      render: (r) => {
        const reviewDelta = rolloutMetricNumber(r, ["reviewRejectRate", "delta"]);
        const qaDelta = rolloutMetricNumber(r, ["qaFailureRate", "delta"]);
        const incidents = rolloutMetricNumber(r, ["highSeverityIncidents"]);
        return (
          <Row gap={6}>
            <Badge status={reviewDelta !== null && reviewDelta > SOUL_REVIEW_DELTA_WARN ? "error" : "muted"}>
              RR {reviewDelta !== null ? `${(reviewDelta * 100).toFixed(1)}%` : "n/a"}
            </Badge>
            <Badge status={qaDelta !== null && qaDelta > SOUL_QA_DELTA_WARN ? "error" : "muted"}>
              QA {qaDelta !== null ? `${(qaDelta * 100).toFixed(1)}%` : "n/a"}
            </Badge>
            <Badge status={(incidents || 0) > 0 ? "warning" : "success"}>
              HI {incidents ?? 0}
            </Badge>
          </Row>
        );
      },
    },
    { key: "started", header: "Started", width: 110, render: (r) => <MetaText>{timeAgo(r.started_at)}</MetaText>, sortValue: (r) => r.started_at },
    {
      key: "actions",
      header: "",
      width: 330,
      align: "right",
      render: (r) => {
        const canOperate = r.status === "canary_active";
        const evaluateKey = `${r.id}:evaluate`;
        const promoteKey = `${r.id}:promote`;
        const rollbackKey = `${r.id}:rollback`;
        const cancelKey = `${r.id}:cancel`;
        return (
          <Row gap={4}>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                runSoulRolloutAction(r.id, "evaluate");
              }}
              disabled={!canOperate || soulActionKey !== null}
            >
              {soulActionKey === evaluateKey ? "Evaluating..." : "Evaluate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                runSoulRolloutAction(r.id, "promote");
              }}
              disabled={!canOperate || soulActionKey !== null}
            >
              {soulActionKey === promoteKey ? "Promoting..." : "Promote"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (!window.confirm("Rollback this rollout to baseline?")) return;
                runSoulRolloutAction(r.id, "rollback");
              }}
              disabled={!canOperate || soulActionKey !== null}
            >
              {soulActionKey === rollbackKey ? "Rolling back..." : "Rollback"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (!window.confirm("Cancel this active rollout?")) return;
                runSoulRolloutAction(r.id, "cancel");
              }}
              disabled={!canOperate || soulActionKey !== null}
            >
              {soulActionKey === cancelKey ? "Cancelling..." : "Cancel"}
            </Button>
          </Row>
        );
      },
    },
  ];

  // ─── Render ───

  return (
    <>
      <PageHeader
        title="Quality Center"
        subtitle={stats ? `${stats.total_suites} suites, ${stats.total_cases} cases, ${stats.total_runs} runs` : undefined}
        actions={<Row gap={8}><SearchInput value={search} onChange={setSearch} placeholder="Search..." /><Button variant="primary" onClick={openCreateSuite}>New Suite</Button></Row>}
      />
      <PageBody>
        {/* Stats Cards */}
        {stats && (
          <Row gap={12} style={{ flexWrap: "wrap" }}>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Pass Rate</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700, color: stats.pass_rate !== null && stats.pass_rate >= 0.7 ? "var(--green)" : "var(--red)" }}>
                {stats.pass_rate !== null ? `${(stats.pass_rate * 100).toFixed(0)}%` : "\u2014"}
              </div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Open Issues</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.open_issues}</div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Critical</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700, color: stats.critical_issues > 0 ? "var(--red)" : "var(--green)" }}>{stats.critical_issues}</div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Last Run</MetaText>
              {stats.last_run ? (
                <>
                  <div style={{ fontSize: 14 }}>{statusBadge(stats.last_run.status)}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>
                    <span style={{ color: "var(--green)" }}>{stats.last_run.passed}P</span>
                    {" / "}
                    <span style={{ color: stats.last_run.failed > 0 ? "var(--red)" : "inherit" }}>{stats.last_run.failed}F</span>
                  </div>
                  <MetaText>{timeAgo(stats.last_run.started_at)}</MetaText>
                </>
              ) : <div style={{ fontSize: 24, fontWeight: 700 }}>{"\u2014"}</div>}
            </Card>
          </Row>
        )}

        <Card>
          <Stack gap={6}>
            <strong>Simulation Defaults</strong>
            <MetaText>
              Simple mode: chat simulation runs with safe `shadow` execution and `realistic` latency.
            </MetaText>
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
                Advanced controls
              </summary>
              <Row gap={12} style={{ flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
                <FormField label="Execution Mode">
                  <select value={runExecutionMode} onChange={(e) => setRunExecutionMode(e.target.value as "live" | "shadow" | "dry_run")}>
                    <option value="shadow">shadow (safe read-only)</option>
                    <option value="dry_run">dry_run (simulated tools)</option>
                    <option value="live">live (real side effects)</option>
                  </select>
                </FormField>
                <FormField label="Latency Profile">
                  <select value={runLatencyPreset} onChange={(e) => setRunLatencyPreset(e.target.value as "none" | "light" | "realistic" | "stress")}>
                    <option value="none">none</option>
                    <option value="light">light</option>
                    <option value="realistic">realistic</option>
                    <option value="stress">stress</option>
                  </select>
                </FormField>
                <FormField label="Case Timeout (ms)">
                  <input type="number" min={1000} step={500} value={runTimeoutMs} onChange={(e) => setRunTimeoutMs(e.target.value)} />
                </FormField>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={runKeepArtifacts}
                    onChange={(e) => setRunKeepArtifacts(e.target.checked)}
                  />
                  Keep QA conversations
                </label>
              </Row>
            </details>
          </Stack>
        </Card>

        <Card>
          <Stack gap={8}>
            <Row justify="between" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <strong>Live Chat Lab</strong>
                <MetaText style={{ display: "block" }}>
                  Simulate real chat here, inspect debug inline, and save assistant outputs as QA test results.
                </MetaText>
              </div>
              <Row gap={6}>
                <Badge status={ws?.status === "connected" ? "success" : "warning"}>
                  WS {ws?.status || "disconnected"}
                </Badge>
                {liveConversationId && <Badge status="muted">conv {liveConversationId.slice(0, 8)}</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    newLiveConversation();
                    setLiveCapturedMessageIds(new Set());
                    setLiveCaptureError(null);
                    setLiveCaptureSuccess(null);
                  }}
                  disabled={liveStreaming}
                >
                  New Chat
                </Button>
              </Row>
            </Row>

            <MetaText>
              Every assistant response is auto-saved to test results. If a response is bad, click <strong>Flag issue</strong>.
            </MetaText>

            {liveCaptureError && <MetaText style={{ color: "var(--red)" }}>{liveCaptureError}</MetaText>}
            {liveCaptureSuccess && <MetaText style={{ color: "var(--green)" }}>{liveCaptureSuccess}</MetaText>}

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--bg-secondary)",
                maxHeight: 440,
                overflowY: "auto",
                padding: 10,
              }}
            >
              <Stack gap={8}>
                {liveMessages.length === 0 && (
                  <EmptyState message="No simulated chat yet. Send a message below to start." />
                )}
                {liveMessages.map((message, index) => {
                  const tools = Array.isArray(message.toolCalls) ? message.toolCalls : [];
                  const totalTokens = tokenCount(message);
                  const captureBusy = liveCaptureSavingId === message.id;
                  const alreadyCaptured = liveCapturedMessageIds.has(message.id);
                  const isAssistantDone = message.role === "assistant" && !message.isStreaming;

                  return (
                    <Card
                      key={message.id}
                      style={{
                        padding: 10,
                        borderLeft: `3px solid ${message.role === "assistant" ? "var(--blue)" : message.role === "user" ? "var(--orange)" : "var(--border)"}`,
                      }}
                    >
                      <Stack gap={6}>
                        <Row justify="between" style={{ flexWrap: "wrap" }}>
                          <Row gap={6} style={{ flexWrap: "wrap" }}>
                            <Badge status={message.role === "assistant" ? "accent" : message.role === "user" ? "warning" : "muted"}>
                              {message.role}
                            </Badge>
                            {message.isStreaming && <Badge status="accent">streaming</Badge>}
                            {alreadyCaptured && <Badge status="success">saved</Badge>}
                            {message.agentName && <Badge status="muted">{message.agentName}</Badge>}
                            {message.model && <Badge status="muted">{message.model}</Badge>}
                            {message.latencyMs !== undefined && <MetaText>{formatDuration(message.latencyMs)}</MetaText>}
                            {message.ttftMs !== undefined && <MetaText>TTFT {formatDuration(message.ttftMs)}</MetaText>}
                            {totalTokens !== null && <MetaText>{totalTokens} tokens</MetaText>}
                            {typeof message.costUsd === "number" && message.costUsd > 0 && (
                              <MetaText>${message.costUsd.toFixed(4)}</MetaText>
                            )}
                          </Row>
                          {isAssistantDone && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => captureLiveResult(
                                message,
                                previousUserMessageForIndex(index),
                                {
                                  status: "failed",
                                  reason: "Flagged issue from live simulation",
                                },
                              )}
                              disabled={captureBusy}
                            >
                              {captureBusy ? "Saving..." : "Flag issue"}
                            </Button>
                          )}
                        </Row>

                        {message.content && (
                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, fontSize: 13 }}>
                            {message.content}
                          </div>
                        )}

                        {(message.routeReason || message.routeConfidence !== undefined || (message.delegations?.length || 0) > 0) && (
                          <Row gap={6} style={{ flexWrap: "wrap" }}>
                            {message.routeReason && <Badge status="info">route: {message.routeReason}</Badge>}
                            {typeof message.routeConfidence === "number" && (
                              <Badge status="info">conf {(message.routeConfidence * 100).toFixed(0)}%</Badge>
                            )}
                            {(message.delegations || []).map((delegation, delegationIndex) => (
                              <Badge
                                key={`${message.id}:delegation:${delegationIndex}`}
                                status={delegation.status === "success" ? "success" : delegation.status === "error" ? "error" : "muted"}
                              >
                                {delegation.agentName || delegation.agentId} {delegation.status}
                              </Badge>
                            ))}
                          </Row>
                        )}

                        {tools.length > 0 && (
                          <details>
                            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" }}>
                              Tools ({tools.length})
                            </summary>
                            <Stack gap={4} style={{ marginTop: 6 }}>
                              {tools.map((tool) => (
                                <div
                                  key={`${message.id}:${tool.id}`}
                                  style={{ padding: 8, borderRadius: 6, background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                                >
                                  <Row gap={6} style={{ flexWrap: "wrap", marginBottom: 4 }}>
                                    <Badge status={tool.error ? "error" : "info"}>{formatToolName(tool.name)}</Badge>
                                    {tool.durationMs !== undefined && <MetaText>{formatDuration(tool.durationMs)}</MetaText>}
                                  </Row>
                                  <pre
                                    style={{
                                      margin: 0,
                                      maxHeight: 140,
                                      overflow: "auto",
                                      fontSize: 11,
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {JSON.stringify({ input: tool.input, result: tool.result }, null, 2).slice(0, 1800)}
                                  </pre>
                                </div>
                              ))}
                            </Stack>
                          </details>
                        )}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            </div>

            <Row gap={8} style={{ alignItems: "flex-end" }}>
              <textarea
                rows={3}
                value={liveInput}
                onChange={(e) => setLiveInput(e.target.value)}
                onKeyDown={onLiveInputKeyDown}
                placeholder="Type test prompt. Enter sends, Shift+Enter newline."
                style={{ flex: 1 }}
              />
              <Stack gap={4}>
                <Button
                  variant="primary"
                  onClick={sendLiveChatMessage}
                  disabled={!liveInput.trim() || liveStreaming || ws?.status !== "connected"}
                >
                  {liveStreaming ? "Streaming..." : "Send"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTab("runs")}>
                  Open Runs
                </Button>
              </Stack>
            </Row>
          </Stack>
        </Card>

        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            {
              label: "All Cases",
              value: "cases",
              content: (
                <Stack gap={12}>
                  <UnifiedList<FlatCase>
                    items={filteredAllCases}
                    columns={allCaseColumns}
                    rowKey={(c) => c.id}
                    onRowClick={(c) => openEditCase(c)}
                    emptyMessage="No test cases found."
                    defaultSort={{ key: "suite" }}
                  />
                </Stack>
              ),
            },
            {
              label: "Test Suites",
              value: "suites",
              content: (
                <Stack gap={12}>
                  <UnifiedList<Suite>
                    items={filteredSuites}
                    columns={suiteColumns}
                    rowKey={(s) => s.id}
                    onRowClick={(s) => loadSuiteDetail(s.id)}
                    emptyMessage="No test suites yet. Click 'New Suite' to create one."
                    defaultSort={{ key: "name" }}
                  />

                  {/* Expanded suite → show test cases */}
                  {expandedSuite && (() => {
                    const suite = suites.find((s) => s.id === expandedSuite);
                    if (!suite?.cases) return null;
                    return (
                      <Card style={{ marginTop: 8 }}>
                        <Stack gap={8}>
                          <Row gap={8}>
                            <strong>{suite.name} — Test Cases ({suite.cases.length})</strong>
                            <Button size="sm" variant="primary" onClick={() => openCreateCase(suite.id)}>Add Case</Button>
                            <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete suite "${suite.name}" and all its cases?`)) deleteSuite(suite.id); }}>Delete Suite</Button>
                          </Row>
                          {suite.cases.length === 0 && <MetaText>No test cases yet. Click "Add Case" to create one.</MetaText>}
                          {suite.cases.length > 0 && <MetaText>Tip: click a case row to open it.</MetaText>}
                          {suite.cases.map((c) => (
                            <div key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                              <Row
                                gap={8}
                                style={{ alignItems: "center", cursor: "pointer" }}
                                role="button"
                                tabIndex={0}
                                onClick={() => openEditCase(c)}
                                onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openEditCase(c);
                                  }
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <strong>{c.name}</strong>
                                  {c.turns
                                    ? <MetaText> — {c.turn_count} turns</MetaText>
                                    : <MetaText style={{ display: "inline", overflow: "hidden", textOverflow: "ellipsis" }}> — "{c.input_message}"</MetaText>
                                  }
                                </div>
                                {c.category !== "single-turn" && <Badge status="accent">{c.category}</Badge>}
                                {c.max_latency_ms && <MetaText>&lt;{c.max_latency_ms}ms</MetaText>}
                                <Badge status={c.enabled ? "success" : "muted"}>{c.enabled ? "on" : "off"}</Badge>
                                <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEditCase(c); }}>Edit</Button>
                                <Button size="sm" variant="danger" onClick={(e: React.MouseEvent) => { e.stopPropagation(); if (confirm(`Delete case "${c.name}"?`)) deleteCase(c.id); }}>Del</Button>
                              </Row>

                              {/* Description */}
                              {c.description && (
                                <MetaText style={{ display: "block", marginTop: 4, paddingLeft: 2 }}>{c.description}</MetaText>
                              )}

                              {/* Expected tools */}
                              {c.expected_tools.length > 0 && (
                                <Row gap={4} style={{ marginTop: 4, flexWrap: "wrap" }}>
                                  {c.expected_tools.map((t) => <Badge key={t} status="info">{t}</Badge>)}
                                </Row>
                              )}

                              {/* Multi-turn: expandable turn list */}
                              {c.turns && c.turns.length > 0 && (
                                <details style={{ marginTop: 6 }}>
                                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
                                    Show {c.turns.length} turns
                                  </summary>
                                  <Stack gap={2} style={{ marginTop: 4, paddingLeft: 8 }}>
                                    {c.turns.map((turn, i) => (
                                      <div key={i} style={{ fontSize: 13, padding: "3px 0", borderLeft: "2px solid var(--border)", paddingLeft: 8 }}>
                                        <Row gap={6} style={{ flexWrap: "wrap" }}>
                                          <span style={{ fontWeight: 600, color: "var(--text-secondary)", minWidth: 16 }}>{i + 1}.</span>
                                          <span style={{ flex: 1, minWidth: 0 }}>{turn.message}</span>
                                        </Row>
                                        {turn.description && (
                                          <MetaText style={{ display: "block", paddingLeft: 24, fontStyle: "italic" }}>{turn.description}</MetaText>
                                        )}
                                        {(turn.expected_tools?.length || turn.expected_content_patterns?.length) && (
                                          <Row gap={4} style={{ paddingLeft: 24, marginTop: 2, flexWrap: "wrap" }}>
                                            {turn.expected_tools?.map((t) => <Badge key={t} status="info">{t}</Badge>)}
                                            {turn.expected_content_patterns?.map((p, j) => <Badge key={j} status="muted">/{p}/</Badge>)}
                                          </Row>
                                        )}
                                      </div>
                                    ))}
                                  </Stack>
                                </details>
                              )}
                            </div>
                          ))}
                        </Stack>
                      </Card>
                    );
                  })()}
                </Stack>
              ),
            },
            {
              label: "Test Runs",
              value: "runs",
              content: (
                <Stack gap={12}>
                  <UnifiedList<TestRun>
                    items={filteredRuns}
                    columns={runColumns}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => loadRunDetail(r.id)}
                    emptyMessage="No test runs yet — run a suite to see results"
                    defaultSort={{ key: "date", direction: "desc" }}
                  />

                  {selectedRun && (
                    <Card style={{ marginTop: 8 }}>
                      <Stack gap={8}>
                        <Row gap={8} style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{selectedRun.suite_name} — Run Detail</strong>
                          {statusBadge(selectedRun.status)}
                          {(() => {
                            const mode = parseRunExecutionMode(selectedRun);
                            return <Badge status={modeBadgeStatus(mode)}>{mode}</Badge>;
                          })()}
                          {(() => {
                            const timeout = parseRunCaseTimeout(selectedRun);
                            return timeout ? <MetaText>timeout {timeout}ms</MetaText> : null;
                          })()}
                          {parseRunLatencyProfile(selectedRun) && <MetaText>latency profile on</MetaText>}
                          <Button size="sm" variant="ghost" onClick={() => setSelectedRun(null)}>Close</Button>
                        </Row>

                        {selectedRun.results?.map((r) => {
                          const resultTools = Array.isArray(r.actual_tools) ? r.actual_tools : [];
                          const failureReasons = Array.isArray(r.failure_reasons) ? r.failure_reasons : [];
                          const turnResults = Array.isArray(r.turn_results) ? r.turn_results : [];
                          const actualContent = typeof r.actual_content === "string" ? r.actual_content : "";
                          return (
                            <Card key={r.id} style={{ padding: 12 }}>
                              <Row gap={8} style={{ marginBottom: 6 }}>
                                {statusBadge(r.status)}
                                <strong>{r.case_name}</strong>
                                <MetaText>"{r.input_message}"</MetaText>
                                {r.latency_ms !== null && r.latency_ms !== undefined && <MetaText>{r.latency_ms}ms</MetaText>}
                                {r.model && <Badge status="muted">{r.model}</Badge>}
                                {r.flow_coherence_score !== null && r.flow_coherence_score !== undefined && (
                                  <Badge status={scoreColor(r.flow_coherence_score)}>Flow: {pct(r.flow_coherence_score)}</Badge>
                                )}
                              </Row>

                              {r.judge_scores && (
                                <Row gap={8} style={{ marginBottom: 4 }}>
                                  <Badge status={scoreColor(r.judge_scores.correctness)}>Correctness: {pct(r.judge_scores.correctness)}</Badge>
                                  <Badge status={scoreColor(r.judge_scores.tool_accuracy)}>Tool Accuracy: {pct(r.judge_scores.tool_accuracy)}</Badge>
                                  <Badge status={scoreColor(r.judge_scores.response_quality)}>Quality: {pct(r.judge_scores.response_quality)}</Badge>
                                </Row>
                              )}

                              {resultTools.length > 0 && (
                                <Row gap={4} style={{ marginBottom: 4 }}>
                                  <MetaText>Tools:</MetaText>
                                  {resultTools.map((t, i) => <Badge key={i} status="info">{t.name}</Badge>)}
                                </Row>
                              )}

                              {failureReasons.length > 0 && (
                                <div style={{ color: "var(--red)", fontSize: 13 }}>
                                  {failureReasons.map((f, i) => <div key={i}>- {f}</div>)}
                                </div>
                              )}

                              {r.judge_scores?.reasoning && (
                                <MetaText style={{ display: "block", marginTop: 4 }}>Judge: {r.judge_scores.reasoning}</MetaText>
                              )}

                              {/* Per-turn results accordion for multi-turn tests */}
                              {turnResults.length > 0 && (
                                <details style={{ marginTop: 8 }}>
                                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                                    Per-Turn Results ({turnResults.length} turns)
                                  </summary>
                                  <Stack gap={6} style={{ marginTop: 6 }}>
                                    {turnResults.map((tr, index) => {
                                      const turnTools = Array.isArray(tr.actual_tools) ? tr.actual_tools : [];
                                      const turnDetails = Array.isArray(tr.rule_checks?.details) ? tr.rule_checks.details : [];
                                      const turnContent = typeof tr.actual_content === "string" ? tr.actual_content : String(tr.actual_content ?? "");
                                      return (
                                        <div key={tr.turn_index ?? index} style={{ padding: 8, background: "var(--bg-secondary)", borderRadius: 6, fontSize: 13 }}>
                                          <Row gap={6} style={{ marginBottom: 4 }}>
                                            <Badge status={tr.rule_checks?.tools_ok !== false && tr.rule_checks?.patterns_ok !== false ? "success" : "error"}>
                                              Turn {tr.turn_index + 1}
                                            </Badge>
                                            <MetaText>{tr.latency_ms}ms</MetaText>
                                            {tr.model && <MetaText>{tr.model}</MetaText>}
                                          </Row>
                                          {tr.judge_scores && (
                                            <Row gap={6} style={{ marginBottom: 4 }}>
                                              <Badge status={scoreColor(tr.judge_scores.correctness)}>C: {pct(tr.judge_scores.correctness)}</Badge>
                                              <Badge status={scoreColor(tr.judge_scores.tool_accuracy)}>T: {pct(tr.judge_scores.tool_accuracy)}</Badge>
                                              <Badge status={scoreColor(tr.judge_scores.response_quality)}>Q: {pct(tr.judge_scores.response_quality)}</Badge>
                                            </Row>
                                          )}
                                          {turnTools.length > 0 && (
                                            <Row gap={4} style={{ marginBottom: 4 }}>
                                              {turnTools.map((t, i) => <Badge key={i} status="info">{t.name}</Badge>)}
                                            </Row>
                                          )}
                                          {turnDetails.length > 0 && (
                                            <div style={{ color: "var(--red)", fontSize: 12 }}>
                                              {turnDetails.map((d, i) => <div key={i}>- {d}</div>)}
                                            </div>
                                          )}
                                          <MetaText style={{ display: "block", marginTop: 2 }}>{turnContent.slice(0, 300)}{turnContent.length > 300 ? "..." : ""}</MetaText>
                                        </div>
                                      );
                                    })}
                                  </Stack>
                                </details>
                              )}

                              {r.flow_reasoning && (
                                <MetaText style={{ display: "block", marginTop: 4 }}>Flow: {r.flow_reasoning}</MetaText>
                              )}

                              {actualContent && turnResults.length === 0 && (
                                <details style={{ marginTop: 6 }}>
                                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>Response preview</summary>
                                  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", marginTop: 4, padding: 8, background: "var(--bg-secondary)", borderRadius: 6 }}>
                                    {actualContent.slice(0, 1000)}
                                  </pre>
                                </details>
                              )}
                            </Card>
                          );
                        })}
                      </Stack>
                    </Card>
                  )}
                </Stack>
              ),
            },
            {
              label: "Issues",
              value: "issues",
              content: (
                <Stack gap={12}>
                  <FilterGroup
                    options={["open", "investigating", "autodev_assigned", "fixed", "closed", "all"]}
                    value={issueFilter}
                    onChange={setIssueFilter}
                  />
                  <UnifiedList<Issue>
                    items={filteredIssues}
                    columns={issueColumns}
                    rowKey={(i) => i.id}
                    onRowClick={(i) => setSelectedIssue(i)}
                    emptyMessage="No issues — everything looks good!"
                    defaultSort={{ key: "date", direction: "desc" }}
                  />
                </Stack>
              ),
            },
            {
              label: "Soul Governance",
              value: "soul-governance",
              content: (
                <Stack gap={12}>
                  {soulSummary && (
                    <Row gap={12} style={{ flexWrap: "wrap" }}>
                      <Card style={{ flex: 1, minWidth: 160, textAlign: "center" }}>
                        <MetaText>Active Canaries</MetaText>
                        <div style={{ fontSize: 24, fontWeight: 700 }}>{soulSummary.active}</div>
                      </Card>
                      <Card style={{ flex: 1, minWidth: 160, textAlign: "center" }}>
                        <MetaText>Overdue Canaries</MetaText>
                        <div style={{ fontSize: 24, fontWeight: 700, color: soulSummary.overdueActive > 0 ? "var(--orange)" : "var(--green)" }}>
                          {soulSummary.overdueActive}
                        </div>
                      </Card>
                      <Card style={{ flex: 1, minWidth: 160, textAlign: "center" }}>
                        <MetaText>Open Soul Issues</MetaText>
                        <div style={{ fontSize: 24, fontWeight: 700, color: soulSummary.openSoulIssues > 0 ? "var(--red)" : "var(--green)" }}>
                          {soulSummary.openSoulIssues}
                        </div>
                      </Card>
                      <Card style={{ flex: 1, minWidth: 200, textAlign: "center" }}>
                        <MetaText>Coverage</MetaText>
                        <div style={{ fontSize: 14, marginTop: 4 }}>
                          Soul {(soulSummary.coverage.soulCoverageRate * 100).toFixed(0)}%
                          {" · "}
                          QA {(soulSummary.coverage.qaCoverageRate * 100).toFixed(0)}%
                        </div>
                        <MetaText>
                          {soulSummary.coverage.soulCoverage}/{soulSummary.coverage.totalAgents} agents with soul versions
                        </MetaText>
                      </Card>
                    </Row>
                  )}

                  <Row gap={8}>
                    <Button variant="primary" onClick={evaluateAllSoulRolloutsNow} disabled={soulBusy}>
                      {soulBusy ? "Evaluating all..." : "Evaluate Active Rollouts"}
                    </Button>
                    <Button variant="ghost" onClick={loadSoulGovernance} disabled={soulBusy}>
                      Refresh
                    </Button>
                    {soulSummary && (
                      <MetaText>Policy v{soulSummary.policyVersion} · updated {timeAgo(soulSummary.generatedAt)}</MetaText>
                    )}
                  </Row>

                  <UnifiedList<SoulRollout>
                    items={filteredSoulRollouts}
                    columns={soulRolloutColumns}
                    rowKey={(r) => r.id}
                    emptyMessage="No soul rollouts found."
                    defaultSort={{ key: "started", direction: "desc" }}
                  />
                </Stack>
              ),
            },
            {
              label: "Insights",
              value: "insights",
              content: (
                <Stack gap={16}>
                  {runs.length === 0 && <EmptyState message="Insights will appear after running test suites." />}
                  {runs.length > 0 && (
                    <>
                      <Card>
                        <Stack gap={8}>
                          <strong>Recent Run Summary</strong>
                          {runs.slice(0, 10).map((r) => (
                            <Row key={r.id} gap={8}>
                              <MetaText style={{ width: 100 }}>{timeAgo(r.started_at)}</MetaText>
                              <div style={{ flex: 1 }}>{r.suite_name}</div>
                              {statusBadge(r.status)}
                              <span style={{ color: "var(--green)" }}>{r.passed}P</span>
                              <span style={{ color: "var(--red)" }}>{r.failed}F</span>
                              <MetaText>${r.total_cost_usd.toFixed(3)}</MetaText>
                            </Row>
                          ))}
                        </Stack>
                      </Card>
                      <Card>
                        <Stack gap={8}>
                          <strong>Top Failing Cases</strong>
                          <MetaText>Based on recent runs — investigate these first</MetaText>
                          <MetaText>Run test suites to see failure patterns here.</MetaText>
                        </Stack>
                      </Card>
                    </>
                  )}
                </Stack>
              ),
            },
          ]}
        />
      </PageBody>

      <Modal
        open={Boolean(selectedIssue)}
        onClose={() => setSelectedIssue(null)}
        title={selectedIssue ? `Issue: ${selectedIssue.title}` : "Issue"}
        width={760}
      >
        {selectedIssue && (
          <Stack gap={12}>
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              {statusBadge(selectedIssue.severity)}
              {statusBadge(selectedIssue.status)}
              <Badge status="muted">{selectedIssue.category}</Badge>
              {selectedIssue.autodev_task_id ? <Badge status="accent">assigned</Badge> : null}
            </Row>

            <Card>
              <Stack gap={6}>
                <strong>Description</strong>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                  {selectedIssue.description || "No description"}
                </div>
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <MetaText>ID: {selectedIssue.id}</MetaText>
                <MetaText>Created: {new Date(selectedIssue.created_at).toLocaleString()}</MetaText>
                <MetaText>Updated: {new Date(selectedIssue.updated_at).toLocaleString()}</MetaText>
                {selectedIssue.autodev_task_id && (
                  <Row gap={8}>
                    <MetaText>AutoDev Task: {selectedIssue.autodev_task_id}</MetaText>
                    <Button size="sm" variant="ghost" onClick={() => openTaskInThings(selectedIssue.autodev_task_id!)}>Open</Button>
                  </Row>
                )}
              </Stack>
            </Card>

            {selectedIssue.evidence ? (
              <Card>
                <Stack gap={6}>
                  <strong>Evidence</strong>
                  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto", margin: 0, padding: 10, background: "var(--bg-secondary)", borderRadius: 6 }}>
                    {formatIssueEvidence(selectedIssue.evidence).slice(0, 14000)}
                  </pre>
                </Stack>
              </Card>
            ) : null}

            <Row gap={8}>
              {!selectedIssue.autodev_task_id && selectedIssue.status !== "autodev_assigned" ? (
                <Button variant="primary" onClick={() => pushIssueToAutodev(selectedIssue.id)}>Push to AutoDev</Button>
              ) : (
                <Button variant="ghost" disabled>Already assigned</Button>
              )}
              <Button onClick={() => setSelectedIssue(null)}>Close</Button>
            </Row>
          </Stack>
        )}
      </Modal>

      {/* ─── Create / Edit Suite Modal ─── */}
      <Modal open={showSuiteModal} onClose={() => setShowSuiteModal(false)} title={editingSuiteId ? "Edit Test Suite" : "New Test Suite"} width={520}>
        <FormGrid>
          <FormField label="Name">
            <input type="text" value={suiteForm.name} onChange={(e) => setSuiteForm({ ...suiteForm, name: e.target.value })} placeholder="e.g. Memory System" />
          </FormField>
          <FormField label="Agent ID">
            <input type="text" value={suiteForm.agent_id} onChange={(e) => setSuiteForm({ ...suiteForm, agent_id: e.target.value })} placeholder="personal" />
          </FormField>
          <FormField label="Description" span>
            <textarea value={suiteForm.description} onChange={(e) => setSuiteForm({ ...suiteForm, description: e.target.value })} placeholder="What does this suite test?" rows={5} />
          </FormField>
          <FormField label="Tags" hint="Comma-separated">
            <input type="text" value={suiteForm.tags} onChange={(e) => setSuiteForm({ ...suiteForm, tags: e.target.value })} placeholder="memory, core, smoke-test" />
          </FormField>
          <div className="form-actions">
            <Button variant="primary" onClick={saveSuite} disabled={!suiteForm.name}>{editingSuiteId ? "Save" : "Create Suite"}</Button>
            <Button onClick={() => setShowSuiteModal(false)}>Cancel</Button>
          </div>
        </FormGrid>
      </Modal>

      {/* ─── Create / Edit Case Modal ─── */}
      <Modal open={showCaseModal} onClose={() => setShowCaseModal(false)} title={editingCaseId ? "Edit Test Case" : "New Test Case"} width={600}>
        <FormGrid>
          <FormField label="Case Name">
            <input type="text" value={caseForm.name} onChange={(e) => setCaseForm({ ...caseForm, name: e.target.value })} placeholder="e.g. Identity recall — family" />
          </FormField>
          <FormField label="Min Quality Score" hint="0.0 – 1.0">
            <input type="number" step="0.1" min="0" max="1" value={caseForm.min_quality_score} onChange={(e) => setCaseForm({ ...caseForm, min_quality_score: e.target.value })} />
          </FormField>
          <FormField label="Input Message" span hint="The message sent to the agent">
            <textarea value={caseForm.input_message} onChange={(e) => setCaseForm({ ...caseForm, input_message: e.target.value })} placeholder='e.g. "who is my son?"' rows={2} />
          </FormField>
          <FormField label="Expected Tools" hint="Comma-separated tool names">
            <input type="text" value={caseForm.expected_tools} onChange={(e) => setCaseForm({ ...caseForm, expected_tools: e.target.value })} placeholder="memory_search, tasks_list" />
          </FormField>
          <FormField label="Unexpected Tools" hint="Tools that should NOT be called">
            <input type="text" value={caseForm.unexpected_tools} onChange={(e) => setCaseForm({ ...caseForm, unexpected_tools: e.target.value })} placeholder="gmail_search, channel_send" />
          </FormField>
          <FormField label="Content Patterns" hint="Regex patterns to match in response">
            <input type="text" value={caseForm.expected_content_patterns} onChange={(e) => setCaseForm({ ...caseForm, expected_content_patterns: e.target.value })} placeholder="Moritz, son" />
          </FormField>
          <FormField label="Max Latency (ms)" hint="Leave empty for no limit">
            <input type="number" value={caseForm.max_latency_ms} onChange={(e) => setCaseForm({ ...caseForm, max_latency_ms: e.target.value })} placeholder="8000" />
          </FormField>
          <div className="form-actions">
            <Button variant="primary" onClick={saveCase} disabled={!caseForm.name || !caseForm.input_message}>{editingCaseId ? "Save" : "Create Case"}</Button>
            <Button onClick={() => setShowCaseModal(false)}>Cancel</Button>
          </div>
        </FormGrid>
      </Modal>
    </>
  );
}
