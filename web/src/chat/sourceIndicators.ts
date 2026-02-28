export interface ToolSourceIndicator {
  label: string;
  c1: string;
  c2: string;
}

const SOURCES: Array<{ label: string; c1: string; c2: string; keywords: string[] }> = [
  { label: "Mail", c1: "#ff4d2b", c2: "#ff9d2e", keywords: ["gmail", "email", "inbox", "mail"] },
  { label: "Calendar", c1: "#ef6a32", c2: "#ffc04d", keywords: ["calendar", "event", "schedule"] },
  { label: "Contacts", c1: "#ff3f6b", c2: "#ff9747", keywords: ["contact", "person", "people"] },
  { label: "Tasks", c1: "#ff6824", c2: "#ffbb42", keywords: ["task", "todo", "things", "okr", "reminder"] },
  { label: "Weather", c1: "#ff5128", c2: "#ffbe4f", keywords: ["weather", "forecast"] },
  { label: "Web", c1: "#ff2b4f", c2: "#ff8a3c", keywords: ["web", "search", "browser", "url", "site", "http"] },
  { label: "Drive", c1: "#ff4d19", c2: "#ffa047", keywords: ["drive", "doc", "file", "sheet", "folder"] },
  { label: "Code", c1: "#ff2f65", c2: "#ff9547", keywords: ["git", "repo", "code", "terminal", "shell", "command", "autodev"] },
];

const FALLBACK: ToolSourceIndicator = {
  label: "Tools",
  c1: "#ff5a1f",
  c2: "#ffb84a",
};

export function getToolSourceIndicator(toolName: string): ToolSourceIndicator {
  const name = toolName.trim().toLowerCase();
  const match = SOURCES.find((source) => source.keywords.some((keyword) => name.includes(keyword)));
  if (!match) return FALLBACK;
  return { label: match.label, c1: match.c1, c2: match.c2 };
}
