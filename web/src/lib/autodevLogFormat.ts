export interface SplitLogs {
  claude: string;
  gemini: string;
  codex: string;
}

const OUTPUT_LINE_WIDTH = 120;

function insertStructuralBreaks(raw: string): string {
  let text = raw.replace(/\r/g, "\n").replace(/\u0000/g, "");

  // Common glued transitions in CLI logs: "successI will", "file.tsRead"
  text = text.replace(
    /(\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|yaml|yml|sh|py))(success|error|failed|Read|Listed|Found|Check|I will|Let me|npx|pnpm|npm|yarn|git|bash|node|python|curl|rg|ls)\b/g,
    "$1\n$2",
  );
  text = text.replace(
    /\b(success|failed|error|completed|done)(?=(I will|Let me|Now let me|Then I will|Next I will|I am going to))/g,
    "$1\n",
  );

  // Split sentence-like runs with missing whitespace.
  text = text.replace(/([.?!;:])(?=[A-Z])/g, "$1\n");
  text = text.replace(/([.?!;:])(?=(npx|pnpm|npm|yarn|git|bash|node|python|curl|rg|ls)\b)/g, "$1\n");

  // Put planning/execution statements on their own lines.
  text = text.replace(/\b(I will|Let me|Now let me|Then I will|Next I will|I am going to|I need to|I can|I'll)\b/g, "\n$1");

  return text.replace(/\n{3,}/g, "\n\n");
}

function softWrapLine(line: string, width = OUTPUT_LINE_WIDTH): string {
  const trimmedRight = line.trimEnd();
  if (trimmedRight.length <= width) return trimmedRight;

  const codeLike = /[`{}[\]|]/.test(trimmedRight) || /^\s*([$>#]|at\s+\S+\s+\(|\d+\s*\|)/.test(trimmedRight);
  if (codeLike) return trimmedRight;

  const words = trimmedRight.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return trimmedRight;

  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length > width) {
      out.push(current);
      current = word;
      continue;
    }
    current += " " + word;
  }
  if (current) out.push(current);
  return out.join("\n");
}

export function formatCliOutput(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const broken = insertStructuralBreaks(text);
  const lines = broken.split("\n");
  const wrapped = lines.map((line) => softWrapLine(line));
  return wrapped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitExecutorLogs(fullLog: string): SplitLogs {
  if (!fullLog.trim()) return { claude: "", gemini: "", codex: "" };

  const lines = fullLog.split("\n");
  let current: "claude" | "gemini" | "codex" | null = null;
  const claudeLines: string[] = [];
  const geminiLines: string[] = [];
  const codexLines: string[] = [];

  for (const line of lines) {
    if (/---\s*CLAUDE[- ]CODE OUTPUT START ---/i.test(line)) {
      current = "claude";
      continue;
    }
    if (/---\s*GEMINI[- ]CLI OUTPUT START ---/i.test(line)) {
      current = "gemini";
      continue;
    }
    if (/---\s*CODEX[- ]CLI OUTPUT START ---/i.test(line)) {
      current = "codex";
      continue;
    }
    if (
      /---\s*CLAUDE[- ]CODE OUTPUT END ---/i.test(line)
      || /---\s*GEMINI[- ]CLI OUTPUT END ---/i.test(line)
      || /---\s*CODEX[- ]CLI OUTPUT END ---/i.test(line)
    ) {
      current = null;
      continue;
    }

    if (current === "claude") claudeLines.push(line);
    if (current === "gemini") geminiLines.push(line);
    if (current === "codex") codexLines.push(line);
  }

  return {
    claude: formatCliOutput(claudeLines.join("\n")),
    gemini: formatCliOutput(geminiLines.join("\n")),
    codex: formatCliOutput(codexLines.join("\n")),
  };
}
