import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

import {
  Card,
  CardGrid,
  DataTable,
  EmptyState,
  MetaText,
  PageBody,
  PageHeader,
  Row,
  SectionLabel,
  StatusDot,
} from "../components/ui";
import JoiOrb from "../components/JoiOrb";

interface DashboardData {
  generatedAt: string;
  owner: string;
  vision: string;
  horizons: Record<string, string>;
  summaryCards: Array<{ label: string; value: string | number; tone?: string }>;
  goalSummary: { activeCount: number; doneCount: number; averageProgress: number };
  goalRows: Array<{
    areaName: string;
    title: string;
    progress: number;
    metric?: string;
    target?: string;
    nextAction?: string;
  }>;
  finance: {
    year: number;
    currency: string;
    incomeCoreYear: number;
    expenseCoreYear: number;
    netCoreYear: number;
    cashReserve: number;
    verrechnungDebt: number;
  };
}

interface SystemStatus {
  status: string;
  database: string;
  ollama?: { available: boolean; modelLoaded: boolean };
  hasAnthropicKey: boolean;
  hasOpenRouterKey: boolean;
  uptime: number;
}

interface MemoryStat {
  area: string;
  count: number;
}

interface UsageSummary {
  all: { total_calls: number; total_tokens: string; total_cost: number; avg_latency_ms: number };
  today: { calls: number; tokens: string; cost: number };
}

interface DailyUsage {
  day: string;
  provider: string;
  calls: number;
  total_tokens: string;
  cost: number;
}

interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  total_tokens: string;
  cost: number;
  avg_latency_ms: number;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d97706",
  openrouter: "#6366f1",
  ollama: "#22c55e",
};

