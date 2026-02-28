import { useEffect, useState } from "react";
import { Card, CardGrid, DataTable, SectionLabel, MetaText } from "../../components/ui";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { CHART_PALETTE, tooltipStyle, formatCost, formatDate, formatDuration } from "./shared";

interface OpenRouterData {
  credits?: { total_credits?: number; total_usage?: number };
  keys?: Array<{ name: string; label: string; usage: number; limit: number; limitRemaining: number }>;
  error?: string;
}

interface MemoryArea {
  area: string;
  count: number;
  avg_confidence: number;
}

interface UsageSummary {
  all: { total_calls: number; total_tokens: string; total_cost: number };
  today: { calls: number; tokens: string; cost: number };
}

interface KnowledgeSummary {
  total_documents: number;
  total_chunks: number;
  embedded_chunks: number;
  active_memories: number;
}

interface VoiceSummary {
  total_calls: number;
  total_duration_ms: string;
  total_characters: string;
  total_cost: number;
  stt_cost: number;
  tts_cost: number;
  stt_duration_ms: string;
  tts_characters: string;
  cache_hits?: number;
  cache_misses?: number;
  cache_hit_chars?: number;
  cache_miss_chars?: number;
  cache_hit_audio_bytes?: number;
  cache_miss_audio_bytes?: number;
  cache_hit_rate?: number;
}

interface VoiceDaily {
  day: string;
  service: string;
  calls: number;
  cost: number;
  duration_ms: string;
  characters: string;
}

interface SystemTotals {
  label: string;
  value: string;
}

