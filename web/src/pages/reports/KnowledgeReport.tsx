import { useEffect, useState } from "react";
import { Card, CardGrid, DataTable, SectionLabel } from "../../components/ui";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { CHART_PALETTE, tooltipStyle, formatDate, formatPct, pct } from "./shared";

interface KnowledgeSummary {
  total_documents: number;
  total_chunks: number;
  embedded_chunks: number;
  active_memories: number;
}

interface SourceRow {
  source: string;
  documents: number;
  chunks: number;
  embedded_chunks: number;
}

interface GrowthDay {
  day: string;
  new_docs: number;
  cumulative_docs: number;
}

interface MemoryArea {
  area: string;
  count: number;
  avg_confidence: number;
  with_embedding: number;
  pinned: number;
}

export default function KnowledgeReport({ days }: { days: number }) {
  const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [growth, setGrowth] = useState<GrowthDay[]>([]);
  const [areas, setAreas] = useState<MemoryArea[]>([]);

  useEffect(() => {
    fetch("/api/reports/knowledge/summary").then((r) => r.json()).then(setSummary).catch(() => {});
    fetch("/api/reports/knowledge/by-source").then((r) => r.json()).then((d) => setSources(d.sources || [])).catch(() => {});
    fetch(`/api/reports/knowledge/growth?days=${days}`).then((r) => r.json()).then((d) => setGrowth(d.growth || [])).catch(() => {});
    fetch("/api/reports/knowledge/memories-by-area").then((r) => r.json()).then((d) => setAreas(d.areas || [])).catch(() => {});
  }, [days]);

  const embeddingPct = summary ? pct(summary.embedded_chunks, summary.total_chunks) : 0;

  return (
    <div className="reports-tab">
      <CardGrid minWidth={200}>
        <Card className="stat-card ocean">
          <div className="label">Documents</div>
          <div className="value">{summary?.total_documents?.toLocaleString() ?? "—"}</div>
        </Card>
        <Card className="stat-card mint">
          <div className="label">Chunks</div>
          <div className="value">{summary?.total_chunks?.toLocaleString() ?? "—"}</div>
        </Card>
        <Card className="stat-card amber">
          <div className="label">Embedding Coverage</div>
          <div className="value">{formatPct(embeddingPct)}</div>
          <div className="label">{summary?.embedded_chunks?.toLocaleString() ?? 0} / {summary?.total_chunks?.toLocaleString() ?? 0}</div>
        </Card>
        <Card className="stat-card rose">
          <div className="label">Active Memories</div>
          <div className="value">{summary?.active_memories?.toLocaleString() ?? "—"}</div>
        </Card>
      </CardGrid>

      <div className="reports-chart-grid">
        <Card>
          <SectionLabel>Documents by Source</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={sources}
                dataKey="documents"
                nameKey="source"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {sources.map((s, i) => (
                  <Cell key={s.source} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v: any) => [Number(v ?? 0).toLocaleString(), "docs"]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Embedding Coverage by Source</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sources}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="source" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="embedded_chunks" stackId="1" fill="#34d399" name="Embedded" radius={[0, 0, 0, 0]} />
              <Bar
                dataKey="chunks"
                stackId="1"
                fill="var(--bg-hover)"
                name="Unembedded"
                radius={[4, 4, 0, 0]}
                // Show unembedded as difference
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="reports-chart-wide">
          <SectionLabel>Document Growth</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={growth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} />
              <Area type="monotone" dataKey="cumulative_docs" fill="#60a5fa" stroke="#60a5fa" fillOpacity={0.3} name="Total Docs" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionLabel>Memories by Area</SectionLabel>
        <DataTable<MemoryArea>
          columns={[
            { key: "area", header: "Area", render: (r) => <span className="font-semibold">{r.area}</span> },
            { key: "count", header: "Count", render: (r) => r.count.toLocaleString(), align: "right" },
            { key: "confidence", header: "Avg Confidence", render: (r) => r.avg_confidence?.toFixed(2) ?? "—", align: "right" },
            { key: "embedded", header: "With Embedding", render: (r) => r.with_embedding.toLocaleString(), align: "right" },
            { key: "pinned", header: "Pinned", render: (r) => r.pinned.toLocaleString(), align: "right" },
          ]}
          data={areas}
          rowKey={(r) => r.area}
          emptyMessage="No memory data"
        />
      </Card>
    </div>
  );
}
