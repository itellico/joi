export type AgentExecutionMode = "live" | "shadow" | "dry_run";

export interface AgentLatencyProfile {
  toolMinMs?: number;
  toolMaxMs?: number;
  responseMinMs?: number;
  responseMaxMs?: number;
  jitterMs?: number;
}

const EXECUTION_MODES: AgentExecutionMode[] = ["live", "shadow", "dry_run"];
const MAX_LATENCY_MS = 120_000;

export function normalizeExecutionMode(
  value: unknown,
  fallback: AgentExecutionMode = "live",
): AgentExecutionMode {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (EXECUTION_MODES.includes(normalized as AgentExecutionMode)) {
    return normalized as AgentExecutionMode;
  }
  return fallback;
}

export function parseLatencyProfile(value: unknown): AgentLatencyProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;

  const toolMinMs = parseBoundedMs(raw.toolMinMs);
  const toolMaxMs = parseBoundedMs(raw.toolMaxMs);
  const responseMinMs = parseBoundedMs(raw.responseMinMs);
  const responseMaxMs = parseBoundedMs(raw.responseMaxMs);
  const jitterMs = parseBoundedMs(raw.jitterMs);

  if (
    toolMinMs === undefined
    && toolMaxMs === undefined
    && responseMinMs === undefined
    && responseMaxMs === undefined
    && jitterMs === undefined
  ) {
    return undefined;
  }

  return {
    ...(toolMinMs !== undefined ? { toolMinMs } : {}),
    ...(toolMaxMs !== undefined ? { toolMaxMs } : {}),
    ...(responseMinMs !== undefined ? { responseMinMs } : {}),
    ...(responseMaxMs !== undefined ? { responseMaxMs } : {}),
    ...(jitterMs !== undefined ? { jitterMs } : {}),
  };
}

export async function maybeSimulateLatency(
  profile: AgentLatencyProfile | undefined,
  stage: "tool" | "response",
): Promise<void> {
  if (!profile) return;

  const min = stage === "tool" ? profile.toolMinMs : profile.responseMinMs;
  const max = stage === "tool" ? profile.toolMaxMs : profile.responseMaxMs;
  const jitter = profile.jitterMs ?? 0;
  if (min === undefined && max === undefined && jitter <= 0) return;

  const normalizedMin = Math.max(0, min ?? max ?? 0);
  const normalizedMax = Math.max(normalizedMin, max ?? min ?? normalizedMin);
  const base = normalizedMin + Math.floor(Math.random() * (normalizedMax - normalizedMin + 1));
  const jitterOffset = jitter > 0 ? Math.floor(Math.random() * (jitter + 1)) : 0;
  const total = Math.min(MAX_LATENCY_MS, base + jitterOffset);
  if (total <= 0) return;

  await delay(total);
}

function parseBoundedMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  return Math.min(MAX_LATENCY_MS, Math.floor(value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