export default function SystemReport() {
  const [openrouter, setOpenrouter] = useState<OpenRouterData | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryArea[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeSummary | null>(null);
  const [voice, setVoice] = useState<VoiceSummary | null>(null);
  const [voiceDaily, setVoiceDaily] = useState<VoiceDaily[]>([]);

  useEffect(() => {
    fetch("/api/stats/openrouter").then((r) => r.json()).then(setOpenrouter).catch(() => {});
    fetch("/api/memories/stats").then((r) => r.json()).then((d) => setMemoryStats(d.stats || [])).catch(() => {});
    fetch("/api/stats/usage/summary").then((r) => r.json()).then(setUsage).catch(() => {});
    fetch("/api/reports/knowledge/summary").then((r) => r.json()).then(setKnowledge).catch(() => {});
    fetch("/api/reports/voice/summary?days=30").then((r) => r.json()).then(setVoice).catch(() => {});
    fetch("/api/reports/voice/daily?days=30").then((r) => r.json()).then((d) => setVoiceDaily(d.daily || [])).catch(() => {});
  }, []);

  const credits = openrouter?.credits;
  const balance = credits ? (credits.total_credits ?? 0) - (credits.total_usage ?? 0) : null;
  const hasVoiceData = voice && (voice.total_calls > 0 || voice.total_cost > 0);

  // Pivot voice daily by service for stacked bar
  const voiceDailyPivoted = (() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const row of voiceDaily) {
      if (!byDay.has(row.day)) byDay.set(row.day, { day: row.day, stt: 0, tts: 0 });
      const entry = byDay.get(row.day)!;
      entry[row.service] = Number(entry[row.service] || 0) + row.cost;
    }
    return Array.from(byDay.values());
  })();

  const totals: SystemTotals[] = [
    { label: "Total API Calls", value: usage?.all?.total_calls?.toLocaleString() ?? "—" },
    { label: "Total Tokens", value: Number(usage?.all?.total_tokens ?? 0).toLocaleString() },
    { label: "Total LLM Cost (All Time)", value: formatCost(usage?.all?.total_cost ?? 0) },
    { label: "Today's Calls", value: usage?.today?.calls?.toLocaleString() ?? "0" },
    { label: "Today's Cost", value: formatCost(usage?.today?.cost ?? 0) },
    { label: "Voice Cost (30d)", value: formatCost(voice?.total_cost ?? 0) },
    { label: "STT Audio (30d)", value: formatDuration(Number(voice?.stt_duration_ms ?? 0)) },
    { label: "TTS Characters (30d)", value: Number(voice?.tts_characters ?? 0).toLocaleString() },
    { label: "TTS Cache Hit Rate (30d)", value: `${Math.round((voice?.cache_hit_rate ?? 0) * 100)}%` },
    { label: "TTS Cache Saved Chars (30d)", value: Number(voice?.cache_hit_chars ?? 0).toLocaleString() },
    { label: "Documents", value: knowledge?.total_documents?.toLocaleString() ?? "—" },
    { label: "Chunks", value: knowledge?.total_chunks?.toLocaleString() ?? "—" },
    { label: "Active Memories", value: knowledge?.active_memories?.toLocaleString() ?? "—" },
  ];

  return (
    <div className="reports-tab">
      <CardGrid minWidth={220}>
        <Card className="stat-card ocean">
          <div className="label">OpenRouter Balance</div>
          <div className="value">
            {openrouter?.error
              ? <MetaText size="xs">Not configured</MetaText>
              : balance !== null ? formatCost(balance) : "—"}
          </div>
          {credits && (
            <div className="label">
              {formatCost(credits.total_usage ?? 0)} used of {formatCost(credits.total_credits ?? 0)}
            </div>
          )}
        </Card>

        <Card className="stat-card mint">
          <div className="label">Total Memories</div>
          <div className="value">{memoryStats.reduce((s, m) => s + m.count, 0).toLocaleString()}</div>
          <div className="label">{memoryStats.length} areas</div>
        </Card>

        <Card className="stat-card amber">
          <div className="label">All-Time LLM Cost</div>
          <div className="value">{formatCost(usage?.all?.total_cost ?? 0)}</div>
          <div className="label">{usage?.all?.total_calls?.toLocaleString() ?? 0} calls</div>
        </Card>

        <Card className="stat-card rose">
          <div className="label">Voice Cost (30d)</div>
          <div className="value">{hasVoiceData ? formatCost(voice!.total_cost) : "—"}</div>
          <div className="label">
            {hasVoiceData
              ? `STT ${formatCost(voice!.stt_cost)} + TTS ${formatCost(voice!.tts_cost)}`
              : "No voice data yet"}
          </div>
          {hasVoiceData && (
            <div className="label">
              Cache {Math.round((voice!.cache_hit_rate ?? 0) * 100)}% hit
            </div>
          )}
        </Card>
      </CardGrid>

      <div className="reports-chart-grid">
        <Card>
          <SectionLabel>Memory Distribution</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={memoryStats}
                dataKey="count"
                nameKey="area"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {memoryStats.map((m, i) => (
                  <Cell key={m.area} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v: any) => [Number(v ?? 0).toLocaleString(), "memories"]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionLabel>Daily Voice Cost</SectionLabel>
          {voiceDailyPivoted.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={voiceDailyPivoted}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={formatDate} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => formatCost(v)} />
                <Tooltip {...tooltipStyle} labelFormatter={(v: any) => formatDate(String(v))} formatter={(v: any) => [formatCost(Number(v ?? 0)), ""]} />
                <Bar dataKey="stt" stackId="1" fill="#ff8a2f" name="STT (DeepGram)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="tts" stackId="1" fill="#f472b6" name="TTS (Cartesia)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MetaText>No voice usage data yet. Data will appear after voice calls.</MetaText>
            </div>
          )}
        </Card>

        {openrouter?.keys && openrouter.keys.length > 0 && (
          <Card>
            <SectionLabel>OpenRouter API Keys</SectionLabel>
            <DataTable<(typeof openrouter.keys)[0]>
              columns={[
                { key: "name", header: "Key", render: (r) => <span className="font-mono text-xs">{r.name || r.label}</span> },
                { key: "usage", header: "Usage", render: (r) => formatCost(r.usage), align: "right" },
                { key: "limit", header: "Limit", render: (r) => r.limit ? formatCost(r.limit) : "Unlimited", align: "right" },
                { key: "remaining", header: "Remaining", render: (r) => r.limitRemaining ? formatCost(r.limitRemaining) : "—", align: "right" },
              ]}
              data={openrouter.keys}
              rowKey={(r) => r.name || r.label}
              emptyMessage="No keys"
            />
          </Card>
        )}
      </div>

      <Card className="mt-4">
        <SectionLabel>System Totals</SectionLabel>
        <DataTable<SystemTotals>
          columns={[
            { key: "label", header: "Metric", render: (r) => <span className="font-semibold">{r.label}</span> },
            { key: "value", header: "Value", render: (r) => r.value, align: "right" },
          ]}
          data={totals}
          rowKey={(r) => r.label}
          emptyMessage="No data"
        />
      </Card>
    </div>
  );
}
