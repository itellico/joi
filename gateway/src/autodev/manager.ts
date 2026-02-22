// AutoDev Manager — always-on sequential task developer using Claude Code CLI
// Runs continuously: picks tasks from the JOI project, works on them, loops.
// State machine: waiting → picking → working → completing → waiting (loop)

import fs from "node:fs";
import path from "node:path";
import { runClaudeCode } from "../agent/claude-code.js";
import {
  getActiveTasks,
  getProjects,
  updateTask,
  completeTask,
  type ThingsTask,
  type ThingsProject,
} from "../things/client.js";
import { writeMemory } from "../knowledge/writer.js";
import { searchMemories } from "../knowledge/searcher.js";
import type { JoiConfig } from "../config/schema.js";
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

const PROJECT_TITLE = "JOI";
const POLL_INTERVAL_MS = 30_000; // Check for new tasks every 30s when idle
const NEXT_TASK_DELAY_MS = 5_000; // Delay between tasks
const PROJECT_CWD = "~/dev_mm/joi";
const DEV_LOG_DIR = "_Claude/AutoDev";
const MAX_CONTEXT_SUMMARIES = 5;
const MAX_LOG_CHARS = 500_000;
const AUTODEV_CLAUDE_TIMEOUT_MS = readTimeoutFromEnv("JOI_AUTODEV_CLAUDE_TIMEOUT_MS", 30 * 60 * 1000);

function readTimeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
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

  constructor(broadcast: BroadcastFn, config: JoiConfig) {
    this.broadcast = broadcast;
    this.config = config;

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
    this.appendLog(`Claude timeout: ${Math.round(AUTODEV_CLAUDE_TIMEOUT_MS / 1000)}s`);
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

  getSystemInfo(): {
    cwd: string;
    obsidianVault: string | null;
    devLogDir: string | null;
    devLogFile: string | null;
    memoryEnabled: boolean;
    startedAt: number;
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
      completedCount: this.completedCount,
      queue: this.queue.slice(0, 10).map((t) => ({ uuid: t.uuid, title: t.title })),
      systemInfo: this.getSystemInfo(),
    };
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

    this.state = "picking";
    this.currentTask = null;
    this.broadcastStatus();

    try {
      const allTasks = getActiveTasks();
      this.queue = allTasks.filter((t) => t.projectUuid === this.projectUuid);

      if (this.queue.length === 0) {
        this.state = "waiting";
        this.broadcastStatus();
        this.schedulePoll();
        return;
      }

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

  private async workOnTask(task: ThingsTask): Promise<void> {
    this.state = "working";
    this.abortController = new AbortController();
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

    this.appendLog(`Building system prompt (searching Obsidian + memories)...`);
    const systemPrompt = await this.buildSystemPrompt(task);
    this.appendLog(`System prompt ready (${systemPrompt.length} chars). Launching Claude Code...`);
    this.appendLog(`--- CLAUDE CODE OUTPUT START ---`);

    try {
      const result = await runClaudeCode({
        userMessage: prompt,
        systemPrompt,
        cwd: PROJECT_CWD,
        timeoutMs: AUTODEV_CLAUDE_TIMEOUT_MS,
        signal: this.abortController?.signal,
        onStream: (delta) => {
          this.logBuffer += delta;
          if (this.logBuffer.length > MAX_LOG_CHARS) {
            this.logBuffer = "--- log truncated ---\n" + this.logBuffer.slice(-MAX_LOG_CHARS * 0.8);
          }
          this.broadcast("autodev.log", {
            delta,
            taskUuid: task.uuid,
          } satisfies AutoDevLogData);
        },
      });

      this.abortController = null;

      this.appendLog(`--- CLAUDE CODE OUTPUT END ---`);
      this.appendLog(`Tokens: ${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out`);

      await this.completeTaskAndLog(task, result.content, result.usage);
    } catch (err) {
      this.abortController = null;
      const msg = (err as Error).message;
      if (msg === "Claude Code aborted") {
        this.appendLog(`Task aborted by user`);
      } else {
        console.error(`[AutoDev] Error working on task "${task.title}":`, msg);
        this.appendLog(`ERROR: ${msg}`);
        this.broadcastError(msg, task.uuid);
        // For spawn failures, wait longer before retrying
        if (msg.includes("posix_spawnp") || msg.includes("Failed to spawn")) {
          this.appendLog(`Spawn failure — will retry in 60s`);
          this.state = "waiting";
          this.currentTask = null;
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

  private async buildSystemPrompt(task: ThingsTask): Promise<string> {
    const sections: string[] = [];

    sections.push(
      `You are AutoDev, an autonomous developer agent working on the "${this.projectTitle}" project.`,
      `Complete each task thoroughly. Output clean, production-ready code.`,
      `After making changes, commit them with a concise message. Do NOT push to remote. Do NOT create new branches.`,
    );

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

  private async completeTaskAndLog(
    task: ThingsTask,
    output: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    this.state = "completing";
    this.broadcastStatus();

    try {
      const summary = extractSummary(output);
      const timestamp = new Date().toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });
      const noteBlock = `\n---\n[AutoDev ${timestamp}]\n${summary}`;

      await updateTask(task.uuid, { appendNotes: noteBlock });
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

      this.writeDevLog(task, summary, usage)
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
      this.broadcastError(msg, task.uuid);
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
      this.broadcastStatus();
      return;
    }

    this.state = "waiting";
    this.currentTask = null;
    this.broadcastStatus();

    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.safePickNext();
    }, NEXT_TASK_DELAY_MS);
  }

  private broadcastStatus(): void {
    this.broadcast("autodev.status", this.getStatus());
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
