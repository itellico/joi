import { useEffect, useState } from "react";
import { Card, CardGrid, DataTable, SectionLabel } from "../../components/ui";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
} from "recharts";
import {
  PROVIDER_COLORS, TASK_COLORS, CHART_PALETTE,
  tooltipStyle, formatCost, formatTokens, formatDate,
} from "./shared";

interface DailyCost {
  day: string;
  provider: string;
  calls: number;
  cost: number;
  input_tokens: string;
  output_tokens: string;
}

interface TaskCost {
  task: string;
  calls: number;
  cost: number;
  total_tokens: string;
}

interface AgentCost {
  agent_id: string;
  calls: number;
  cost: number;
}

interface CumulativeDay {
  day: string;
  daily_cost: number;
  cumulative_cost: number;
}

interface ModelRow {
  provider: string;
  model: string;
  calls: number;
  input_tokens: string;
  output_tokens: string;
  cost: number;
  avg_latency_ms: number;
}

export default function CostsReport({ days }: { days: number }) {
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [tasks, setTasks] = useState<TaskCost[]>([]);
  const [agents, setAgents] = useState<AgentCost[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeDay[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);

  useEffect(() => {
    fetch(`/api/reports/costs/daily?days=${days}`).then((r) => r.json()).then((d) => setDaily(d.daily || [])).catch(() => {});
    fetch(`/api/reports/costs/by-task?days=${days}`).then((r) => r.json()).then((d) => setTasks(d.tasks || [])).catch(() => {});
    fetch(`/api/reports/costs/by-agent?days=${days}`).then((r) => r.json()).then((d) => setAgents(d.agents || [])).catch(() => {});
    fetch(`/api/reports/costs/cumulative?days=${days}`).then((r) => r.json()).then((d) => setCumulative(d.cumulative || [])).catch(() => {});
    fetch(`/api/reports/costs/models?days=${days}`).then((r) => r.json()).then((d) => setModels(d.models || [])).catch(() => {});
  }, [days]);

  const totalCost = tasks.reduce((s, t) => s + t.cost, 0);
  const totalCalls = tasks.reduce((s, t) => s + t.calls, 0);
  const dailyAvg = cumulative.length > 0 ? totalCost / cumulative.length : 0;
  const costliestModel = models.length > 0 ? models[0] : null;
  const costliestAgent = agents.length > 0 ? agents[0] : null;

  // Pivot daily data by provider for stacked area
  const dailyByProvider = (() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const row of daily) {
      if (!byDay.has(row.day)) byDay.set(row.day, { day: row.day, anthropic: 0, openrouter: 0, ollama: 0 });
      const entry = byDay.get(row.day)!;
      entry[row.provider] = Number(entry[row.provider] || 0) + row.cost;
    }
    return Array.from(byDay.values());
  })();

  return (
    <div className="reports-tab">
      <CardGrid minWidth={200}>
        <Card className="stat-card ocean">
          <div className="label">Total Cost</div>
          <div className="value">{formatCost(totalCost)}</div>
          <div className="label">{totalCalls.toLocaleString()} calls</div>
        </Card>
        <Card className="stat-card mint">
          <div className="label">Daily Average</div>
          <div className="value">{formatCost(dailyAvg)}</div>
          <div className="label">over {cumulative.length} days</div>
        </Card>
        <Card className="stat-card amber">
          <div className="label">Costliest Model</div>
          <div className="value" style={{ fontSize: 16 }}>{costliestModel?.model || "—"}</div>
          <div className="label">{costliestModel ? formatCost(costliestModel.cost) : ""}</div>
        </Card>
        <Card className="stat-card rose">
          <div className="label">Costliest Agent</div>
          <div className="value" style={{ fontSize: 16 }}>{costliestAgent?.agent_id || "—"}</div>
          <div className="label">{costliestAgent ? formatCost(costliestAgent.cost) : ""}</div>
        </Card>
      </CardGrid>

      <div className="reports-chart-grid">
        <Card>
          <SectionLabel>Daily Cost by Provider</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyByProvider}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => formatCost(v)} />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} formatter={(v: any) => [formatCost(Number(v ?? 0)), ""]} />
              <Area type="monotone" dataKey="anthropic" stackId="1" fill="#d97706" stroke="#d97706" fillOpacity={0.4} name="Anthropic" />
              <Area type="monotone" dataKey="openrouter" stackId="1" fill="#6366f1" stroke="#6366f1" fillOpacity={0.4} name="OpenRouter" />
              <Area type="monotone" dataKey="ollama" stackId="1" fill="#22c55e" stroke="#22c55e" fillOpacity={0.4} name="Ollama" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Cumulative Cost</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cumulative}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => formatCost(v)} />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} formatter={(v: any) => [formatCost(Number(v ?? 0)), ""]} />
              <Line type="monotone" dataKey="cumulative_cost" stroke="#a78bfa" strokeWidth={2} dot={false} name="Cumulative" />
              <Line type="monotone" dataKey="daily_cost" stroke="var(--text-muted)" strokeWidth={1} dot={false} name="Daily" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Cost by Task</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={tasks}
                dataKey="cost"
                nameKey="task"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {tasks.map((t) => (
                  <Cell key={t.task} fill={TASK_COLORS[t.task] || CHART_PALETTE[tasks.indexOf(t) % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v: any) => [formatCost(Number(v ?? 0)), "cost"]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Cost by Agent</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agents.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => formatCost(v)} />
              <YAxis type="category" dataKey="agent_id" tick={{ fontSize: 10 }} stroke="var(--text-muted)" width={100} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => [formatCost(Number(v ?? 0)), "cost"]} />
              <Bar dataKey="cost" fill="#60a5fa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionLabel>Model Breakdown</SectionLabel>
        <DataTable<ModelRow>
          columns={[
            { key: "provider", header: "Provider", render: (r) => (
              <span className="flex-row gap-2">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: PROVIDER_COLORS[r.provider] || "#888", display: "inline-block" }} />
                {r.provider}
              </span>
            )},
            { key: "model", header: "Model", render: (r) => <span className="font-mono text-xs">{r.model}</span> },
            { key: "calls", header: "Calls", render: (r) => r.calls.toLocaleString(), align: "right" },
            { key: "input_tokens", header: "Input Tokens", render: (r) => formatTokens(r.input_tokens), align: "right" },
            { key: "output_tokens", header: "Output Tokens", render: (r) => formatTokens(r.output_tokens), align: "right" },
            { key: "cost", header: "Cost", render: (r) => formatCost(r.cost), align: "right" },
            { key: "latency", header: "Avg Latency", render: (r) => `${r.avg_latency_ms}ms`, align: "right" },
          ]}
          data={models}
          rowKey={(r) => `${r.provider}-${r.model}`}
          emptyMessage="No usage data"
        />
      </Card>
    </div>
  );
}
