// AutoDev Manager — always-on sequential task developer with multi-executor routing
// Runs continuously: picks tasks from the JOI project, works on them, loops.
// State machine: waiting → picking → working → completing → waiting (loop)

import fs from "node:fs";
import path from "node:path";
import { runClaudeCode } from "../agent/claude-code.js";
import { runCodexCli } from "../agent/codex-cli.js";
import { runGeminiCli } from "../agent/gemini-cli.js";
import {
  getActiveTasks,
  getProjects,
  updateTask,
  completeTask,
  type ThingsTask,
} from "../things/client.js";
import { writeMemory } from "../knowledge/writer.js";
import { searchMemories } from "../knowledge/searcher.js";
import type { JoiConfig } from "../config/schema.js";
import {
  getAutoDevAgentId,
  getAutoDevExecutorMode,
  routeAutoDevTask,
  type AutoDevExecutor,
  type AutoDevExecutorMode,
  type AutoDevRouteDecision,
} from "./task-router.js";
import type {
  AutoDevStatusData,
  AutoDevLogData,
  AutoDevTaskCompleteData,
  AutoDevErrorData,
} from "../protocol.js";

export type AutoDevState = "waiting" | "picking" | "working" | "completing";

interface BroadcastFn {
  (type: string, data: unknown): void;
}

interface CompletedSummary {
  title: string;
  summary: string;
  timestamp: string;
}

interface TaskExecutionResult {
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
  executor: AutoDevExecutor;
}

interface DiscussionTurn {
  turn: number;
  executor: "codex-cli" | "claude-code";
  content: string;
}

type ExecutorRuntimeState = "idle" | "running" | "success" | "error";

interface AutoDevRuntimeConfig {
  executorMode: AutoDevExecutorMode;
  parallelExecution: boolean;
  discussionMode: boolean;
  discussionMaxTurns: number;
}

const PROJECT_TITLE = "JOI";
const POLL_INTERVAL_MS = 30_000; // Check for new tasks every 30s when idle
const NEXT_TASK_DELAY_MS = 5_000; // Delay between tasks
const PROJECT_CWD = "~/dev_mm/joi";
const DEV_LOG_DIR = "_Claude/AutoDev";
const MAX_CONTEXT_SUMMARIES = 5;
const MAX_LOG_CHARS = 500_000;
const AUTODEV_CLAUDE_TIMEOUT_MS = readTimeoutFromEnv("JOI_AUTODEV_CLAUDE_TIMEOUT_MS", 30 * 60 * 1000);
const AUTODEV_GEMINI_TIMEOUT_MS = readTimeoutFromEnv("JOI_AUTODEV_GEMINI_TIMEOUT_MS", 30 * 60 * 1000);
const AUTODEV_CODEX_TIMEOUT_MS = readTimeoutFromEnv("JOI_AUTODEV_CODEX_TIMEOUT_MS", 30 * 60 * 1000);
const AUTODEV_EXECUTOR_MODE = getAutoDevExecutorMode();
const AUTODEV_PARALLEL_EXECUTION = readBooleanFromEnv("JOI_AUTODEV_PARALLEL_EXECUTION", true);
const AUTODEV_DISCUSSION_MODE = readBooleanFromEnv("JOI_AUTODEV_DISCUSSION_MODE", false);
const AUTODEV_DISCUSSION_MAX_TURNS = readBoundedIntFromEnv("JOI_AUTODEV_DISCUSSION_MAX_TURNS", 5, 1, 5);
const AUTODEV_CLAUDE_MODEL = process.env.JOI_AUTODEV_CLAUDE_MODEL?.trim() || undefined;
const AUTODEV_GEMINI_MODEL = process.env.JOI_AUTODEV_GEMINI_MODEL?.trim() || undefined;
const AUTODEV_CODEX_MODEL = process.env.JOI_AUTODEV_CODEX_MODEL?.trim() || undefined;

function readTimeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

function readBooleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readBoundedIntFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeExecutorMode(value: unknown, fallback: AutoDevExecutorMode): AutoDevExecutorMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "auto" || raw === "claude-code" || raw === "gemini-cli" || raw === "codex-cli") {
    return raw;
  }
  return fallback;
}

export class AutoDevManager {
  private state: AutoDevState = "waiting";
  private projectUuid: string | null = null;
  private projectTitle = PROJECT_TITLE;
  private currentTask: ThingsTask | null = null;
  private completedCount = 0;
  private queue: ThingsTask[] = [];
  private abortController: AbortController | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcast: BroadcastFn;
  private config: JoiConfig;
  private completedSummaries: CompletedSummary[] = [];
  private logBuffer = "";
  private startedAt = Date.now();
  private paused = false;
  private executorMode: AutoDevExecutorMode = AUTODEV_EXECUTOR_MODE;
  private parallelExecution: boolean = AUTODEV_PARALLEL_EXECUTION;
  private discussionMode: boolean = AUTODEV_DISCUSSION_MODE;
  private discussionMaxTurns: number = AUTODEV_DISCUSSION_MAX_TURNS;
  private currentExecutor: AutoDevExecutor | null = null;
  private currentRoute: AutoDevRouteDecision | null = null;
  private strictGeminiErrorSignal: string | null = null;
  private lastSkippedTaskSignature: string | null = null;
  private executorStates: Record<AutoDevExecutor, ExecutorRuntimeState> = {
    "claude-code": "idle",
    "gemini-cli": "idle",
    "codex-cli": "idle",
  };

  constructor(broadcast: BroadcastFn, config: JoiConfig) {
    this.broadcast = broadcast;
    this.config = config;
    this.executorMode = normalizeExecutorMode(config.autodev.executorMode, AUTODEV_EXECUTOR_MODE);
    this.parallelExecution = typeof config.autodev.parallelExecution === "boolean"
      ? config.autodev.parallelExecution
      : AUTODEV_PARALLEL_EXECUTION;
    this.discussionMode = typeof config.autodev.discussionMode === "boolean"
      ? config.autodev.discussionMode
      : AUTODEV_DISCUSSION_MODE;
    this.discussionMaxTurns = Number.isFinite(config.autodev.discussionMaxTurns)
      ? Math.min(5, Math.max(1, Math.floor(config.autodev.discussionMaxTurns)))
      : AUTODEV_DISCUSSION_MAX_TURNS;

    // Auto-start after a short delay to let the gateway finish initializing
    setTimeout(() => {
      try { this.init(); } catch (err) {
        console.error("[AutoDev] Init failed:", err);
      }
    }, 3_000);
  }

