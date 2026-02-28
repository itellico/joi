/** Shared agent metadata — used by Agents page and AssistantChat for routing/delegation display. */

export interface AgentMeta {
  icon: string;
  color: string;
  category: "combined" | "operations" | "system";
}

export const AGENT_META: Record<string, AgentMeta> = {
  scout:    { icon: "🔭", color: "#3b82f6", category: "combined" },
  radar:    { icon: "📡", color: "#8b5cf6", category: "combined" },
  forge:    { icon: "🔥", color: "#f97316", category: "combined" },
  pulse:    { icon: "📈", color: "#10b981", category: "combined" },
  blitz:    { icon: "⚡", color: "#eab308", category: "combined" },
  hawk:     { icon: "🦅", color: "#ef4444", category: "combined" },
  bridge:   { icon: "🌉", color: "#06b6d4", category: "combined" },
  media:    { icon: "🎬", color: "#e879f9", category: "combined" },
  "media-integrations": { icon: "🎬", color: "#e879f9", category: "combined" },
  email:    { icon: "📧", color: "#3b82f6", category: "combined" },
  "skill-scout": { icon: "🧭", color: "#ff8a2f", category: "system" },
  "knowledge-sync": { icon: "📚", color: "#ff5a1f", category: "system" },
  "accounting-orchestrator": { icon: "📊", color: "#6366f1", category: "operations" },
  "invoice-collector":       { icon: "📥", color: "#14b8a6", category: "operations" },
  "invoice-processor":       { icon: "🔍", color: "#a855f7", category: "operations" },
  "bmd-uploader":            { icon: "📤", color: "#f59e0b", category: "operations" },
  "reconciliation":          { icon: "🔗", color: "#ec4899", category: "operations" },
  coder: { icon: "🛠️", color: "#14b8a6", category: "system" },
  "codex-coder": { icon: "🧩", color: "#10b981", category: "system" },
  "google-coder": { icon: "🧠", color: "#f97316", category: "system" },
  "avatar-studio": { icon: "🎨", color: "#06b6d4", category: "system" },
  personal: { icon: "✨", color: "#6366f1", category: "system" },
};

/** Get agent display info, with fallback for unknown agents. */
export function getAgentMeta(agentId: string): AgentMeta {
  return AGENT_META[agentId] || { icon: "🤖", color: "#8888a4", category: "system" };
}

/** Format agent ID to display name. */
export function formatAgentName(agentId: string): string {
  return agentId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
