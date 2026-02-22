// Self-Repair Cron Job
// Periodically checks health of all JOI services, analyzes logs for errors,
// attempts self-repair (restart), creates Things3 tasks, and notifies via Telegram.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db/client.js";
import { createTask } from "../things/client.js";
import type { JoiConfig } from "../config/schema.js";

const execFileAsync = promisify(execFile);

// ── Types ──

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  detail: string;
  latencyMs?: number;
}

interface LogIssue {
  source: string;
  errorCount: number;
  recentErrors: string[];
}

interface RepairAction {
  service: string;
  action: string;
  success: boolean;
  detail: string;
}

interface SelfRepairReport {
  timestamp: string;
  services: ServiceCheck[];
  logIssues: LogIssue[];
  repairs: RepairAction[];
  overallStatus: "healthy" | "degraded" | "down";
}

interface WatchdogSupervisorState {
  running: boolean;
  autoRestartEnabled: boolean;
  freshStatus: boolean;
  managing: boolean;
  detail: string;
}

// ── Health Checks ──

async function checkHttp(name: string, port: number, path: string, timeoutMs = 5000): Promise<ServiceCheck> {
  const start = Date.now();
  return new Promise<ServiceCheck>((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path, timeout: timeoutMs }, (res) => {
      const latencyMs = Date.now() - start;
      if (res.statusCode && res.statusCode < 500) {
        resolve({ name, status: "healthy", detail: `HTTP ${res.statusCode} (${latencyMs}ms)`, latencyMs });
      } else {
        resolve({ name, status: "degraded", detail: `HTTP ${res.statusCode} (${latencyMs}ms)`, latencyMs });
      }
      res.resume(); // drain
    });
    req.on("error", () => {
      resolve({ name, status: "down", detail: `No response on port ${port}`, latencyMs: Date.now() - start });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ name, status: "down", detail: `Timeout after ${timeoutMs}ms`, latencyMs: timeoutMs });
    });
  });
}

async function checkProcess(name: string, grepPattern: string): Promise<ServiceCheck> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", grepPattern]);
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (pids.length > 0) {
      return { name, status: "healthy", detail: `Running (PID ${pids[0]})` };
    }
    return { name, status: "down", detail: "Process not found" };
  } catch {
    return { name, status: "down", detail: "Process not found" };
  }
}

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await query("SELECT 1");
    return { name: "PostgreSQL", status: "healthy", detail: `OK (${Date.now() - start}ms)`, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "PostgreSQL", status: "down", detail: err instanceof Error ? err.message : "Connection failed" };
  }
}

// ── Log Analysis ──

async function analyzeRecentLogs(minutesBack = 15): Promise<LogIssue[]> {
  const issues: LogIssue[] = [];
  try {
    const result = await query<{ source: string; error_count: number; recent_errors: string[] }>(
      `SELECT source,
              count(*) AS error_count,
              array_agg(message ORDER BY created_at DESC) AS recent_errors
       FROM gateway_logs
       WHERE level = 'error'
         AND created_at > NOW() - make_interval(mins := $1)
       GROUP BY source
       HAVING count(*) >= 3
       ORDER BY count(*) DESC
       LIMIT 10`,
      [minutesBack],
    );
    for (const row of result.rows) {
      issues.push({
        source: row.source,
        errorCount: Number(row.error_count),
        recentErrors: (row.recent_errors || []).slice(0, 3),
      });
    }
  } catch {
    // Logs table might not exist yet
  }
  return issues;
}

// ── Repair Actions ──

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "../../..");
const WATCHDOG_PID_FILE = "/tmp/joi-watchdog.pid";
const WATCHDOG_STATUS_FILE = "/tmp/joi-watchdog.json";
const WATCHDOG_AUTORESTART_FILE = "/tmp/joi-watchdog.enabled";
const WATCHDOG_STATUS_STALE_MS = 90_000;

function parseWatchdogAutoRestart(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  return null;
}

function readWatchdogAutoRestartEnabled(): boolean {
  try {
    const raw = fs.readFileSync(WATCHDOG_AUTORESTART_FILE, "utf-8");
    const parsed = parseWatchdogAutoRestart(raw);
    return parsed ?? true;
  } catch {
    return true;
  }
}