  // Safe wrapper for pickNext — ensures unhandled rejections never crash the process
  private safePickNext(): void {
    this.pickNext().catch((err) => {
      console.error("[AutoDev] Unhandled error in pickNext:", err);
      this.appendLog(`ERROR: ${(err as Error).message}`);
      this.state = "waiting";
      this.currentTask = null;
      this.currentExecutor = null;
      this.currentRoute = null;
      this.strictGeminiErrorSignal = null;
      this.resetExecutorStates();
      this.broadcastStatus();
      this.schedulePoll();
    });
  }

  private init(): void {
    this.appendLog(`AUTODEV INITIALIZED`);
    this.appendLog(`cwd: ${PROJECT_CWD}`);
    this.appendLog(`CLAUDE.md: ${PROJECT_CWD}/CLAUDE.md`);

    const vault = this.config.obsidian.vaultPath;
    if (vault) {
      const resolvedVault = vault.replace(/^~/, process.env.HOME || "/Users/mm2");
      const logDir = path.join(resolvedVault, DEV_LOG_DIR);
      this.appendLog(`Obsidian vault: ${vault}`);
      this.appendLog(`Dev log dir: ${DEV_LOG_DIR}/`);
      if (fs.existsSync(logDir)) {
        const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".md")).sort();
        this.appendLog(`Existing log files: ${files.length > 0 ? files.join(", ") : "(none yet)"}`);
      }
    } else {
      this.appendLog(`Obsidian vault: not configured`);
    }
    this.appendLog(`Memory system: enabled (episodes + solutions search)`);
    this.appendLog(`Context carryover: last ${MAX_CONTEXT_SUMMARIES} completed tasks`);
    this.appendLog(`Executor mode: ${this.executorMode} (claude-code + codex-cli + gemini-cli)`);
    this.appendLog(`Parallel execution: ${(this.parallelExecution && this.executorMode === "auto") ? "enabled (writer + shadow)" : "disabled"}`);
    this.appendLog(`Discussion mode: ${this.discussionMode ? `enabled (Codex<->Claude, max ${this.discussionMaxTurns} turns)` : "disabled"}`);
    this.appendLog(`Claude timeout: ${Math.round(AUTODEV_CLAUDE_TIMEOUT_MS / 1000)}s`);
    this.appendLog(`Codex timeout: ${Math.round(AUTODEV_CODEX_TIMEOUT_MS / 1000)}s`);
    this.appendLog(`Gemini timeout: ${Math.round(AUTODEV_GEMINI_TIMEOUT_MS / 1000)}s`);
    this.appendLog(`Polling for ${PROJECT_TITLE} tasks every ${POLL_INTERVAL_MS / 1000}s`);
    this.appendLog(`---`);

    this.resolveProject();
    this.broadcastStatus();
    this.safePickNext();
  }

  // Find the JOI project UUID from Things
  private resolveProject(): void {
    try {
      const projects = getProjects();
      const project = projects.find((p) => p.title === PROJECT_TITLE);
      if (project) {
        this.projectUuid = project.uuid;
        this.appendLog(`Project found: ${PROJECT_TITLE} (${project.uuid.slice(0, 8)}...)`);
      } else {
        this.appendLog(`WARNING: Project "${PROJECT_TITLE}" not found in Things`);
      }
    } catch (err) {
      this.appendLog(`WARNING: Could not read Things projects: ${(err as Error).message}`);
    }
  }

  // Append to persistent log buffer + broadcast to clients
  private appendLog(line: string): void {
    const ts = new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const entry = `[${ts}] ${line}\n`;
    this.logBuffer += entry;
    if (this.logBuffer.length > MAX_LOG_CHARS) {
      this.logBuffer = "--- log truncated ---\n" + this.logBuffer.slice(-MAX_LOG_CHARS * 0.8);
    }
    this.broadcast("autodev.log", { delta: entry } satisfies AutoDevLogData);
  }

  getLog(): string {
    return this.logBuffer;
  }

  private resetExecutorStates(): void {
    this.executorStates["claude-code"] = "idle";
    this.executorStates["gemini-cli"] = "idle";
    this.executorStates["codex-cli"] = "idle";
  }

  private setExecutorState(executor: AutoDevExecutor, state: ExecutorRuntimeState): void {
    this.executorStates[executor] = state;
    this.broadcastStatus();
  }

  private getActiveExecutors(): AutoDevExecutor[] {
    return (Object.entries(this.executorStates) as Array<[AutoDevExecutor, ExecutorRuntimeState]>)
      .filter(([, state]) => state === "running")
      .map(([executor]) => executor);
  }

  getSystemInfo(): {
    cwd: string;
    obsidianVault: string | null;
    devLogDir: string | null;
    devLogFile: string | null;
    memoryEnabled: boolean;
    startedAt: number;
    executorMode: AutoDevExecutorMode;
    parallelExecution: boolean;
    discussionMode: boolean;
    discussionMaxTurns: number;
    claudeModel: string | null;
    codexModel: string | null;
    geminiModel: string | null;
  } {
    const vaultPath = this.config.obsidian.vaultPath;
    const resolvedVault = vaultPath?.replace(/^~/, process.env.HOME || "/Users/mm2") || null;
    const today = new Date().toISOString().slice(0, 10);
    const logDir = resolvedVault ? path.join(resolvedVault, DEV_LOG_DIR) : null;
    const logFile = logDir ? path.join(logDir, `${today}.md`) : null;

    return {
      cwd: PROJECT_CWD,
      obsidianVault: vaultPath || null,
      devLogDir: logDir && fs.existsSync(logDir) ? DEV_LOG_DIR : null,
      devLogFile: logFile && fs.existsSync(logFile) ? `${DEV_LOG_DIR}/${today}.md` : null,
      memoryEnabled: true,
      startedAt: this.startedAt,
      executorMode: this.executorMode,
      parallelExecution: this.parallelExecution && this.executorMode === "auto",
      discussionMode: this.discussionMode,
      discussionMaxTurns: this.discussionMaxTurns,
      claudeModel: AUTODEV_CLAUDE_MODEL || null,
      codexModel: AUTODEV_CODEX_MODEL || null,
      geminiModel: AUTODEV_GEMINI_MODEL || null,
    };
  }

  getStatus(): AutoDevStatusData & { paused: boolean; systemInfo: ReturnType<AutoDevManager["getSystemInfo"]> } {
    return {
      state: this.state,
      paused: this.paused,
      projectUuid: this.projectUuid,
      projectTitle: this.projectTitle,
      currentTask: this.currentTask
        ? { uuid: this.currentTask.uuid, title: this.currentTask.title }
        : null,
      executorMode: this.executorMode,
      parallelExecution: this.parallelExecution && this.executorMode === "auto",
      currentExecutor: this.currentExecutor,
      activeExecutors: this.getActiveExecutors(),
      executorStates: this.executorStates,
      currentAgentId: this.currentRoute?.agentId || null,
      currentSkill: this.currentRoute?.skill || null,
      currentRouteReason: this.currentRoute?.reason || null,
      completedCount: this.completedCount,
      queue: this.queue.slice(0, 10).map((t) => ({ uuid: t.uuid, title: t.title })),
      systemInfo: this.getSystemInfo(),
    };
  }

  configureRuntime(update: Partial<AutoDevRuntimeConfig>, source = "runtime"): void {
    const prev = {
      executorMode: this.executorMode,
      parallelExecution: this.parallelExecution,
      discussionMode: this.discussionMode,
      discussionMaxTurns: this.discussionMaxTurns,
    };

    if (update.executorMode !== undefined) {
      this.executorMode = normalizeExecutorMode(update.executorMode, this.executorMode);
    }
    if (typeof update.parallelExecution === "boolean") {
      this.parallelExecution = update.parallelExecution;
    }
    if (typeof update.discussionMode === "boolean") {
      this.discussionMode = update.discussionMode;
    }
    if (update.discussionMaxTurns !== undefined && Number.isFinite(update.discussionMaxTurns)) {
      this.discussionMaxTurns = Math.min(5, Math.max(1, Math.floor(update.discussionMaxTurns)));
    }

    this.config.autodev = {
      ...this.config.autodev,
      executorMode: this.executorMode,
      parallelExecution: this.parallelExecution,
      discussionMode: this.discussionMode,
      discussionMaxTurns: this.discussionMaxTurns,
    };

    const changed = prev.executorMode !== this.executorMode
      || prev.parallelExecution !== this.parallelExecution
      || prev.discussionMode !== this.discussionMode
      || prev.discussionMaxTurns !== this.discussionMaxTurns;
    if (!changed) return;

    this.appendLog(
      `CONFIG UPDATED (${source}): mode=${this.executorMode}, parallel=${this.parallelExecution ? "on" : "off"}, discussion=${this.discussionMode ? "on" : "off"}, turns=${this.discussionMaxTurns}`,
    );
    if (this.state === "working") {
      this.appendLog(`Config update will apply fully to the next picked task.`);
    }
    this.broadcastStatus();
  }

  // Pause/resume: stops picking new tasks but doesn't kill current work
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.appendLog(`PAUSED — will finish current task then stop`);
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.nextTimer) { clearTimeout(this.nextTimer); this.nextTimer = null; }
    this.broadcastStatus();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.appendLog(`RESUMED — picking tasks again`);
    this.broadcastStatus();
    this.safePickNext();
  }

  // Graceful shutdown: clear all timers, abort current task, stop the loop
  shutdown(): void {
    this.paused = true;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.nextTimer) { clearTimeout(this.nextTimer); this.nextTimer = null; }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.state = "waiting";
    this.currentTask = null;
    this.currentExecutor = null;
    this.currentRoute = null;
    this.resetExecutorStates();
    this.appendLog(`SHUTDOWN — AutoDev stopped`);
    this.broadcastStatus();
  }

  // Stop current task (abort) — will auto-resume picking after
  stopCurrent(): void {
    if (this.state !== "working") return;
    this.appendLog(`STOPPING current task`);
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async pickNext(): Promise<void> {
    if (this.paused) return;

    // Resolve project if not yet found
    if (!this.projectUuid) {
      this.resolveProject();
      if (!this.projectUuid) {
        this.schedulePoll();
        return;
      }
    }

    this.currentTask = null;
    this.currentExecutor = null;
    this.currentRoute = null;
    this.strictGeminiErrorSignal = null;
    this.resetExecutorStates();

    try {
      const allTasks = getActiveTasks();
      const projectTasks = allTasks.filter((t) => t.projectUuid === this.projectUuid);
      const runnable = projectTasks.filter((t) => this.isAutoDevSectionTask(t));
      const skipped = projectTasks.filter((t) => !this.isAutoDevSectionTask(t));

      this.queue = runnable;

      if (skipped.length > 0) {
        const signature = skipped.map((t) => t.uuid).join(",");
        if (signature !== this.lastSkippedTaskSignature) {
          const preview = skipped
            .slice(0, 3)
            .map((t) => `"${t.title}" (section: ${t.headingTitle || "none"})`)
            .join("; ");
          this.appendLog(
            `Skipping ${skipped.length} task(s) outside AutoDev sections (Claude/Gemini/Codex).`,
          );
          this.appendLog(`Skipped examples: ${preview}${skipped.length > 3 ? " ..." : ""}`);
          this.lastSkippedTaskSignature = signature;
        }
      } else {
        this.lastSkippedTaskSignature = null;
      }

      if (this.queue.length === 0) {
        this.state = "waiting";
        this.broadcastStatus();
        this.schedulePoll();
        return;
      }

      // Only show "picking" when there's actually a task to pick
      this.state = "picking";
      this.broadcastStatus();

      const task = this.queue.shift()!;
      this.currentTask = task;
      console.log(`[AutoDev] Picked task: ${task.title}`);
      this.appendLog(`PICKED TASK: ${task.title} (${this.queue.length} remaining in queue)`);
      await this.workOnTask(task);
    } catch (err) {
      this.broadcastError(`Failed to pick next task: ${(err as Error).message}`);
      this.scheduleNext();
    }
  }

  // Poll for new tasks when queue is empty
  private schedulePoll(): void {
    if (this.paused) return;
    if (this.pollTimer) return; // Already scheduled
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.safePickNext();
    }, POLL_INTERVAL_MS);
  }

  private handleExecutionStream(taskUuid: string, delta: string): void {
    this.captureStrictGeminiErrorSignal(delta);
    this.logBuffer += delta;
    if (this.logBuffer.length > MAX_LOG_CHARS) {
      this.logBuffer = "--- log truncated ---\n" + this.logBuffer.slice(-MAX_LOG_CHARS * 0.8);
    }
    this.broadcast("autodev.log", {
      delta,
      taskUuid,
    } satisfies AutoDevLogData);
  }

  private getFallbackExecutors(executor: AutoDevExecutor): AutoDevExecutor[] {
    switch (executor) {
      case "claude-code":
        return ["codex-cli", "gemini-cli"];
      case "codex-cli":
        return ["claude-code", "gemini-cli"];
      case "gemini-cli":
        return ["claude-code", "codex-cli"];
      default:
        return ["claude-code"];
    }
  }

  private getExecutorOutputStartMarker(executor: AutoDevExecutor): string {
    return `--- ${executor.toUpperCase()} OUTPUT START ---`;
  }

  private getExecutorOutputEndMarker(executor: AutoDevExecutor): string {
    return `--- ${executor.toUpperCase()} OUTPUT END ---`;
  }

  private isAutoDevSectionTask(task: ThingsTask): boolean {
    const heading = (task.headingTitle || "").trim().toLowerCase();
    if (!heading) return false;
    return heading === "claude" || heading === "gemini" || heading === "codex";
  }

  private getExecutorSignatureTag(executor: AutoDevExecutor): string {
    if (executor === "codex-cli") return "done-by-codex";
    if (executor === "gemini-cli") return "done-by-gemini";
    return "done-by-claude";
  }

  private buildShadowPrompt(prompt: string): string {
    return [
      prompt,
      ``,
      `### Shadow Mode`,
      `You are running as an advisory peer for cross-check only.`,
      `Do not modify files, do not run write operations, do not commit.`,
      `Provide concrete implementation guidance and risks in concise bullets.`,
    ].join("\n");
  }

  private buildShadowSystemPrompt(systemPrompt: string): string {
    return [
      systemPrompt,
      ``,
      `## Shadow Constraints`,
      `Operate in read-only advisory mode. No file writes, no commits, no destructive terminal commands.`,
      `Focus on verifying approach and suggesting improvements.`,
    ].join("\n");
  }

  private clipDiscussionContent(text: string, maxChars = 1400): string {
    const normalized = text.replace(/\r/g, "\n").trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}\n...[truncated]`;
  }

  private buildDiscussionTurnPrompt(
    taskPrompt: string,
    turns: DiscussionTurn[],
    turn: number,
    executor: "codex-cli" | "claude-code",
  ): string {
    const priorTurns = turns
      .slice(-2)
      .map((entry) => [
        `### Previous Turn ${entry.turn} (${entry.executor})`,
        this.clipDiscussionContent(entry.content, 1000),
      ].join("\n"))
      .join("\n\n");

    return [
      `You are in AutoDev discussion mode. This is a short planning debate before implementation.`,
      `Turn ${turn}/${this.discussionMaxTurns}. Speaker: ${executor}.`,
      ``,
      `Output format (required):`,
      `1. PLAN: concise implementation approach (3-6 bullets).`,
      `2. RISKS: major failure risks and mitigations (1-4 bullets).`,
      `3. READY: yes|no`,
      ``,
      `Task context:`,
      taskPrompt,
      priorTurns ? `\n${priorTurns}` : "",
      ``,
      `Important: keep this discussion concise and implementation-focused.`,
    ].join("\n");
  }

  private buildDiscussionTurnSystemPrompt(
    baseSystemPrompt: string,
    turn: number,
  ): string {
    return [
      baseSystemPrompt,
      ``,
      `## Discussion Mode Constraints`,
      `- Read-only discussion only. Do not edit files and do not run write operations.`,
      `- Do not commit, push, or perform destructive commands.`,
      `- Keep output compact and actionable.`,
      `- This is discussion turn ${turn}/${this.discussionMaxTurns}; the final execution will be done by Codex.`,
    ].join("\n");
  }

  private isDiscussionReady(content: string): boolean {
    return /\bready\s*[:=]\s*(yes|true|1)\b/i.test(content) || /\[ready_to_implement\]/i.test(content);
  }

  private buildExecutionPromptWithDiscussion(taskPrompt: string, turns: DiscussionTurn[]): string {
    if (turns.length === 0) return taskPrompt;
    const transcript = turns.map((entry) => [
      `### Turn ${entry.turn} (${entry.executor})`,
      this.clipDiscussionContent(entry.content),
    ].join("\n")).join("\n\n");
    return [
      taskPrompt,
      ``,
      `## Codex-Claude Discussion Transcript`,
      transcript,
      ``,
      `Discussion is complete. Execute the task now.`,
      `Use the transcript as guidance, then implement, verify, and summarize.`,
    ].join("\n");
  }

  private buildExecutionSystemPromptWithDiscussion(baseSystemPrompt: string): string {
    return [
      baseSystemPrompt,
      ``,
      `## Final Execution Directive`,
      `- Discussion phase is complete.`,
      `- Implement directly now as Codex executor.`,
      `- Do not continue the debate; focus on concrete code changes and verification.`,
    ].join("\n");
  }

  private async runCodexClaudeDiscussion(
    taskPrompt: string,
    systemPrompt: string,
    taskUuid: string,
  ): Promise<DiscussionTurn[]> {
    const turns: DiscussionTurn[] = [];
    const sequence: Array<"codex-cli" | "claude-code"> = ["codex-cli", "claude-code"];

    for (let i = 0; i < this.discussionMaxTurns; i++) {
      const turn = i + 1;
      const executor = sequence[i % sequence.length];
      this.currentExecutor = executor;
      if (this.currentRoute) {
        this.currentRoute = {
          ...this.currentRoute,
          executor,
          agentId: getAutoDevAgentId(executor),
          reason: `Discussion mode turn ${turn}/${this.discussionMaxTurns} (${executor}). Final executor: codex-cli.`,
        };
      }
      this.broadcastStatus();
      this.appendLog(`Discussion turn ${turn}/${this.discussionMaxTurns} -> ${executor}`);

      const turnPrompt = this.buildDiscussionTurnPrompt(taskPrompt, turns, turn, executor);
      const turnSystemPrompt = this.buildDiscussionTurnSystemPrompt(systemPrompt, turn);
      const result = await this.executeTaskWithExecutor(executor, turnPrompt, turnSystemPrompt, taskUuid);
      const content = result.content.trim();
      turns.push({ turn, executor, content });

      const ready = this.isDiscussionReady(content);
      this.appendLog(`Discussion turn ${turn} ready=${ready ? "yes" : "no"}`);
      if (ready && turn >= 2) {
        this.appendLog(`Discussion reached readiness at turn ${turn}.`);
        break;
      }
    }

    return turns;
  }

  private async executeTaskWithExecutor(
    executor: AutoDevExecutor,
    prompt: string,
    systemPrompt: string,
    taskUuid: string,
  ): Promise<TaskExecutionResult> {
    this.setExecutorState(executor, "running");
    this.appendLog(this.getExecutorOutputStartMarker(executor));

    try {
      if (executor === "codex-cli") {
        const result = await runCodexCli({
          userMessage: prompt,
          systemPrompt,
          cwd: PROJECT_CWD,
          model: AUTODEV_CODEX_MODEL,
          timeoutMs: AUTODEV_CODEX_TIMEOUT_MS,
          signal: this.abortController?.signal,
          onStream: (delta) => this.handleExecutionStream(taskUuid, delta),
        });
        this.setExecutorState(executor, "success");
        this.appendLog(this.getExecutorOutputEndMarker(executor));
        return { ...result, executor };
      }

      if (executor === "gemini-cli") {
        const result = await runGeminiCli({
          userMessage: prompt,
          systemPrompt,
          cwd: PROJECT_CWD,
          model: AUTODEV_GEMINI_MODEL,
          timeoutMs: AUTODEV_GEMINI_TIMEOUT_MS,
          signal: this.abortController?.signal,
          onStream: (delta) => this.handleExecutionStream(taskUuid, delta),
        });
        this.setExecutorState(executor, "success");
        this.appendLog(this.getExecutorOutputEndMarker(executor));
        return { ...result, executor };
      }

      const result = await runClaudeCode({
        userMessage: prompt,
        systemPrompt,
        cwd: PROJECT_CWD,
        model: AUTODEV_CLAUDE_MODEL,
        timeoutMs: AUTODEV_CLAUDE_TIMEOUT_MS,
        signal: this.abortController?.signal,
        onStream: (delta) => this.handleExecutionStream(taskUuid, delta),
      });
      this.setExecutorState(executor, "success");
      this.appendLog(this.getExecutorOutputEndMarker(executor));
      return { ...result, executor };
    } catch (err) {
      const message = (err as Error).message;
      this.setExecutorState(executor, "error");
      this.appendLog(`Executor ${executor} failed: ${message}`);
      this.appendLog(this.getExecutorOutputEndMarker(executor));
      throw err;
    }
  }

  private async executeWithFallback(
    preferred: AutoDevExecutor,
    prompt: string,
    systemPrompt: string,
    taskUuid: string,
    options?: { allowFallback?: boolean },
  ): Promise<TaskExecutionResult> {
    const allowFallback = options?.allowFallback !== false;
    this.currentExecutor = preferred;
    this.broadcastStatus();
    const failureMessages: string[] = [];

    try {
      return await this.executeTaskWithExecutor(preferred, prompt, systemPrompt, taskUuid);
    } catch (primaryErr) {
      const primaryMessage = (primaryErr as Error).message;
      failureMessages.push(`${preferred}: ${primaryMessage}`);
      if (!allowFallback || this.executorMode !== "auto") throw primaryErr;
      this.appendLog(`Primary executor ${preferred} failed: ${primaryMessage}`);
    }

    const fallbackExecutors = this.getFallbackExecutors(preferred);
    for (const fallback of fallbackExecutors) {
      this.appendLog(`Trying fallback executor ${fallback}...`);
      const previousMessage = failureMessages[failureMessages.length - 1] || "";
      const shortMessage = previousMessage.length > 180
        ? `${previousMessage.slice(0, 177)}...`
        : previousMessage;

      this.currentExecutor = fallback;
      if (this.currentRoute) {
        this.currentRoute = {
          ...this.currentRoute,
          executor: fallback,
          agentId: getAutoDevAgentId(fallback),
          reason: `Fallback to ${fallback}: ${shortMessage}`,
        };
      }
      this.broadcastStatus();

      try {
        return await this.executeTaskWithExecutor(fallback, prompt, systemPrompt, taskUuid);
      } catch (fallbackErr) {
        const fallbackMessage = (fallbackErr as Error).message;
        failureMessages.push(`${fallback}: ${fallbackMessage}`);
        this.appendLog(`Fallback executor ${fallback} failed: ${fallbackMessage}`);
      }
    }

    throw new Error(`All executors failed: ${failureMessages.join(" | ")}`);
  }

  private async executeInParallelWithShadow(
    preferred: AutoDevExecutor,
    prompt: string,
    systemPrompt: string,
    taskUuid: string,
  ): Promise<TaskExecutionResult> {
    const fallbackExecutors = this.getFallbackExecutors(preferred);
    const shadow = fallbackExecutors[0];
    if (!shadow) {
      return await this.executeWithFallback(preferred, prompt, systemPrompt, taskUuid);
    }
    const shadowPrompt = this.buildShadowPrompt(prompt);
    const shadowSystemPrompt = this.buildShadowSystemPrompt(systemPrompt);

    this.appendLog(`Parallel mode: writer=${preferred}, shadow=${shadow} (advisory).`);
    this.currentExecutor = preferred;
    this.broadcastStatus();

    const primaryPromise = this.executeTaskWithExecutor(preferred, prompt, systemPrompt, taskUuid);
    const shadowPromise = this.executeTaskWithExecutor(shadow, shadowPrompt, shadowSystemPrompt, taskUuid);

    const [primaryResult, shadowResult] = await Promise.allSettled([primaryPromise, shadowPromise]);

    if (shadowResult.status === "fulfilled") {
      const shadowSummary = extractSummary(shadowResult.value.content).replace(/\s+/g, " ").trim();
      if (shadowSummary) {
        this.appendLog(`[Shadow ${shadow}] ${shadowSummary.slice(0, 260)}`);
      }
    } else {
      const shadowMessage = shadowResult.reason instanceof Error
        ? shadowResult.reason.message
        : String(shadowResult.reason);
      this.appendLog(`[Shadow ${shadow}] failed: ${shadowMessage}`);
    }

    if (primaryResult.status === "fulfilled") {
      return primaryResult.value;
    }

    const primaryMessage = primaryResult.reason instanceof Error
      ? primaryResult.reason.message
      : String(primaryResult.reason);

    this.appendLog(`Primary executor ${preferred} failed in parallel mode: ${primaryMessage}`);

    if (shadowResult.status === "fulfilled") {
      this.appendLog(`Retrying task on ${shadow} in writer mode after primary failure...`);
      this.currentExecutor = shadow;
      if (this.currentRoute) {
        this.currentRoute = {
          ...this.currentRoute,
          executor: shadow,
          agentId: getAutoDevAgentId(shadow),
          reason: `Parallel fallback: primary ${preferred} failed; switched to ${shadow}.`,
        };
      }
      this.broadcastStatus();
      return await this.executeWithFallback(shadow, prompt, systemPrompt, taskUuid);
    }

    const tertiary = fallbackExecutors[1];
    if (tertiary) {
      this.appendLog(`Primary and shadow failed. Trying tertiary executor ${tertiary}...`);
      this.currentExecutor = tertiary;
      if (this.currentRoute) {
        this.currentRoute = {
          ...this.currentRoute,
          executor: tertiary,
          agentId: getAutoDevAgentId(tertiary),
          reason: `Parallel tertiary fallback: ${preferred} and ${shadow} failed; switched to ${tertiary}.`,
        };
      }
      this.broadcastStatus();
      try {
        return await this.executeTaskWithExecutor(tertiary, prompt, systemPrompt, taskUuid);
      } catch (tertiaryErr) {
        const tertiaryMessage = tertiaryErr instanceof Error ? tertiaryErr.message : String(tertiaryErr);
        const shadowMessage = shadowResult.reason instanceof Error
          ? shadowResult.reason.message
          : String(shadowResult.reason);
        throw new Error(`Parallel execution failed: ${preferred}: ${primaryMessage} | ${shadow}: ${shadowMessage} | ${tertiary}: ${tertiaryMessage}`);
      }
    }

    const shadowMessage = shadowResult.reason instanceof Error
      ? shadowResult.reason.message
      : String(shadowResult.reason);
    throw new Error(`Parallel execution failed: ${preferred}: ${primaryMessage} | ${shadow}: ${shadowMessage}`);
  }

  private async workOnTask(task: ThingsTask): Promise<void> {
    this.state = "working";
    this.abortController = new AbortController();
    this.resetExecutorStates();
    this.strictGeminiErrorSignal = null;
    const routed = routeAutoDevTask(task, this.executorMode);
    if (this.discussionMode) {
      this.currentRoute = {
        ...routed,
        executor: "codex-cli",
        agentId: getAutoDevAgentId("codex-cli"),
        strict: true,
        reason: `Discussion mode enabled (Codex<->Claude, max ${this.discussionMaxTurns} turns). Original route: ${routed.executor}. Final executor forced to codex-cli.`,
      };
    } else {
      this.currentRoute = routed;
    }
    this.currentExecutor = this.currentRoute.executor;
    this.broadcastStatus();

    // Build prompt from task details
    const parts: string[] = [];
    parts.push(`## Task: ${task.title}`);
    if (task.notes) parts.push(`\n### Notes\n${task.notes}`);
    if (task.checklist.length > 0) {
      parts.push(`\n### Checklist`);
      for (const ci of task.checklist) {
        parts.push(`- [${ci.completed ? "x" : " "}] ${ci.title}`);
      }
    }
    parts.push(`\nComplete the task described above. Be thorough but concise.`);
    parts.push(`When done, output a brief summary of what you did (2-3 sentences max).`);

    const prompt = parts.join("\n");
    const taskTags = task.tags.length > 0 ? task.tags.join(", ") : "none";
    this.appendLog(
      `Task metadata: project="${task.projectTitle || "none"}", section="${task.headingTitle || "none"}", tags=${taskTags}`,
    );

    this.appendLog(
      `Routing task -> ${this.currentRoute.executor} (agent=${this.currentRoute.agentId}, skill=${this.currentRoute.skill}, strict=${this.currentRoute.strict ? "yes" : "no"}, scores c:${this.currentRoute.claudeScore} x:${this.currentRoute.codexScore} g:${this.currentRoute.geminiScore})`,
    );
    this.appendLog(`Route reason: ${this.currentRoute.reason}`);
    this.appendLog(`Building system prompt (searching Obsidian + memories)...`);
    const systemPrompt = await this.buildSystemPrompt(task);
    const parallelEnabled = this.parallelExecution
      && this.executorMode === "auto"
      && !this.currentRoute.strict
      && !this.discussionMode;
    if (this.currentRoute.strict && this.parallelExecution && this.executorMode === "auto") {
      this.appendLog(`Strict route detected — shadow parallel execution disabled for this task.`);
    }
    if (this.discussionMode) {
      this.appendLog(`Discussion mode active - routing uses Codex<->Claude discussion before Codex execution.`);
    }
    this.appendLog(
      `System prompt ready (${systemPrompt.length} chars). Launching ${parallelEnabled ? "parallel writer+shadow execution" : this.currentRoute.executor}...`,
    );

    try {
      const preferred = this.currentRoute.executor;
      let result: TaskExecutionResult;
      if (this.discussionMode) {
        const discussionTurns = await this.runCodexClaudeDiscussion(prompt, systemPrompt, task.uuid);
        const executionPrompt = this.buildExecutionPromptWithDiscussion(prompt, discussionTurns);
        const executionSystemPrompt = this.buildExecutionSystemPromptWithDiscussion(systemPrompt);
        this.currentExecutor = "codex-cli";
        if (this.currentRoute) {
          this.currentRoute = {
            ...this.currentRoute,
            executor: "codex-cli",
            agentId: getAutoDevAgentId("codex-cli"),
            reason: `Discussion mode complete (${discussionTurns.length} turn(s)); executing with codex-cli.`,
          };
        }
        this.broadcastStatus();
        this.appendLog(`Discussion complete (${discussionTurns.length} turn(s)). Launching codex-cli for final execution...`);
        result = await this.executeTaskWithExecutor("codex-cli", executionPrompt, executionSystemPrompt, task.uuid);
      } else {
        result = parallelEnabled
          ? await this.executeInParallelWithShadow(preferred, prompt, systemPrompt, task.uuid)
          : await this.executeWithFallback(preferred, prompt, systemPrompt, task.uuid, { allowFallback: !this.currentRoute.strict });
      }

      this.abortController = null;
      this.currentExecutor = result.executor;
      if (this.currentRoute?.executor === "gemini-cli" && this.currentRoute.strict) {
        const blockingError = this.detectStrictGeminiBlockingError(result.content);
        if (blockingError) {
          throw new Error(`Strict Gemini policy blocked completion due to runtime error signal: ${blockingError}`);
        }
      }
      if (result.executor !== preferred) {
        this.appendLog(`Route switched to fallback executor ${result.executor}.`);
      }

      this.appendLog(`Model/provider: ${result.model} / ${result.provider}`);
      this.appendLog(`Tokens: ${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out`);

      await this.completeTaskAndLog(task, result);
    } catch (err) {
      this.abortController = null;
      const msg = (err as Error).message;
      if (msg.includes("aborted")) {
        if (this.currentRoute?.executor === "gemini-cli" && this.currentRoute.strict && this.strictGeminiErrorSignal) {
          const policyMessage = `Strict Gemini stream error signal: ${this.strictGeminiErrorSignal}`;
          this.appendLog(`${policyMessage} — stopping and escalating for manual follow-up.`);
          this.broadcastError(policyMessage, task.uuid);
          await this.escalateRuntimeError(task, policyMessage, "execution");
          await this.finalizeStrictGeminiFailure(task, policyMessage);
          this.scheduleNext();
          return;
        }
        this.appendLog(`Task aborted by user`);
      } else {
        console.error(`[AutoDev] Error working on task "${task.title}":`, msg);
        this.appendLog(`ERROR: ${msg}`);
        this.broadcastError(msg, task.uuid);
        await this.escalateRuntimeError(task, msg, "execution");

        if (this.currentRoute?.executor === "gemini-cli" && this.currentRoute.strict) {
          this.appendLog(`Strict Gemini policy: do not self-repair. Stopping task and escalating for manual follow-up.`);
          await this.finalizeStrictGeminiFailure(task, msg);
          this.scheduleNext();
          return;
        }

        // For spawn failures, wait longer before retrying
        if (msg.includes("posix_spawnp") || msg.includes("Failed to spawn")) {
          this.appendLog(`Spawn failure — will retry in 60s`);
          this.state = "waiting";
          this.currentTask = null;
          this.currentExecutor = null;
          this.currentRoute = null;
          this.resetExecutorStates();
          this.broadcastStatus();
          this.nextTimer = setTimeout(() => {
            this.nextTimer = null;
            this.safePickNext();
          }, 60_000);
          return;
        }
      }
      this.scheduleNext();
    }
  }

  private captureStrictGeminiErrorSignal(delta: string): void {
    if (this.strictGeminiErrorSignal) return;
    if (this.currentRoute?.executor !== "gemini-cli" || !this.currentRoute.strict) return;
    const signal = this.detectStrictGeminiBlockingError(delta);
    if (!signal) return;

    this.strictGeminiErrorSignal = signal;
    this.appendLog(`Strict Gemini policy detected blocking error signal: ${signal}`);
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  private detectStrictGeminiBlockingError(text: string): string | null {
    const normalized = text.replace(/\r/g, "\n");
    const patterns: RegExp[] = [
      /(^|\n)\s*❌\s*[^\n]*/i,
      /(^|\n)\s*error:\s*[^\n]*/i,
      /(^|\n)\s*failed to\s+[^\n]*/i,
      /(^|\n)\s*error listing [^\n]*/i,
      /(^|\n)\s*bash:\s*[^\n]*command not found[^\n]*/i,
      /duplicate key value violates unique constraint[^\n]*/i,
      /column\s+"[^"]+"\s+of relation\s+"[^"]+"\s+does not exist[^\n]*/i,
      /\b(ENOENT|EACCES|ECONNREFUSED)\b[^\n]*/i,
      /no such file or directory[^\n]*/i,
      /resource_exhausted|quota exceeded|429\b/i,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const excerpt = match[0].replace(/\s+/g, " ").trim();
        if (excerpt) return excerpt.slice(0, 500);
      }
    }
    return null;
  }

  private async buildSystemPrompt(task: ThingsTask): Promise<string> {
    const sections: string[] = [];

    sections.push(
      `You are AutoDev, an autonomous developer agent working on the "${this.projectTitle}" project.`,
      `Complete each task thoroughly. Output clean, production-ready code.`,
      `After making changes, commit them with a concise message. Do NOT push to remote. Do NOT create new branches.`,
    );

    if (this.currentRoute?.executor === "gemini-cli") {
      sections.push(
        `\n## Gemini Execution Policy`,
        `- You are not the final authority for complex coding recovery decisions.`,
        `- If any blocking error occurs (schema mismatch, duplicate key, missing column, tool failure, permission error), STOP immediately.`,
        `- Do not attempt self-repair loops or speculative fixes after a hard failure.`,
        `- Return a concise failure report with the exact error so the system can escalate to Quality and Claude.`,
      );
      if (this.currentRoute.strict) {
        sections.push(
          `- This task is STRICTLY routed to Gemini by section/tag policy; no cross-model self-fix attempts.`,
        );
      }
    }

    if (this.currentRoute?.executor === "codex-cli") {
      sections.push(
        `\n## Codex Execution Policy`,
        `- You are operating as a primary implementation executor inside AutoDev.`,
        `- Keep command output concise and structured so the split-log UI remains readable.`,
        `- If a hard blocker occurs, report exact failure context and stop speculative loops.`,
        `- Prefer deterministic file edits and explicit verification (typecheck/tests) before completion.`,
      );
      if (this.currentRoute.strict) {
        sections.push(
          `- This task is STRICTLY routed to Codex by section/tag policy; stay on-scope and finish in this lane.`,
        );
      }
    }

    if (this.completedSummaries.length > 0) {
      const recent = this.completedSummaries.slice(-MAX_CONTEXT_SUMMARIES);
      sections.push(`\n## Previously Completed Tasks (this session)`);
      for (const s of recent) {
        sections.push(`- **${s.title}** (${s.timestamp}): ${s.summary}`);
      }
    }

    try {
      const obsidianContext = await this.findObsidianContext(task.title);
      if (obsidianContext) {
        sections.push(`\n## Relevant Project Notes\n${obsidianContext}`);
      }
    } catch {
      // Non-critical
    }

    try {
      const memoryContext = await this.findMemoryContext(task.title);
      if (memoryContext) {
        sections.push(`\n## Relevant Knowledge\n${memoryContext}`);
      }
    } catch {
      // Non-critical
    }

    return sections.join("\n");
  }

  private async findObsidianContext(taskTitle: string): Promise<string | null> {
    const vaultPath = this.config.obsidian.vaultPath;
    if (!vaultPath) return null;

    const resolvedVault = vaultPath.replace(/^~/, process.env.HOME || "/Users/mm2");
    const projectDir = path.join(resolvedVault, "🏆 Projects/joi");

    if (!fs.existsSync(projectDir)) return null;

    const keywords = taskTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (keywords.length === 0) return null;

    const notes: string[] = [];
    try {
      const files = fs.readdirSync(projectDir, { recursive: true }) as string[];
      for (const file of files) {
        if (!String(file).endsWith(".md")) continue;
        const filePath = path.join(projectDir, String(file));
        const content = fs.readFileSync(filePath, "utf-8");
        const lower = content.toLowerCase();
        if (keywords.some((kw) => lower.includes(kw))) {
          const snippet = content.slice(0, 300).trim();
          notes.push(`### ${file}\n${snippet}`);
          if (notes.length >= 3) break;
        }
      }
    } catch {
      return null;
    }

    return notes.length > 0 ? notes.join("\n\n") : null;
  }

  private async findMemoryContext(taskTitle: string): Promise<string | null> {
    const results = await searchMemories(
      {
        query: taskTitle,
        areas: ["solutions", "knowledge"],
        limit: 3,
      },
      this.config,
    );

    if (results.length === 0) return null;

    return results
      .map((r) => `- ${r.memory.summary || r.memory.content.slice(0, 200)}`)
      .join("\n");
  }

  private async completeTaskAndLog(task: ThingsTask, result: TaskExecutionResult): Promise<void> {
    this.state = "completing";
    this.broadcastStatus();

    try {
      const summary = extractSummary(result.content);
      const timestamp = new Date().toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });
      const executorAgent = getAutoDevAgentId(result.executor);
      const routeSkill = this.currentRoute?.skill || "n/a";
      const routeReason = this.currentRoute?.reason || "n/a";
      const noteBlock = [
        "",
        "---",
        `[AutoDev ${timestamp}] DONE`,
        `Executor: ${result.executor}`,
        `Agent: ${executorAgent}`,
        `Provider/Model: ${result.provider} / ${result.model}`,
        `Route Skill: ${routeSkill}`,
        `Route Reason: ${routeReason}`,
        "",
        summary,
      ].join("\n");

      await updateTask(task.uuid, {
        appendNotes: noteBlock,
        addTags: ["autodev", "autodev-done", this.getExecutorSignatureTag(result.executor)],
      });
      await sleep(500);
      await completeTask(task.uuid);

      this.completedCount++;
      this.completedSummaries.push({ title: task.title, summary, timestamp });

      this.broadcast("autodev.task_complete", {
        taskUuid: task.uuid,
        taskTitle: task.title,
        summary,
        completedCount: this.completedCount,
      } satisfies AutoDevTaskCompleteData);

      console.log(`[AutoDev] Completed task: ${task.title} (${this.completedCount} total)`);
      this.appendLog(`TASK COMPLETE: ${task.title} (#${this.completedCount})`);
      this.appendLog(`Summary: ${summary.slice(0, 200)}`);

      this.writeDevLog(task, summary, result.usage)
        .then(() => this.appendLog(`Obsidian dev log updated`))
        .catch((err) => {
          console.warn(`[AutoDev] Failed to write dev log:`, err);
          this.appendLog(`WARNING: Failed to write Obsidian dev log: ${(err as Error).message}`);
        });
      this.writeEpisodeMemory(task, summary)
        .then(() => this.appendLog(`Episode memory written`))
        .catch((err) => {
          console.warn(`[AutoDev] Failed to write episode memory:`, err);
          this.appendLog(`WARNING: Failed to write episode memory: ${(err as Error).message}`);
        });

      this.appendLog(`Waiting ${NEXT_TASK_DELAY_MS / 1000}s before next task...`);
      this.appendLog(`---`);
      this.scheduleNext();
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[AutoDev] Error completing task "${task.title}":`, msg);
      this.appendLog(`ERROR (completion): ${msg}`);
      this.broadcastError(msg, task.uuid);
      await this.escalateRuntimeError(task, msg, "completion");
      this.scheduleNext();
    }
  }

  private async writeDevLog(
    task: ThingsTask,
    summary: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    const vaultPath = this.config.obsidian.vaultPath;
    if (!vaultPath) return;

    const resolvedVault = vaultPath.replace(/^~/, process.env.HOME || "/Users/mm2");
    const logDir = path.join(resolvedVault, DEV_LOG_DIR);
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `${today}.md`);
    const now = new Date().toLocaleString("de-AT", { timeStyle: "short" });

    fs.mkdirSync(logDir, { recursive: true });

    const entry = [
      `\n## ${now} — ${task.title}`,
      ``,
      summary,
      ``,
      `> Tokens: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`,
      ``,
    ].join("\n");

    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, entry);
    } else {
      const header = `# AutoDev Log — ${today}\n\nProject: **${this.projectTitle}**\n`;
      fs.writeFileSync(logFile, header + entry);
    }

    console.log(`[AutoDev] Dev log written to ${logFile}`);
  }

  private async writeEpisodeMemory(task: ThingsTask, summary: string): Promise<void> {
    await writeMemory(
      {
        area: "episodes",
        content: `AutoDev completed task "${task.title}" in project "${this.projectTitle}": ${summary}`,
        summary: `AutoDev: ${task.title} — ${summary.slice(0, 150)}`,
        tags: ["autodev", this.projectTitle],
        source: "episode",
        confidence: 0.6,
      },
      this.config,
    );
  }

  private scheduleNext(): void {
    if (this.paused) {
      this.state = "waiting";
      this.currentTask = null;
      this.currentExecutor = null;
      this.currentRoute = null;
      this.strictGeminiErrorSignal = null;
      this.resetExecutorStates();
      this.broadcastStatus();
      return;
    }

    this.state = "waiting";
    this.currentTask = null;
    this.currentExecutor = null;
    this.currentRoute = null;
    this.strictGeminiErrorSignal = null;
    this.resetExecutorStates();
    this.broadcastStatus();

    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.safePickNext();
    }, NEXT_TASK_DELAY_MS);
  }

  private broadcastStatus(): void {
    this.broadcast("autodev.status", this.getStatus());
  }

  private async escalateRuntimeError(
    task: ThingsTask,
    error: string,
    phase: "execution" | "completion",
  ): Promise<void> {
    const ts = new Date().toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });
    const routeSummary = this.currentRoute
      ? `${this.currentRoute.executor} (agent=${this.currentRoute.agentId}, strict=${this.currentRoute.strict ? "yes" : "no"})`
      : (this.currentExecutor || "n/a");
    const note = [
      ``,
      `---`,
      `[AutoDev ${ts}] Runtime error (${phase})`,
      `Executor: ${routeSummary}`,
      `Error: ${error.slice(0, 1200)}`,
    ].join("\n");

    try {
      await updateTask(task.uuid, { appendNotes: note, addTags: ["autodev-error"] });
      this.appendLog(`Runtime failure logged to task notes.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(`WARNING: Failed to append runtime error note to task: ${message}`);
    }
  }

  private async finalizeStrictGeminiFailure(
    task: ThingsTask,
    error: string,
  ): Promise<void> {
    try {
      const ts = new Date().toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });
      const note = [
        ``,
        `---`,
        `[AutoDev ${ts}] Strict Gemini route failed and was escalated.`,
        `Escalation: manual follow-up required (Quality module removed).`,
        `Policy: No Gemini self-repair.`,
        `Error: ${error.slice(0, 600)}`,
      ].join("\n");

      await updateTask(task.uuid, { appendNotes: note, addTags: ["escalated", "gemini-failed"] });
      await sleep(300);
      await completeTask(task.uuid);
      this.appendLog(`Closed strict Gemini task after escalation note: ${task.title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(`WARNING: Failed to close strict Gemini task after escalation: ${message}`);
    }
  }

  private broadcastError(error: string, taskUuid?: string): void {
    this.broadcast("autodev.error", { error, taskUuid } satisfies AutoDevErrorData);
  }
}

function extractSummary(output: string): string {
  const paragraphs = output.split(/\n\n+/).filter((p) => p.trim().length > 20);
  const last = paragraphs[paragraphs.length - 1] || output;
  return last.trim().slice(0, 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
