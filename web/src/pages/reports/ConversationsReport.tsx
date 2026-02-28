import { useEffect, useState } from "react";
import { Card, CardGrid, DataTable, SectionLabel } from "../../components/ui";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { tooltipStyle, formatDate } from "./shared";

interface ConvSummary {
  conversations: number;
  messages: number;
  avg_msgs_per_conv: number;
  active_agents: number;
}

interface AgentConv {
  agent_id: string;
  conversations: number;
  messages: number;
}

interface DailyConv {
  day: string;
  conversations: number;
  messages: number;
}

export default function ConversationsReport({ days }: { days: number }) {
  const [summary, setSummary] = useState<ConvSummary | null>(null);
  const [agents, setAgents] = useState<AgentConv[]>([]);
  const [daily, setDaily] = useState<DailyConv[]>([]);

  useEffect(() => {
    fetch(`/api/reports/conversations/summary?days=${days}`).then((r) => r.json()).then(setSummary).catch(() => {});
    fetch(`/api/reports/conversations/by-agent?days=${days}`).then((r) => r.json()).then((d) => setAgents(d.agents || [])).catch(() => {});
    fetch(`/api/reports/conversations/daily?days=${days}`).then((r) => r.json()).then((d) => setDaily(d.daily || [])).catch(() => {});
  }, [days]);

  return (
    <div className="reports-tab">
      <CardGrid minWidth={200}>
        <Card className="stat-card ocean">
          <div className="label">Conversations</div>
          <div className="value">{summary?.conversations?.toLocaleString() ?? "—"}</div>
        </Card>
        <Card className="stat-card mint">
          <div className="label">Messages</div>
          <div className="value">{summary?.messages?.toLocaleString() ?? "—"}</div>
        </Card>
        <Card className="stat-card amber">
          <div className="label">Avg Msgs / Conv</div>
          <div className="value">{summary?.avg_msgs_per_conv ?? "—"}</div>
        </Card>
        <Card className="stat-card rose">
          <div className="label">Active Agents</div>
          <div className="value">{summary?.active_agents ?? "—"}</div>
        </Card>
      </CardGrid>

      <div className="reports-chart-grid">
        <Card>
          <SectionLabel>Daily Message Volume</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} />
              <Area type="monotone" dataKey="messages" fill="#60a5fa" stroke="#60a5fa" fillOpacity={0.3} name="Messages" />
              <Area type="monotone" dataKey="conversations" fill="#ff5a1f" stroke="#ff5a1f" fillOpacity={0.3} name="Conversations" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Conversations by Agent</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agents.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <YAxis type="category" dataKey="agent_id" tick={{ fontSize: 10 }} stroke="var(--text-muted)" width={100} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="conversations" fill="#60a5fa" radius={[0, 4, 4, 0]} name="Conversations" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionLabel>Agent Activity</SectionLabel>
        <DataTable<AgentConv>
          columns={[
            { key: "agent", header: "Agent", render: (r) => <span className="font-semibold">{r.agent_id}</span> },
            { key: "conversations", header: "Conversations", render: (r) => r.conversations.toLocaleString(), align: "right" },
            { key: "messages", header: "Messages", render: (r) => r.messages.toLocaleString(), align: "right" },
            { key: "avg", header: "Msgs / Conv", render: (r) => r.conversations > 0 ? (r.messages / r.conversations).toFixed(1) : "—", align: "right" },
          ]}
          data={agents}
          rowKey={(r) => r.agent_id}
          emptyMessage="No conversations"
        />
      </Card>
    </div>
  );
}
