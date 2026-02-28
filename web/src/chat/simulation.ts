export type ChatExecutionMode = "live" | "shadow" | "dry_run";
export type ChatLatencyPreset = "none" | "light" | "realistic" | "stress";

export function chatLatencyProfileFromPreset(preset: ChatLatencyPreset): Record<string, number> | null {
  if (preset === "none") return null;
  if (preset === "light") {
    return { toolMinMs: 80, toolMaxMs: 250, responseMinMs: 120, responseMaxMs: 380, jitterMs: 40 };
  }
  if (preset === "realistic") {
    return { toolMinMs: 180, toolMaxMs: 900, responseMinMs: 300, responseMaxMs: 1400, jitterMs: 200 };
  }
  return { toolMinMs: 500, toolMaxMs: 2200, responseMinMs: 1200, responseMaxMs: 4200, jitterMs: 650 };
}

export function buildSimulationMetadata(
  chatMode: "api" | "claude-code",
  executionMode: ChatExecutionMode,
  latencyPreset: ChatLatencyPreset,
): Record<string, unknown> | undefined {
  if (chatMode === "claude-code") return undefined;
  const latencyProfile = chatLatencyProfileFromPreset(latencyPreset);
  return {
    executionMode,
    ...(latencyProfile ? { latencyProfile } : {}),
  };
}
