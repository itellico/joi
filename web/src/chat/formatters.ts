export function shortModelName(model: string): string {
  return model
    .replace("claude-sonnet-4-20250514", "Sonnet 4")
    .replace("claude-opus-4-20250514", "Opus 4")
    .replace("claude-haiku-3-20240307", "Haiku 3")
    .replace("anthropic/claude-sonnet-4", "Sonnet 4")
    .replace("anthropic/claude-opus-4", "Opus 4")
    .replace("anthropic/claude-3-haiku", "Haiku 3")
    .replace("anthropic/claude-3.5-haiku", "Haiku 3.5")
    .replace("openai/gpt-4o-mini", "GPT-4o Mini")
    .replace("openai/gpt-4o", "GPT-4o")
    .replace("google/gemini-2.0-flash-001", "Gemini Flash")
    .replace("google/gemini-2.5-pro-preview", "Gemini Pro")
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("google/", "")
    .replace("deepseek/", "")
    .replace("meta-llama/", "");
}

export function formatDuration(ms: number): string {
  return ms < 1000
    ? `${Math.round(ms)}ms`
    : `${(ms / 1000).toFixed(1)}s`;
}

export function formatToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === "contacts_search") return "Contact search";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
