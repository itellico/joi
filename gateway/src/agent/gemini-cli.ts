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

const TIMEOUT_MS = readTimeoutFromEnv("JOI_GEMINI_CLI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

let geminiPathCache: string | null = null;
function getGeminiPath(): string {
  if (geminiPathCache) return geminiPathCache;
  const candidates = [
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    `${process.env.HOME}/.local/bin/gemini`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      geminiPathCache = candidate;
      return candidate;
    }
  }
  try {
    geminiPathCache = execFileSync("/usr/bin/which", ["gemini"], { encoding: "utf-8" }).trim();
    return geminiPathCache;
  } catch {
    return "gemini";
  }
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r/g, "");
}

function extractString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function digForText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => digForText(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = ["delta", "text", "content", "output", "message", "response"];
    const direct = fields
      .map((key) => extractString(record[key]))
      .filter((text): text is string => Boolean(text));
    const nested = Object.values(record).flatMap((entry) => digForText(entry));
    return [...direct, ...nested];
  }
  return [];
}

function cleanDiagnosticLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function isNoiseLine(line: string): boolean {
  if (!line) return true;
  return (
    line.startsWith("YOLO mode is enabled") ||
    line.startsWith("Loaded cached credentials") ||
    line.startsWith("Skill conflict detected:") ||
    line.startsWith("Skill \"") ||
    line.startsWith("Attempt ")
  );
}

function parseInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
}

function extractUsage(event: Record<string, unknown>): { input: number; output: number } {
  const usage = (event.usage as Record<string, unknown> | undefined)
    || (event.usageMetadata as Record<string, unknown> | undefined)
    || (event.token_usage as Record<string, unknown> | undefined)
    || {};

  const input = parseInteger(
    usage.inputTokens
    ?? usage.promptTokenCount
    ?? usage.prompt_tokens
    ?? usage.input_tokens,
  );
  const output = parseInteger(
    usage.outputTokens
    ?? usage.candidatesTokenCount
    ?? usage.completion_tokens
    ?? usage.output_tokens,
  );
  return { input, output };
}

export interface GeminiCliOptions {
  userMessage: string;
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStream?: (delta: string) => void;
}

export interface GeminiCliResult {
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runGeminiCli(options: GeminiCliOptions): Promise<GeminiCliResult> {
  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n## Task\n${options.userMessage}`
    : options.userMessage;

  const args = [
    "--prompt", fullPrompt,
    "--output-format", "stream-json",
    "--approval-mode", "yolo",
  ];
  if (options.model) {
    args.push("--model", options.model);
  }

  const spawnCwd = options.cwd?.replace(/^~/, process.env.HOME || "/Users/mm2") || process.env.HOME || "/Users/mm2";
  const geminiPath = getGeminiPath();

  return new Promise((resolve, reject) => {
    let settled = false;
    let fullContent = "";
    let model = options.model || "gemini-cli";
    let usageIn = 0;
    let usageOut = 0;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const diagnostics: string[] = [];

    const proc = spawn(geminiPath, args, {
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
      reject(new Error(`Gemini CLI timed out (${Math.round(effectiveTimeout / 1000)}s).`));
    }, effectiveTimeout);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.kill("SIGTERM");
      reject(new Error("Gemini CLI aborted"));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeout);
        proc.kill("SIGTERM");
        reject(new Error("Gemini CLI aborted"));
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const applyTextDelta = (candidate: string) => {
      const text = candidate.trimEnd();
      if (!text) return;
      let delta = text;
      if (text.startsWith(fullContent)) {
        delta = text.slice(fullContent.length);
      } else if (fullContent.startsWith(text)) {
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
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const modelValue = extractString(parsed.model);
        if (modelValue) model = modelValue;
        const usage = extractUsage(parsed);
        if (usage.input > 0) usageIn = usage.input;
        if (usage.output > 0) usageOut = usage.output;

        const role = extractString(parsed.role)?.toLowerCase();
        if (role === "user") return;
        const textChunks = digForText(parsed)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.length > 0);
        if (textChunks.length > 0) {
          applyTextDelta(textChunks[textChunks.length - 1]);
        }
      } catch {
        const cleaned = cleanDiagnosticLine(line);
        if (!isNoiseLine(cleaned)) diagnostics.push(cleaned);
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
      diagnostics.push(...lines.filter((line) => !isNoiseLine(line)));
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      reject(new Error(`Failed to spawn gemini: ${err.message}`));
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
        .slice(-5)
        .join(" | ");

      if (code !== 0) {
        const errorMessage = diagnosticTail || `Gemini CLI exited with code ${code}.`;
        reject(new Error(errorMessage));
        return;
      }
      if (!content) {
        const errorLike = /error|failed|exception|resource_exhausted|429|capacity/i.test(diagnosticTail);
        if (errorLike && diagnosticTail) {
          reject(new Error(diagnosticTail));
          return;
        }
        reject(new Error("Gemini CLI returned empty output."));
        return;
      }

      resolve({
        content,
        model,
        provider: "gemini-cli",
        usage: {
          inputTokens: usageIn,
          outputTokens: usageOut,
        },
      });
    });
  });
}