const MODEL_TABLE_COLUMNS = [
  {
    key: "provider",
    header: "Provider",
    render: (m: ModelUsage) => (
      <Row gap={1} className="inline-block">
        <StatusDot status="ok" style={{ background: PROVIDER_COLORS[m.provider] || "#888" }} />
        {m.provider}
      </Row>
    ),
  },
  {
    key: "model",
    header: "Model",
    render: (m: ModelUsage) => (
      <span className="font-mono text-sm">{m.model}</span>
    ),
  },
  {
    key: "calls",
    header: "Calls",
    align: "right" as const,
    render: (m: ModelUsage) => m.calls.toLocaleString(),
  },
  {
    key: "tokens",
    header: "Tokens",
    align: "right" as const,
    render: (m: ModelUsage) => Number(m.total_tokens).toLocaleString(),
  },
  {
    key: "cost",
    header: "Cost",
    align: "right" as const,
    render: (m: ModelUsage) => (
      <span className={m.cost > 0 ? "text-warning" : "text-success"}>
        {m.cost > 0 ? `$${m.cost.toFixed(4)}` : "Free"}
      </span>
    ),
  },
  {
    key: "latency",
    header: "Avg Latency",
    align: "right" as const,
    render: (m: ModelUsage) =>
      m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)}s` : "\u2014",
  },
];

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [memStats, setMemStats] = useState<MemoryStat[]>([]);
  const [cronCount, setCronCount] = useState(0);
  const [docCount, setDocCount] = useState(0);
  const [contactStats, setContactStats] = useState<{ contacts: number; companies: number } | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);

  useEffect(() => {
    fetch("/api/dashboard").then((r) => r.json()).then(setData).catch(() => {});
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetch("/api/memories/stats").then((r) => r.json()).then((d) => setMemStats(d.stats || [])).catch(() => {});
    fetch("/api/cron").then((r) => r.json()).then((d) => setCronCount((d.jobs || []).length)).catch(() => {});
    fetch("/api/documents").then((r) => r.json()).then((d) => setDocCount((d.documents || []).length)).catch(() => {});
    fetch("/api/contacts/stats").then((r) => r.json()).then(setContactStats).catch(() => {});
    fetch("/api/stats/usage/summary").then((r) => r.json()).then(setUsageSummary).catch(() => {});
    fetch("/api/stats/usage/daily?days=30").then((r) => r.json()).then((d) => setDailyUsage(d.daily || [])).catch(() => {});
    fetch("/api/stats/usage/by-model").then((r) => r.json()).then((d) => setModelUsage(d.models || [])).catch(() => {});
  }, []);

  const totalMemories = memStats.reduce((sum, s) => sum + s.count, 0);
  const uptimeStr = status ? formatUptime(status.uptime) : "\u2014";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={data && <>{data.owner} &middot; {data.vision}</>}
        actions={
          <JoiOrb
            className="dashboard-avatar"
            size={36}
            active
            intensity={0.2}
            variant="transparent"
            rings={2}
            animated={false}
            ariaLabel="JOI"
          />
        }
      />

      <PageBody>
        <SectionLabel>system status</SectionLabel>
        <div className="dashboard-grid mb-6">
          <div className="stat-card ocean">
            <div className="label">Gateway</div>
            <div className="value">{status?.status === "ok" ? "Online" : "Offline"}</div>
            <MetaText size="xs" className="mt-1">Uptime: {uptimeStr}</MetaText>
          </div>
          <div className="stat-card ocean">
            <div className="label">Database</div>
            <div className="value">{status?.database === "connected" ? "Connected" : "Down"}</div>
          </div>
          <div className="stat-card ocean">
            <div className="label">Ollama</div>
            <div className="value">{status?.ollama?.available ? "Running" : "Offline"}</div>
            <MetaText size="xs" className="mt-1">
              {status?.ollama?.modelLoaded ? "Model loaded" : "No model"}
            </MetaText>
          </div>
          <div className="stat-card ocean">
            <div className="label">API Keys</div>
            <div className="value text-lg">
              {[
                status?.hasAnthropicKey && "Anthropic",
                status?.hasOpenRouterKey && "OpenRouter",
              ].filter(Boolean).join(", ") || "None"}
            </div>
          </div>
          <div className="stat-card ocean">
            <div className="label">Memories</div>
            <div className="value">{totalMemories}</div>
            <MetaText size="xs" className="mt-1">
              {memStats.map((s) => `${s.area}: ${s.count}`).join(", ") || "Empty"}
            </MetaText>
          </div>
          <div className="stat-card ocean">
            <div className="label">Documents</div>
            <div className="value">{docCount}</div>
          </div>
          <div className="stat-card ocean">
            <div className="label">Cron Jobs</div>
            <div className="value">{cronCount}</div>
          </div>
          <div className="stat-card ocean">
            <div className="label">Contacts</div>
            <div className="value">{contactStats?.contacts?.toLocaleString() ?? "\u2014"}</div>
            <MetaText size="xs" className="mt-1">
              {contactStats?.companies ? `${contactStats.companies} companies` : ""}
            </MetaText>
          </div>
        </div>

        <SectionLabel>usage statistics</SectionLabel>
        <div className="dashboard-grid mb-4">
          <div className="stat-card">
            <div className="label">Total Calls</div>
            <div className="value">{usageSummary?.all.total_calls?.toLocaleString() ?? "\u2014"}</div>
            <MetaText size="xs" className="mt-1">
              Today: {usageSummary?.today.calls?.toLocaleString() ?? 0}
            </MetaText>
          </div>
          <div className="stat-card">
            <div className="label">Total Tokens</div>
            <div className="value">{Number(usageSummary?.all.total_tokens ?? 0).toLocaleString()}</div>
            <MetaText size="xs" className="mt-1">
              Today: {Number(usageSummary?.today.tokens ?? 0).toLocaleString()}
            </MetaText>
          </div>
          <div className="stat-card">
            <div className="label">Total Cost</div>
            <div className="value">${(usageSummary?.all.total_cost ?? 0).toFixed(4)}</div>
            <MetaText size="xs" className="mt-1">
              Today: ${(usageSummary?.today.cost ?? 0).toFixed(4)}
            </MetaText>
          </div>
          <div className="stat-card">
            <div className="label">Avg Latency</div>
            <div className="value">{usageSummary?.all.avg_latency_ms ? `${(usageSummary.all.avg_latency_ms / 1000).toFixed(1)}s` : "\u2014"}</div>
          </div>
        </div>

        {dailyUsage.length > 0 && (
          <div className="dashboard-chart-grid mb-6">
            <Card className="dashboard-chart-card">
              <SectionLabel className="mb-3">daily token usage (30d)</SectionLabel>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={aggregateDailyByProvider(dailyUsage)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => new Date(v).toLocaleDateString("de-AT", { day: "numeric", month: "short" })} />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip contentStyle={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontSize: "var(--text-base)" }} labelFormatter={(v) => new Date(v).toLocaleDateString("de-AT")} formatter={(v) => [Number(v ?? 0).toLocaleString(), "tokens"]} />
                  <Area type="monotone" dataKey="anthropic" stackId="1" fill="#d97706" stroke="#d97706" fillOpacity={0.4} />
                  <Area type="monotone" dataKey="openrouter" stackId="1" fill="#6366f1" stroke="#6366f1" fillOpacity={0.4} />
                  <Area type="monotone" dataKey="ollama" stackId="1" fill="#22c55e" stroke="#22c55e" fillOpacity={0.4} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card className="dashboard-chart-card">
              <SectionLabel className="mb-3">cost by provider</SectionLabel>
              {modelUsage.length > 0 ? (
                <Row gap={6}>
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie
                        data={aggregateByProvider(modelUsage)}
                        dataKey="tokens"
                        nameKey="provider"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                      >
                        {aggregateByProvider(modelUsage).map((entry) => (
                          <Cell key={entry.provider} fill={PROVIDER_COLORS[entry.provider] || "#888"} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontSize: "var(--text-base)" }} formatter={(v) => [Number(v ?? 0).toLocaleString(), "tokens"]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1">
                    {aggregateByProvider(modelUsage).map((p) => (
                      <div key={p.provider} className="dashboard-provider-row">
                        <Row gap={2}>
                          <StatusDot status="ok" style={{ background: PROVIDER_COLORS[p.provider] || "#888" }} />
                          <span className="uppercase">{p.provider}</span>
                        </Row>
                        <div className="text-right">
                          <div>{Number(p.tokens).toLocaleString()} tok</div>
                          <MetaText size="xs" className={p.cost > 0 ? "text-warning" : "text-success"}>
                            {p.cost > 0 ? `$${p.cost.toFixed(4)}` : "Free"}
                          </MetaText>
                        </div>
                      </div>
                    ))}
                  </div>
                </Row>
              ) : (
                <EmptyState message="No usage data yet" />
              )}
            </Card>
          </div>
        )}

        {modelUsage.length > 0 && (
          <Card className="mb-6 dashboard-chart-card">
            <SectionLabel className="mb-3">usage by model</SectionLabel>
            <DataTable<ModelUsage>
              columns={MODEL_TABLE_COLUMNS}
              data={modelUsage}
              rowKey={(m) => `${m.provider}-${m.model}`}
              emptyMessage="No model usage data"
            />
          </Card>
        )}

        {data && (
          <>
            <Row gap={2} className="mb-5 flex-wrap">
              {Object.entries(data.horizons || {}).map(([key, value]) => (
                <span key={key} className="dashboard-horizon-badge">
                  {key}: {value}
                </span>
              ))}
            </Row>

            <div className="dashboard-grid">
              {(data.summaryCards || []).map((card, i) => (
                <div key={i} className={`stat-card ${card.tone || "ocean"}`}>
                  <div className="label">{card.label}</div>
                  <div className="value">{card.value}</div>
                </div>
              ))}
            </div>

            <SectionLabel className="mb-3">
              quarter objectives
              <span className="dashboard-section-meta">
                {data.goalSummary?.activeCount} active, avg {data.goalSummary?.averageProgress}%
              </span>
            </SectionLabel>

            {(data.goalRows || []).map((goal, i) => (
              <div key={i} className="goal-row">
                <div className="head">
                  <div>
                    <p className="area">{goal.areaName}</p>
                    <p className="title">{goal.title}</p>
                  </div>
                  <strong className="text-accent">
                    {Number(goal.progress).toFixed(1)}%
                  </strong>
                </div>
                <p className="sub">
                  Metric: {goal.metric || "n/a"} | Target: {goal.target || "n/a"}
                </p>
                <div className="bar">
                  <span style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }} />
                </div>
                {goal.nextAction && <p className="next">Next: {goal.nextAction}</p>}
              </div>
            ))}

            {data.finance && (
              <>
                <SectionLabel className="mt-6 mb-3">
                  finance pulse
                </SectionLabel>
                <CardGrid>
                  {([
                    ["Core Income", fmt(data.finance.incomeCoreYear, data.finance.currency)],
                    ["Core Expense", fmt(data.finance.expenseCoreYear, data.finance.currency)],
                    ["Core Net", fmt(data.finance.netCoreYear, data.finance.currency)],
                    ["Cash Reserve", fmt(data.finance.cashReserve, data.finance.currency)],
                  ] as const).map(([label, value], i) => (
                    <Card key={i}>
                      <MetaText size="sm">{label}</MetaText>
                      <div className="dashboard-finance-value">{value}</div>
                    </Card>
                  ))}
                </CardGrid>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

function aggregateDailyByProvider(daily: DailyUsage[]): Array<Record<string, number | string>> {
  const byDay = new Map<string, Record<string, number | string>>();
  for (const row of daily) {
    if (!byDay.has(row.day)) {
      byDay.set(row.day, { day: row.day, anthropic: 0, openrouter: 0, ollama: 0 });
    }
    const entry = byDay.get(row.day)!;
    entry[row.provider] = Number(entry[row.provider] || 0) + Number(row.total_tokens);
  }
  return Array.from(byDay.values());
}

function aggregateByProvider(models: ModelUsage[]): Array<{ provider: string; tokens: number; cost: number; calls: number }> {
  const byProvider = new Map<string, { provider: string; tokens: number; cost: number; calls: number }>();
  for (const m of models) {
    if (!byProvider.has(m.provider)) {
      byProvider.set(m.provider, { provider: m.provider, tokens: 0, cost: 0, calls: 0 });
    }
    const entry = byProvider.get(m.provider)!;
    entry.tokens += Number(m.total_tokens);
    entry.cost += m.cost;
    entry.calls += m.calls;
  }
  return Array.from(byProvider.values());
}

function fmt(value: number, currency: string): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.round(seconds / 86400)}d ${Math.round((seconds % 86400) / 3600)}h`;
}
