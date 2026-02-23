import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterGroup,
  MetaText,
  PageBody,
  PageHeader,
  Row,
  SearchInput,
  Stack,
  Tabs,
  UnifiedList,
  type UnifiedListColumn,
} from "../components/ui";

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

interface TestCase {
  id: string;
  suite_id: string;
  name: string;
  input_message: string;
  expected_tools: string[];
  unexpected_tools: string[];
  expected_content_patterns: string[];
  max_latency_ms: number | null;
  min_quality_score: number;
  enabled: boolean;
}

interface TestRun {
  id: string;
  suite_id: string;
  suite_name: string;
  status: string;
  triggered_by: string;
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

interface WsHandle {
  status: string;
  on: (type: string, handler: (frame: { data?: unknown }) => void) => () => void;
}

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
  return n !== null ? `${(n * 100).toFixed(0)}%` : "—";
}

// ─── Component ───

export default function QualityCenter({ ws }: { ws?: WsHandle }) {
  const [tab, setTab] = useState("suites");
  const [suites, setSuites] = useState<Suite[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedRun, setSelectedRun] = useState<(TestRun & { results: TestResult[] }) | null>(null);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [issueFilter, setIssueFilter] = useState<string>("open");
  const [search, setSearch] = useState("");

  // ─── Data Loading ───

  const loadSuites = useCallback(async () => {
    const res = await fetch("/api/quality/suites");
    if (res.ok) setSuites(await res.json());
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

  const loadAll = useCallback(() => {
    loadSuites();
    loadRuns();
    loadIssues();
    loadStats();
  }, [loadSuites, loadRuns, loadIssues, loadStats]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Reload issues when filter changes
  useEffect(() => { loadIssues(); }, [loadIssues]);

  // ─── WebSocket — Live Updates ───

  useEffect(() => {
    if (!ws) return;
    const unsubs = [
      ws.on("qa.run_started", () => { loadRuns(); loadStats(); }),
      ws.on("qa.case_result", () => {
        if (selectedRun) loadRunDetail(selectedRun.id);
      }),
      ws.on("qa.run_completed", () => {
        loadRuns();
        loadStats();
        loadSuites();
        setRunningIds(new Set());
      }),
      ws.on("qa.issue_created", () => { loadIssues(); loadStats(); }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [ws, selectedRun, loadRuns, loadStats, loadSuites, loadIssues]);

  // ─── Actions ───

  const runSuite = async (suiteId: string) => {
    setRunningIds((prev) => new Set([...prev, suiteId]));
    await fetch(`/api/quality/suites/${suiteId}/run`, { method: "POST" });
    loadRuns();
  };

  const loadRunDetail = async (runId: string) => {
    const res = await fetch(`/api/quality/runs/${runId}`);
    if (res.ok) setSelectedRun(await res.json());
  };

  const loadSuiteDetail = async (suiteId: string) => {
    if (expandedSuite === suiteId) { setExpandedSuite(null); return; }
    const res = await fetch(`/api/quality/suites/${suiteId}`);
    if (res.ok) {
      const data = await res.json();
      setSuites((prev) => prev.map((s) => s.id === suiteId ? { ...s, cases: data.cases } : s));
      setExpandedSuite(suiteId);
    }
  };

  const pushIssueToAutodev = async (issueId: string) => {
    await fetch(`/api/quality/issues/${issueId}/autodev`, { method: "POST" });
    loadIssues();
  };

  // ─── Filtered Data ───

  const filteredSuites = useMemo(() => {
    if (!search) return suites;
    const q = search.toLowerCase();
    return suites.filter((s) =>
      s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [suites, search]);

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

  // ─── Column Definitions ───

  const suiteColumns: UnifiedListColumn<Suite>[] = [
    { key: "name", header: "Suite", render: (s) => <strong>{s.name}</strong>, sortValue: (s) => s.name },
    { key: "agent", header: "Agent", render: (s) => <MetaText>{s.agent_id}</MetaText>, width: 120 },
    { key: "cases", header: "Cases", render: (s) => s.case_count, width: 70, align: "center", sortValue: (s) => s.case_count },
    { key: "tags", header: "Tags", render: (s) => <Row gap={4}>{s.tags.map((t) => <Badge key={t} status="muted">{t}</Badge>)}</Row>, width: 200 },
    {
      key: "last_run", header: "Last Run", width: 150,
      render: (s) => s.last_run_at ? <Row gap={6}>{statusBadge(s.last_run_status || "—")}<MetaText>{timeAgo(s.last_run_at)}</MetaText></Row> : <MetaText>never</MetaText>,
      sortValue: (s) => s.last_run_at || "",
    },
    {
      key: "actions", header: "", width: 100, align: "right",
      render: (s) => (
        <Button
          size="sm"
          variant={runningIds.has(s.id) ? "ghost" : "primary"}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); runSuite(s.id); }}
          disabled={runningIds.has(s.id)}
        >
          {runningIds.has(s.id) ? "Running..." : "Run Now"}
        </Button>
      ),
    },
  ];

  const runColumns: UnifiedListColumn<TestRun>[] = [
    {
      key: "suite", header: "Suite", render: (r) => <strong>{r.suite_name}</strong>,
      sortValue: (r) => r.suite_name,
    },
    { key: "status", header: "Status", width: 100, render: (r) => statusBadge(r.status) },
    { key: "triggered", header: "Trigger", width: 80, render: (r) => <MetaText>{r.triggered_by}</MetaText> },
    {
      key: "results", header: "Pass/Fail", width: 120,
      render: (r) => (
        <Row gap={6}>
          <span style={{ color: "var(--green)" }}>{r.passed}</span>
          <span>/</span>
          <span style={{ color: r.failed > 0 ? "var(--red)" : "inherit" }}>{r.failed}</span>
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
    {
      key: "cost", header: "Cost", width: 80, align: "right",
      render: (r) => <MetaText>${r.total_cost_usd.toFixed(3)}</MetaText>,
      sortValue: (r) => r.total_cost_usd,
    },
    {
      key: "date", header: "Date", width: 100,
      render: (r) => <MetaText>{timeAgo(r.started_at)}</MetaText>,
      sortValue: (r) => r.started_at,
    },
  ];

  const issueColumns: UnifiedListColumn<Issue>[] = [
    { key: "title", header: "Title", render: (i) => <strong>{i.title}</strong>, sortValue: (i) => i.title },
    { key: "severity", header: "Severity", width: 90, render: (i) => statusBadge(i.severity) },
    { key: "category", header: "Category", width: 100, render: (i) => <Badge status="muted">{i.category}</Badge> },
    { key: "status", header: "Status", width: 120, render: (i) => statusBadge(i.status) },
    {
      key: "autodev", header: "AutoDev", width: 100,
      render: (i) => i.autodev_task_id
        ? <Badge status="accent">assigned</Badge>
        : <Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => { e.stopPropagation(); pushIssueToAutodev(i.id); }}>Push</Button>,
    },
    {
      key: "date", header: "Created", width: 100,
      render: (i) => <MetaText>{timeAgo(i.created_at)}</MetaText>,
      sortValue: (i) => i.created_at,
    },
  ];

  // ─── Render ───

  return (
    <>
      <PageHeader
        title="Quality Center"
        subtitle={stats ? `${stats.total_suites} suites, ${stats.total_cases} cases, ${stats.total_runs} runs` : undefined}
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search..." />}
      />
      <PageBody>
        {/* Stats Cards */}
        {stats && (
          <Row gap={12} style={{ flexWrap: "wrap" }}>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Pass Rate</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700, color: stats.pass_rate !== null && stats.pass_rate >= 0.7 ? "var(--green)" : "var(--red)" }}>
                {stats.pass_rate !== null ? `${(stats.pass_rate * 100).toFixed(0)}%` : "—"}
              </div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Open Issues</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.open_issues}</div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Critical</MetaText>
              <div style={{ fontSize: 24, fontWeight: 700, color: stats.critical_issues > 0 ? "var(--red)" : "var(--green)" }}>
                {stats.critical_issues}
              </div>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, textAlign: "center" }}>
              <MetaText>Last Run</MetaText>
              <div style={{ fontSize: 14 }}>
                {stats.last_run ? statusBadge(stats.last_run.status) : "—"}
              </div>
              {stats.last_run && <MetaText>{timeAgo(stats.last_run.started_at)}</MetaText>}
            </Card>
          </Row>
        )}

        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
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
                    emptyMessage="No test suites yet"
                    defaultSort={{ key: "name" }}
                  />

                  {expandedSuite && (() => {
                    const suite = suites.find((s) => s.id === expandedSuite);
                    if (!suite?.cases) return null;
                    return (
                      <Card style={{ marginTop: 8 }}>
                        <Stack gap={8}>
                          <strong>{suite.name} — Test Cases</strong>
                          {suite.cases.map((c) => (
                            <Row key={c.id} gap={8} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                              <div style={{ flex: 1 }}>
                                <strong>{c.name}</strong>
                                <MetaText> — "{c.input_message}"</MetaText>
                              </div>
                              {c.expected_tools.length > 0 && (
                                <Row gap={4}>
                                  {c.expected_tools.map((t) => <Badge key={t} status="info">{t}</Badge>)}
                                </Row>
                              )}
                              {c.max_latency_ms && <MetaText>&lt;{c.max_latency_ms}ms</MetaText>}
                              <Badge status={c.enabled ? "success" : "muted"}>{c.enabled ? "on" : "off"}</Badge>
                            </Row>
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
                        <Row gap={8}>
                          <strong>{selectedRun.suite_name} — Run Detail</strong>
                          {statusBadge(selectedRun.status)}
                          <Button size="sm" variant="ghost" onClick={() => setSelectedRun(null)}>Close</Button>
                        </Row>

                        {selectedRun.results?.map((r) => (
                          <Card key={r.id} style={{ padding: 12 }}>
                            <Row gap={8} style={{ marginBottom: 6 }}>
                              {statusBadge(r.status)}
                              <strong>{r.case_name}</strong>
                              <MetaText>"{r.input_message}"</MetaText>
                              {r.latency_ms && <MetaText>{r.latency_ms}ms</MetaText>}
                              {r.model && <Badge status="muted">{r.model}</Badge>}
                            </Row>

                            {r.judge_scores && (
                              <Row gap={8} style={{ marginBottom: 4 }}>
                                <Badge status={scoreColor(r.judge_scores.correctness)}>
                                  Correctness: {pct(r.judge_scores.correctness)}
                                </Badge>
                                <Badge status={scoreColor(r.judge_scores.tool_accuracy)}>
                                  Tool Accuracy: {pct(r.judge_scores.tool_accuracy)}
                                </Badge>
                                <Badge status={scoreColor(r.judge_scores.response_quality)}>
                                  Quality: {pct(r.judge_scores.response_quality)}
                                </Badge>
                              </Row>
                            )}

                            {r.actual_tools.length > 0 && (
                              <Row gap={4} style={{ marginBottom: 4 }}>
                                <MetaText>Tools:</MetaText>
                                {r.actual_tools.map((t, i) => <Badge key={i} status="info">{t.name}</Badge>)}
                              </Row>
                            )}

                            {r.failure_reasons.length > 0 && (
                              <div style={{ color: "var(--red)", fontSize: 13 }}>
                                {r.failure_reasons.map((f, i) => <div key={i}>- {f}</div>)}
                              </div>
                            )}

                            {r.judge_scores?.reasoning && (
                              <MetaText style={{ display: "block", marginTop: 4 }}>
                                Judge: {r.judge_scores.reasoning}
                              </MetaText>
                            )}

                            {r.actual_content && (
                              <details style={{ marginTop: 6 }}>
                                <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
                                  Response preview
                                </summary>
                                <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", marginTop: 4, padding: 8, background: "var(--bg-secondary)", borderRadius: 6 }}>
                                  {r.actual_content.slice(0, 1000)}
                                </pre>
                              </details>
                            )}
                          </Card>
                        ))}
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
                    emptyMessage="No issues — everything looks good!"
                    defaultSort={{ key: "date", direction: "desc" }}
                  />
                </Stack>
              ),
            },
            {
              label: "Insights",
              value: "insights",
              content: (
                <Stack gap={16}>
                  <EmptyState message="Insights will appear after running test suites. Charts for pass rate over time, model comparison, and cost trends coming soon." />

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
                          {/* This would be populated from a dedicated endpoint; placeholder for now */}
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
    </>
  );
}
