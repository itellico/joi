import { useEffect, useState } from "react";
import { Card, CardGrid, DataTable, SectionLabel, Badge } from "../../components/ui";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { STATUS_COLORS, tooltipStyle, formatDate, formatDuration, formatPct, pct } from "./shared";

interface CronJob {
  id: string;
  name: string;
  agent_id: string;
  enabled: boolean;
  total_runs: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  last_run_at: string | null;
}

interface TimelineDay {
  day: string;
  success: number;
  errors: number;
  avg_duration_ms: number;
}

export default function CronReport({ days }: { days: number }) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [timeline, setTimeline] = useState<TimelineDay[]>([]);

  useEffect(() => {
    fetch("/api/reports/cron/summary").then((r) => r.json()).then((d) => setJobs(d.jobs || [])).catch(() => {});
    fetch(`/api/reports/cron/timeline?days=${days}`).then((r) => r.json()).then((d) => setTimeline(d.timeline || [])).catch(() => {});
  }, [days]);

  const totalRuns = jobs.reduce((s, j) => s + j.total_runs, 0);
  const totalSuccess = jobs.reduce((s, j) => s + j.success_count, 0);
  const totalErrors = jobs.reduce((s, j) => s + j.error_count, 0);
  const successRate = pct(totalSuccess, totalRuns);
  const avgDuration = totalRuns > 0
    ? jobs.reduce((s, j) => s + j.avg_duration_ms * j.success_count, 0) / (totalSuccess || 1)
    : 0;

  return (
    <div className="reports-tab">
      <CardGrid minWidth={200}>
        <Card className="stat-card ocean">
          <div className="label">Total Runs</div>
          <div className="value">{totalRuns.toLocaleString()}</div>
        </Card>
        <Card className="stat-card mint">
          <div className="label">Success Rate</div>
          <div className="value">{formatPct(successRate)}</div>
        </Card>
        <Card className="stat-card amber">
          <div className="label">Avg Duration</div>
          <div className="value">{formatDuration(Math.round(avgDuration))}</div>
        </Card>
        <Card className="stat-card rose">
          <div className="label">Errors</div>
          <div className="value">{totalErrors.toLocaleString()}</div>
        </Card>
      </CardGrid>

      <div className="reports-chart-grid">
        <Card>
          <SectionLabel>Daily Run Timeline</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} />
              <Bar dataKey="success" stackId="1" fill={STATUS_COLORS.success} name="Success" radius={[0, 0, 0, 0]} />
              <Bar dataKey="errors" stackId="1" fill={STATUS_COLORS.error} name="Errors" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Avg Duration Trend</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => formatDuration(v)} />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} formatter={(v: any) => [formatDuration(Number(v ?? 0)), ""]} />
              <Area type="monotone" dataKey="avg_duration_ms" fill="#ff5a1f" stroke="#ff5a1f" fillOpacity={0.3} name="Avg Duration" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionLabel>Job Performance</SectionLabel>
        <DataTable<CronJob>
          columns={[
            { key: "name", header: "Job Name", render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: "agent", header: "Agent", render: (r) => <span className="text-muted">{r.agent_id}</span> },
            { key: "enabled", header: "Status", render: (r) => (
              <Badge status={r.enabled ? "success" : "muted"}>{r.enabled ? "Active" : "Disabled"}</Badge>
            )},
            { key: "runs", header: "Runs", render: (r) => r.total_runs.toLocaleString(), align: "right" },
            { key: "success", header: "Success %", render: (r) => formatPct(pct(r.success_count, r.total_runs)), align: "right" },
            { key: "avg_dur", header: "Avg Duration", render: (r) => formatDuration(r.avg_duration_ms), align: "right" },
            { key: "max_dur", header: "Max Duration", render: (r) => formatDuration(r.max_duration_ms), align: "right" },
            { key: "last_run", header: "Last Run", render: (r) => r.last_run_at ? formatDate(r.last_run_at) : "Never", align: "right" },
          ]}
          data={jobs}
          rowKey={(r) => r.id}
          emptyMessage="No cron jobs"
        />
      </Card>
    </div>
  );
}
