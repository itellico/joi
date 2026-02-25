import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function readTimeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

const TIMEOUT_MS = readTimeoutFromEnv("JOI_CODEX_CLI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

let codexPathCache: string | null = null;
function getCodexPath(): string {
  if (codexPathCache) return codexPathCache;
  const candidates = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    `${process.env.HOME}/.local/bin/codex`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      codexPathCache = candidate;
      return candidate;
    }
  }
  try {
    codexPathCache = execFileSync("/usr/bin/which", ["codex"], { encoding: "utf-8" }).trim();
    return codexPathCache;
  } catch {
    return "codex";
  }
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r/g, "");
}

function parseInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
}

function cleanDiagnosticLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

interface CodexJsonEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    exit_code?: number | null;
    aggregated_output?: string;
    status?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  model?: string;
}

export interface CodexCliOptions {
  userMessage: string;
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStream?: (delta: string) => void;
}

export interface CodexCliResult {
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runCodexCli(options: CodexCliOptions): Promise<CodexCliResult> {
  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n## Task\n${options.userMessage}`
    : options.userMessage;

  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  args.push(fullPrompt);

  const spawnCwd = options.cwd?.replace(/^~/, process.env.HOME || "/Users/mm2") || process.env.HOME || "/Users/mm2";
  const codexPath = getCodexPath();

  return new Promise((resolve, reject) => {
    let settled = false;
    let fullContent = "";
    let model = options.model || "codex-cli";
    let usageIn = 0;
    let usageOut = 0;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const diagnostics: string[] = [];

    const proc = spawn(codexPath, args, {
      cwd: spawnCwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const effectiveTimeout = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : TIMEOUT_MS;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error(`Codex CLI timed out (${Math.round(effectiveTimeout / 1000)}s).`));
    }, effectiveTimeout);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.kill("SIGTERM");
      reject(new Error("Codex CLI aborted"));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeout);
        proc.kill("SIGTERM");
        reject(new Error("Codex CLI aborted"));
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const appendAssistantDelta = (text: string) => {
      const cleaned = text.trimEnd();
      if (!cleaned) return;
      let delta = cleaned;
      if (cleaned.startsWith(fullContent)) {
        delta = cleaned.slice(fullContent.length);
      } else if (fullContent.startsWith(cleaned)) {
        delta = "";
      }
      if (!delta) return;
      fullContent += delta;
      options.onStream?.(delta);
    };

    const handleLine = (rawLine: string) => {
      const line = stripAnsi(rawLine).trim();
      if (!line) return;

      try {
        const event = JSON.parse(line) as CodexJsonEvent;
        if (typeof event.model === "string" && event.model.trim()) {
          model = event.model.trim();
        }
        if (event.type === "turn.completed" && event.usage) {
          usageIn = parseInteger(event.usage.input_tokens);
          usageOut = parseInteger(event.usage.output_tokens);
          return;
        }
        if (!event.item) return;

        if (event.item.type === "agent_message" && typeof event.item.text === "string") {
          appendAssistantDelta(event.item.text);
          return;
        }

        if (event.item.type === "command_execution") {
          if (event.type === "item.started" && event.item.command) {
            options.onStream?.(`\n[codex] running: ${event.item.command}\n`);
            return;
          }
          if (event.type === "item.completed") {
            const exitCode = event.item.exit_code;
            const status = exitCode === null || exitCode === undefined
              ? event.item.status || "completed"
              : `exit ${exitCode}`;
            options.onStream?.(`\n[codex] command ${status}\n`);
            if (event.item.aggregated_output) {
              const output = event.item.aggregated_output.trim();
              if (output) options.onStream?.(`${output}\n`);
            }
          }
        }
      } catch {
        const cleaned = cleanDiagnosticLine(line);
        if (cleaned) diagnostics.push(cleaned);
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) handleLine(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString("utf-8"));
      stderrBuffer += text;
      const lines = text.split("\n").map((line) => cleanDiagnosticLine(line)).filter((line) => line.length > 0);
      diagnostics.push(...lines);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);

      if (stdoutBuffer.trim().length > 0) {
        handleLine(stdoutBuffer);
      }

      const content = fullContent.trim();
      const diagnosticTail = [...diagnostics, cleanDiagnosticLine(stderrBuffer)]
        .filter((line) => line.length > 0)
        .slice(-8)
        .join(" | ");

      if (code !== 0) {
        const errorMessage = diagnosticTail || `Codex CLI exited with code ${code}.`;
        reject(new Error(errorMessage));
        return;
      }

      if (!content) {
        const errorLike = /error|failed|exception|aborted|permission|not found/i.test(diagnosticTail);
        if (errorLike && diagnosticTail) {
          reject(new Error(diagnosticTail));
          return;
        }
        reject(new Error("Codex CLI returned empty output."));
        return;
      }

      resolve({
        content,
        model,
        provider: "codex-cli",
        usage: {
          inputTokens: usageIn,
          outputTokens: usageOut,
        },
      });
    });
  });
}
