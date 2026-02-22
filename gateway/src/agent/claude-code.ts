// Claude Code CLI Integration: Run messages through Claude Code CLI instead of API
// Uses the user's Claude subscription — no API costs.
//
// Uses node-pty (pseudo-terminal) to spawn claude --print. The PTY creates a
// new session (setsid), fully detaching from the parent process tree. This
// bypasses Claude Code's nested-session detection, which would otherwise cause
// claude --print to hang when the gateway runs inside a Claude Code session.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Lazy-load node-pty — only when runClaudeCode is actually called.
// This avoids crashing in environments where node-pty isn't available
// (e.g. the LiveKit agent worker Docker container).
let _pty: typeof import("node-pty") | null = null;
async function getPty() {
  if (!_pty) _pty = await import("node-pty");
  return _pty;
}

// Resolve claude binary path lazily (only needed when running Claude Code)
let _claudePath: string | null = null;
function getClaudePath(): string {
  if (_claudePath) return _claudePath;
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) { _claudePath = p; return p; }
  }
  try {
    _claudePath = execFileSync("/usr/bin/which", ["claude"], { encoding: "utf-8" }).trim();
    return _claudePath;
  } catch { return "claude"; }
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function readTimeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

const TIMEOUT_MS = readTimeoutFromEnv("JOI_CLAUDE_CODE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

// Strip ANSI escape sequences and carriage returns from PTY output
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")   // OSC sequences
    .replace(/\x1b\([AB012]/g, "")          // charset sequences
    .replace(/\r/g, "");
}

export interface ClaudeCodeOptions {
  userMessage: string;
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStream?: (delta: string) => void;
  onToolUse?: (name: string, input: unknown, id: string) => void;
  onToolResult?: (id: string, result: unknown) => void;
}

export interface ClaudeCodeResult {
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

// Run a single message through Claude Code CLI with streaming
export async function runClaudeCode(options: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  const { userMessage, systemPrompt, cwd, model, timeoutMs, signal, onStream, onToolUse, onToolResult } = options;

  const args = [
    "--print",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  if (model) {
    args.push("--model", model);
  }

  args.push(userMessage);

  const pty = await getPty();
  const claudePath = getClaudePath();

  return new Promise((resolve, reject) => {
    // Build clean env — strip all Claude Code env vars
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "CLAUDECODE" && !k.startsWith("CLAUDE_CODE_")) {
        env[k] = v;
      }
    }

    // Spawn via PTY — creates a new session (setsid), fully detached from
    // parent process tree. This is what makes it work even when the gateway
    // is running inside a Claude Code session.
    const spawnCwd = cwd?.replace(/^~/, process.env.HOME || "/Users/mm2") || process.env.HOME || "/Users/mm2";

    let proc: ReturnType<typeof pty.spawn>;
    try {
      proc = pty.spawn(claudePath, args, {
        name: "dumb",
        cols: 250,
        rows: 50,
        cwd: spawnCwd,
        env,
      });
    } catch (spawnErr) {
      return reject(new Error(`Failed to spawn claude: ${(spawnErr as Error).message}`));
    }

    let fullContent = "";
    let model = "claude-code";
    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = ""; // Buffer for incomplete lines (PTY can split mid-line)
    let gotAssistantText = false; // Track if we got text from assistant events
    let settled = false;

    const effectiveTimeout =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error(`Claude Code CLI timed out (${Math.round(effectiveTimeout / 1000)}s).`));
      }
    }, effectiveTimeout);

    // AbortSignal support — kill the process when aborted externally
    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        proc.kill();
        reject(new Error("Claude Code aborted"));
      }
    };
    if (signal) {
      if (signal.aborted) {
        proc.kill();
        return reject(new Error("Claude Code aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const processLine = (rawLine: string) => {
      const line = stripAnsi(rawLine).trim();
      if (!line) return;

      try {
        const event = JSON.parse(line);
        handleStreamEvent(event, gotAssistantText, {
          onText: (text) => {
            gotAssistantText = true;
            fullContent += text;
            onStream?.(text);
          },
          onResultText: (text) => {
            // Only use result text if we never got text from assistant events
            // (happens in multi-turn tool use where only the result has final text)
            if (!gotAssistantText) {
              fullContent += text;
              onStream?.(text);
            }
          },
          onToolUse: (name, input, id) => {
            onToolUse?.(name, input, id);
          },
          onToolResult: (id, result) => {
            onToolResult?.(id, result);
          },
          onModel: (m) => { model = m; },
          onUsage: (inp, out) => { inputTokens += inp; outputTokens += out; },
        });
      } catch {
        // Non-JSON line — skip (PTY noise, prompts, etc.)
      }
    };

    proc.onData((chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete last line in buffer

      for (const rawLine of lines) {
        processLine(rawLine);
      }
    });

    proc.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;

      // Process any remaining buffer
      if (buffer.trim()) {
        processLine(buffer);
      }

      if (exitCode !== 0 && !fullContent) {
        reject(new Error(`Claude Code exited with code ${exitCode}`));
        return;
      }

      resolve({
        content: fullContent,
        model,
        provider: "claude-code",
        usage: { inputTokens, outputTokens },
      });
    });
  });
}

// Handle stream-json events from Claude Code
function handleStreamEvent(
  event: any,
  gotAssistantText: boolean,
  handlers: {
    onText: (text: string) => void;
    onResultText: (text: string) => void;
    onToolUse: (name: string, input: unknown, id: string) => void;
    onToolResult: (id: string, result: unknown) => void;
    onModel: (model: string) => void;
    onUsage: (input: number, output: number) => void;
  },
): void {
  switch (event.type) {
    case "assistant":
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") {
            handlers.onText(block.text);
          } else if (block.type === "tool_use") {
            handlers.onToolUse(block.name, block.input, block.id);
          }
        }
      }
      if (event.message?.model) {
        handlers.onModel(event.message.model);
      }
      // Skip assistant-level usage — the authoritative totals come from the
      // "result" event at the end of the stream.
      break;

    case "content_block_delta":
      if (event.delta?.type === "text_delta" && event.delta.text) {
        handlers.onText(event.delta.text);
      }
      break;

    case "content_block_start":
      if (event.content_block?.type === "tool_use") {
        handlers.onToolUse(
          event.content_block.name,
          event.content_block.input || {},
          event.content_block.id,
        );
      }
      break;

    case "result":
      // Use result text only as fallback when no assistant text was received
      // (multi-turn tool use). Otherwise it duplicates assistant content.
      if (event.result) {
        handlers.onResultText(event.result);
      }
      if (event.usage) {
        handlers.onUsage(
          event.usage.input_tokens || 0,
          event.usage.output_tokens || 0,
        );
      }
      break;

    case "message_start":
      if (event.message?.model) {
        handlers.onModel(event.message.model);
      }
      break;

    case "message_delta":
      if (event.usage) {
        handlers.onUsage(
          event.usage.input_tokens || 0,
          event.usage.output_tokens || 0,
        );
      }
      break;
  }
}
