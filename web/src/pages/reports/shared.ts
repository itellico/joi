// Shared colors, formatters, and tooltip styles for report charts

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d97706",
  openrouter: "#6366f1",
  ollama: "#22c55e",
  deepgram: "#ff8a2f",
  cartesia: "#f472b6",
};

export const TASK_COLORS: Record<string, string> = {
  chat: "#60a5fa",
  tool: "#f59e0b",
  utility: "#22c55e",
  triage: "#ff5a1f",
  embedding: "#f472b6",
};

export const STATUS_COLORS = {
  success: "#34d399",
  error: "#f87171",
};

export const CHART_PALETTE = [
  "#60a5fa", "#f59e0b", "#22c55e", "#ff5a1f", "#f472b6",
  "#d97706", "#6366f1", "#ff8a2f", "#fb923c", "#34d399",
];

export const tooltipStyle = {
  contentStyle: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    fontSize: "var(--text-base)",
    borderRadius: 6,
  },
};

export function formatCost(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export function formatTokens(v: number | string): string {
  const n = Number(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatDate(v: string): string {
  return new Date(v).toLocaleDateString("de-AT", { day: "numeric", month: "short" });
}

export function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}