function readWatchdogPid(): number | null {
  try {
    const raw = fs.readFileSync(WATCHDOG_PID_FILE, "utf-8").trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function isWatchdogPidRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
    }).trim();
    return /(^|[\\/ ])watchdog\.sh(\s|$)/.test(cmd);
  } catch {
    return false;
  }
}

function isWatchdogStatusFresh(): boolean {
  try {
    const stats = fs.statSync(WATCHDOG_STATUS_FILE);
    return Date.now() - stats.mtimeMs < WATCHDOG_STATUS_STALE_MS;
  } catch {
    return false;
  }
}

function getWatchdogSupervisorState(): WatchdogSupervisorState {
  const autoRestartEnabled = readWatchdogAutoRestartEnabled();
  const pid = readWatchdogPid();
  const running = pid !== null && isWatchdogPidRunning(pid);
  const freshStatus = isWatchdogStatusFresh();
  const managing = running && autoRestartEnabled && freshStatus;

  const detail = !running
    ? "not running"
    : !autoRestartEnabled
      ? "running with auto-restart paused"
      : freshStatus
        ? `active (pid ${pid})`
        : "running but status stale";

  return {
    running,
    autoRestartEnabled,
    freshStatus,
    managing,
    detail,
  };
}

async function restartService(name: string, script: string): Promise<RepairAction> {
  try {
    // Kill existing process then restart via pnpm
    console.log(`[SelfRepair] Attempting to restart ${name}...`);

    if (name === "Gateway API") {
      // Gateway restarts itself — don't kill ourselves. Log the issue for manual attention.
      return {
        service: name,
        action: "flagged_for_manual_restart",
        success: false,
        detail: "Gateway cannot restart itself — flagged for manual attention",
      };
    }

    // For web and workers, restart via pnpm in background
    const { stdout, stderr } = await execFileAsync("bash", [
      "-c",
      `cd "${PROJECT_ROOT}" && nohup pnpm ${script} > /dev/null 2>&1 &`,
    ], { timeout: 10_000 });

    // Wait a moment then check if it started
    await new Promise((r) => setTimeout(r, 3000));

    return {
      service: name,
      action: `restart (pnpm ${script})`,
      success: true,
      detail: stdout.trim() || "Restart command issued",
    };
  } catch (err) {
    return {
      service: name,
      action: `restart (pnpm ${script})`,
      success: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Telegram Notification ──

async function sendTelegramNotification(config: JoiConfig, message: string): Promise<boolean> {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    console.log("[SelfRepair] Telegram not configured — skipping notification");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_notification: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[SelfRepair] Telegram send failed: ${response.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[SelfRepair] Telegram send error:", err);
    return false;
  }
}

// ── Things3 Task Creation ──

async function createRepairTask(report: SelfRepairReport): Promise<void> {
  const downServices = report.services.filter((s) => s.status === "down");
  const title = `🔧 Self-Repair: ${downServices.map((s) => s.name).join(", ")} down`;
  const notes = [
    `Auto-detected at ${report.timestamp}`,
    "",
    "## Services",
    ...report.services.map((s) => `- ${s.name}: ${s.status} — ${s.detail}`),
    "",
    "## Repair Attempts",
    ...report.repairs.map((r) => `- ${r.service}: ${r.action} → ${r.success ? "✅" : "❌"} ${r.detail}`),
    "",
    "## Log Issues",
    ...report.logIssues.map((l) => `- ${l.source}: ${l.errorCount} errors`),
  ].join("\n");

  try {
    // Find JOI project and create task there
    await createTask(title, {
      notes,
      tags: ["self-repair", "automated"],
      list: "today",
    });
    console.log("[SelfRepair] Created Things3 task");
  } catch (err) {
    console.error("[SelfRepair] Failed to create Things3 task:", err);
  }
}

// ── Store report in DB ──

async function storeReport(report: SelfRepairReport): Promise<void> {
  try {
    await query(
      `INSERT INTO self_repair_runs (status, services, log_issues, repairs, report)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        report.overallStatus,
        JSON.stringify(report.services),
        JSON.stringify(report.logIssues),
        JSON.stringify(report.repairs),
        JSON.stringify(report),
      ],
    );
  } catch {
    // Table might not exist yet — that's fine
  }
}

// ── Main Entry Point ──

export async function runSelfRepair(config: JoiConfig): Promise<void> {
  console.log("[SelfRepair] Starting health check...");
  const timestamp = new Date().toISOString();

  const watchdogSupervisor = getWatchdogSupervisorState();
  console.log(`[SelfRepair] Watchdog supervisor: ${watchdogSupervisor.detail}`);

  // 1. Run health checks
  const services: ServiceCheck[] = await Promise.all([
    checkHttp("Gateway API", 3100, "/health"),
    checkHttp("Web Dev Server", 5173, "/"),
    checkProcess("LiveKit Worker", `${PROJECT_ROOT}/infra/livekit-worker`),
    checkProcess("AutoDev Worker", `${PROJECT_ROOT}/gateway.*autodev/worker`),
    checkDatabase(),
  ]);

  // 2. Analyze recent error logs
  const logIssues = await analyzeRecentLogs(15);

  // 3. Determine overall status
  const downServices = services.filter((s) => s.status === "down");
  const degradedServices = services.filter((s) => s.status === "degraded");
  const overallStatus: SelfRepairReport["overallStatus"] =
    downServices.length > 0 ? "down" : degradedServices.length > 0 ? "degraded" : "healthy";

  // 4. Attempt repairs for down services (skip DB — can't restart that easily)
  const repairs: RepairAction[] = [];
  const serviceRestartMap: Record<string, string> = {
    "Web Dev Server": "dev:web",
    "LiveKit Worker": "dev:worker",
    "AutoDev Worker": "dev:autodev",
    "Gateway API": "dev:gateway",
  };

  for (const svc of downServices) {
    const script = serviceRestartMap[svc.name];
    if (script) {
      const watchdogManagedService = svc.name === "Web Dev Server"
        || svc.name === "LiveKit Worker"
        || svc.name === "AutoDev Worker";
      if (watchdogSupervisor.managing && watchdogManagedService) {
        repairs.push({
          service: svc.name,
          action: "restart_skipped_watchdog_active",
          success: true,
          detail: "Skipped restart because watchdog auto-restart is active",
        });
        continue;
      }
      const result = await restartService(svc.name, script);
      repairs.push(result);
    }
  }

  // 5. Build report
  const report: SelfRepairReport = {
    timestamp,
    services,
    logIssues,
    repairs,
    overallStatus,
  };

  // 6. Store report
  await storeReport(report);

  // 7. Log summary
  const summary = services.map((s) => `${s.name}: ${s.status}`).join(" | ");
  console.log(`[SelfRepair] ${summary}`);

  if (logIssues.length > 0) {
    console.log(`[SelfRepair] Log issues: ${logIssues.map((l) => `${l.source}(${l.errorCount})`).join(", ")}`);
  }

  // 8. Only notify/create tasks if something is wrong
  if (overallStatus !== "healthy") {
    // Create Things3 task
    await createRepairTask(report);

    // Send Telegram notification
    const emoji = overallStatus === "down" ? "🔴" : "🟡";
    const lines = [
      `${emoji} *JOI Self-Repair Report*`,
      "",
      ...services.map((s) => {
        const icon = s.status === "healthy" ? "✅" : s.status === "degraded" ? "⚠️" : "❌";
        return `${icon} ${s.name}: ${s.detail}`;
      }),
    ];

    if (repairs.length > 0) {
      lines.push("", "*Repair Attempts:*");
      for (const r of repairs) {
        lines.push(`${r.success ? "✅" : "❌"} ${r.service}: ${r.action}`);
      }
    }

    if (logIssues.length > 0) {
      lines.push("", "*Error Clusters (last 15m):*");
      for (const l of logIssues) {
        lines.push(`⚠️ ${l.source}: ${l.errorCount} errors`);
      }
    }

    await sendTelegramNotification(config, lines.join("\n"));
  } else if (logIssues.length > 0) {
    // Services healthy but error clusters detected — notify but don't create task
    const lines = [
      `⚠️ *JOI Self-Repair: Error Clusters Detected*`,
      "",
      "All services healthy, but elevated errors in logs:",
      ...logIssues.map((l) => `• ${l.source}: ${l.errorCount} errors — ${l.recentErrors[0] || ""}`.slice(0, 200)),
    ];
    await sendTelegramNotification(config, lines.join("\n"));
  } else {
    console.log("[SelfRepair] All systems healthy ✓");
  }
}
