// Cron Scheduler: PG-backed job storage, timer-based execution
// Supports three schedule types: at (one-shot), every (interval), cron (expression)

import { Cron } from "croner";
import { query } from "../db/client.js";
import { runAgent } from "../agent/runtime.js";
import { summarizeIdleSessions } from "../knowledge/episodes.js";
import { runConsolidation } from "../knowledge/consolidator.js";
import { runOutlineSync } from "../sync/outline-sync.js";
import { importAppleContacts } from "../contacts/import-apple-contacts.js";
import { runAudit as runStoreAudit } from "../store/auditor.js";
import { scanAllChannels } from "../channels/scanner.js";
import { scanEmailInboxes } from "../channels/email-scanner.js";
import { checkBirthdays } from "../contacts/birthday-checker.js";
import { runSelfRepair } from "./self-repair.js";
import { runTestSuite } from "../quality/runner.js";
import { createIssuesFromRun } from "../quality/issues.js";
import type { JoiConfig } from "../config/schema.js";

export interface CronJob {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  delete_after_run: boolean;
  schedule_kind: "at" | "every" | "cron";
  schedule_at: string | null;
  schedule_every_ms: number | null;
  schedule_cron_expr: string | null;
  schedule_cron_tz: string | null;
  session_target: "main" | "isolated";
  payload_kind: "system_event" | "agent_turn";
  payload_text: string;
  payload_model: string | null;
  payload_timeout_seconds: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
  consecutive_errors: number;
}

// Active timers
const activeTimers = new Map<string, { timer: ReturnType<typeof setTimeout> | Cron; cancel: () => void }>();

let schedulerConfig: JoiConfig | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let retentionInterval: ReturnType<typeof setInterval> | null = null;

// Start the scheduler - polls DB every 30s for jobs to run
export function startScheduler(config: JoiConfig): void {
  schedulerConfig = config;

  console.log("[Cron] Scheduler started");

  // Initial load
  loadAndScheduleJobs();

  // Poll for changes every 30 seconds
  tickInterval = setInterval(loadAndScheduleJobs, 30_000);

  // Purge old run logs every hour
  retentionInterval = setInterval(purgeOldRuns, 60 * 60 * 1000);
}

export function stopScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }

  for (const [, entry] of activeTimers) {
    entry.cancel();
  }
  activeTimers.clear();

  console.log("[Cron] Scheduler stopped");
}

async function loadAndScheduleJobs(): Promise<void> {
  try {
    const result = await query<CronJob>(
      "SELECT * FROM cron_jobs WHERE enabled = true",
    );

    const currentJobIds = new Set<string>();

    for (const job of result.rows) {
      currentJobIds.add(job.id);

      // Skip if already scheduled
      if (activeTimers.has(job.id)) continue;

      scheduleJob(job);
    }

    // Cancel jobs that were removed or disabled
    for (const [id, entry] of activeTimers) {
      if (!currentJobIds.has(id)) {
        entry.cancel();
        activeTimers.delete(id);
      }
    }
  } catch (err) {
    console.error("[Cron] Failed to load jobs:", err);
  }
}

function scheduleJob(job: CronJob): void {
  switch (job.schedule_kind) {
    case "at": {
      if (!job.schedule_at) return;
      const runAt = new Date(job.schedule_at);
      const delay = runAt.getTime() - Date.now();
      if (delay <= 0) {
        // Past due, run immediately
        executeJob(job);
        return;
      }
      const timer = setTimeout(() => executeJob(job), delay);
      activeTimers.set(job.id, {
        timer,
        cancel: () => clearTimeout(timer),
      });
      break;
    }

    case "every": {
      if (!job.schedule_every_ms) return;
      const timer = setInterval(() => executeJob(job), job.schedule_every_ms);
      activeTimers.set(job.id, {
        timer,
        cancel: () => clearInterval(timer),
      });
      break;
    }

    case "cron": {
      if (!job.schedule_cron_expr) return;
      const cronJob = new Cron(job.schedule_cron_expr, {
        timezone: job.schedule_cron_tz || undefined,
      }, () => executeJob(job));

      activeTimers.set(job.id, {
        timer: cronJob,
        cancel: () => cronJob.stop(),
      });

      // Update next_run_at
      const nextRun = cronJob.nextRun();
      if (nextRun) {
        query(
          "UPDATE cron_jobs SET next_run_at = $1 WHERE id = $2",
          [nextRun.toISOString(), job.id],
        ).catch(() => {});
      }
      break;
    }
  }
}

async function purgeOldRuns(): Promise<void> {
  try {
    await query("DELETE FROM cron_job_runs WHERE created_at < NOW() - INTERVAL '30 days'");
  } catch {
    // Ignore — table may not exist yet
  }
}

async function executeJob(job: CronJob): Promise<void> {
  if (!schedulerConfig) return;

  const startTime = Date.now();
  console.log(`[Cron] Executing: ${job.name} (${job.id})`);

  // Mark as running on cron_jobs
  await query(
    "UPDATE cron_jobs SET running_at = NOW() WHERE id = $1",
    [job.id],
  ).catch(() => {});

  // Insert a running row into cron_job_runs
  let runId: string | null = null;
  try {
    const runResult = await query<{ id: string }>(
      "INSERT INTO cron_job_runs (job_id, status) VALUES ($1, 'running') RETURNING id",
      [job.id],
    );
    runId = runResult.rows[0]?.id ?? null;
  } catch {
    // Table may not exist yet (pre-migration) — continue without run tracking
  }

  // Capture logs from the job execution (available in both success and error paths)
  const capturedLogs: string[] = [];
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  const fmt = (...args: unknown[]) => args.map(a =>
    a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');

  console.log = (...args) => { capturedLogs.push(fmt(...args)); origLog(...args); };
  console.error = (...args) => { capturedLogs.push('[ERROR] ' + fmt(...args)); origErr(...args); };
  console.warn = (...args) => { capturedLogs.push('[WARN] ' + fmt(...args)); origWarn(...args); };

  try {
    if (job.payload_kind === "agent_turn") {
      await runAgent({
        conversationId: "",
        agentId: job.agent_id,
        userMessage: job.payload_text,
        config: schedulerConfig!,
      });
    } else if (job.payload_kind === "system_event") {
      switch (job.payload_text) {
        case "consolidate_memories":
          await runConsolidation(schedulerConfig!);
          break;
        case "summarize_idle_sessions":
          await summarizeIdleSessions(schedulerConfig!);
          break;
        case "sync_outline":
          await runOutlineSync(schedulerConfig!);
          break;
        case "sync_contacts":
          await importAppleContacts();
          break;
        case "audit_store":
          await runStoreAudit({
            config: schedulerConfig!,
            conversationId: `cron:${job.id}`,
            agentId: job.agent_id || "store-auditor",
          } as Parameters<typeof runStoreAudit>[0]);
          break;
        case "scan_channels":
          await scanAllChannels(schedulerConfig!);
          break;
        case "check_birthdays":
          await checkBirthdays(schedulerConfig!);
          break;
        case "scan_email_inboxes":
          await scanEmailInboxes(schedulerConfig!);
          break;
        case "self_repair":
          await runSelfRepair(schedulerConfig!);
          break;
        case "run_qa_tests": {
          // Run all enabled QA test suites
          const suites = await query<{ id: string; name: string }>(
            "SELECT id, name FROM qa_test_suites WHERE enabled = true ORDER BY name",
          );
          for (const suite of suites.rows) {
            console.log(`[QA] Running suite: ${suite.name}`);
            try {
              const run = await runTestSuite(suite.id, schedulerConfig!, {
                triggeredBy: "cron",
              });
              await createIssuesFromRun(run);
              console.log(`[QA] Suite "${suite.name}": ${run.passed} passed, ${run.failed} failed, ${run.errored} errored`);
            } catch (err) {
              console.error(`[QA] Suite "${suite.name}" failed:`, err);
            }
          }
          break;
        }
        default:
          console.warn(`[Cron] Unknown system_event: ${job.payload_text}`);
      }
    }

    const duration = Date.now() - startTime;
    const logText = capturedLogs.join('\n') || null;

    // Update cron_jobs (backward compat)
    await query(
      `UPDATE cron_jobs SET
         running_at = NULL,
         last_run_at = NOW(),
         last_status = 'ok',
         last_error = NULL,
         last_duration_ms = $1,
         consecutive_errors = 0,
         updated_at = NOW()
       WHERE id = $2`,
      [duration, job.id],
    );

    // Update the run row
    if (runId) {
      await query(
        `UPDATE cron_job_runs SET status = 'ok', finished_at = NOW(), duration_ms = $1, log = $2 WHERE id = $3`,
        [duration, logText, runId],
      ).catch(() => {});
    }

    console.log(`[Cron] Completed: ${job.name} (${duration}ms)`);

    // Delete one-shot jobs after execution
    if (job.delete_after_run || job.schedule_kind === "at") {
      activeTimers.get(job.id)?.cancel();
      activeTimers.delete(job.id);
      await query("UPDATE cron_jobs SET enabled = false WHERE id = $1", [job.id]);
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    const logText = capturedLogs.join('\n') || null;

    // Update cron_jobs (backward compat)
    await query(
      `UPDATE cron_jobs SET
         running_at = NULL,
         last_run_at = NOW(),
         last_status = 'error',
         last_error = $1,
         last_duration_ms = $2,
         consecutive_errors = consecutive_errors + 1,
         updated_at = NOW()
       WHERE id = $3`,
      [message, duration, job.id],
    ).catch(() => {});

    // Update the run row
    if (runId) {
      await query(
        `UPDATE cron_job_runs SET status = 'error', finished_at = NOW(), duration_ms = $1, error = $2, log = $3 WHERE id = $4`,
        [duration, message, logText, runId],
      ).catch(() => {});
    }

    console.error(`[Cron] Failed: ${job.name} - ${message}`);

    // Disable after 5 consecutive errors
    const jobCheck = await query<{ consecutive_errors: number }>(
      "SELECT consecutive_errors FROM cron_jobs WHERE id = $1",
      [job.id],
    );
    if (jobCheck.rows[0]?.consecutive_errors >= 5) {
      await query("UPDATE cron_jobs SET enabled = false WHERE id = $1", [job.id]);
      activeTimers.get(job.id)?.cancel();
      activeTimers.delete(job.id);
      console.warn(`[Cron] Disabled ${job.name} after 5 consecutive errors`);
    }
  } finally {
    console.log = origLog; console.error = origErr; console.warn = origWarn;
  }
}

// Run history

export async function listJobRuns(jobId: string, limit: number): Promise<unknown[]> {
  const result = await query(
    "SELECT * FROM cron_job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2",
    [jobId, limit],
  );
  return result.rows;
}

// CRUD for cron jobs

export async function createJob(params: {
  agentId?: string;
  name: string;
  description?: string;
  scheduleKind: "at" | "every" | "cron";
  scheduleAt?: string;
  scheduleEveryMs?: number;
  scheduleCronExpr?: string;
  scheduleCronTz?: string;
  sessionTarget?: "main" | "isolated";
  payloadKind?: "system_event" | "agent_turn";
  payloadText: string;
  deleteAfterRun?: boolean;
}): Promise<CronJob> {
  const result = await query<CronJob>(
    `INSERT INTO cron_jobs (
       agent_id, name, description, schedule_kind,
       schedule_at, schedule_every_ms, schedule_cron_expr, schedule_cron_tz,
       session_target, payload_kind, payload_text, delete_after_run
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      params.agentId || "personal",
      params.name,
      params.description || null,
      params.scheduleKind,
      params.scheduleAt || null,
      params.scheduleEveryMs || null,
      params.scheduleCronExpr || null,
      params.scheduleCronTz || null,
      params.sessionTarget || "isolated",
      params.payloadKind || "agent_turn",
      params.payloadText,
      params.deleteAfterRun || false,
    ],
  );

  // Schedule immediately
  scheduleJob(result.rows[0]);

  return result.rows[0];
}

export async function listJobs(): Promise<CronJob[]> {
  const result = await query<CronJob>(
    "SELECT * FROM cron_jobs ORDER BY enabled DESC, next_run_at ASC NULLS LAST",
  );
  return result.rows;
}

export async function toggleJob(id: string, enabled: boolean): Promise<void> {
  await query("UPDATE cron_jobs SET enabled = $1, updated_at = NOW() WHERE id = $2", [enabled, id]);

  if (!enabled) {
    activeTimers.get(id)?.cancel();
    activeTimers.delete(id);
  } else {
    // Reload and reschedule
    loadAndScheduleJobs();
  }
}

export async function updateJob(id: string, params: {
  name?: string;
  description?: string;
  scheduleKind?: "at" | "every" | "cron";
  scheduleAt?: string;
  scheduleEveryMs?: number;
  scheduleCronExpr?: string;
  scheduleCronTz?: string;
  payloadText?: string;
  payloadKind?: "system_event" | "agent_turn";
  enabled?: boolean;
}): Promise<CronJob> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (params.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(params.name); }
  if (params.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(params.description || null); }
  if (params.scheduleKind !== undefined) { sets.push(`schedule_kind = $${idx++}`); vals.push(params.scheduleKind); }
  if (params.scheduleAt !== undefined) { sets.push(`schedule_at = $${idx++}`); vals.push(params.scheduleAt || null); }
  if (params.scheduleEveryMs !== undefined) { sets.push(`schedule_every_ms = $${idx++}`); vals.push(params.scheduleEveryMs || null); }
  if (params.scheduleCronExpr !== undefined) { sets.push(`schedule_cron_expr = $${idx++}`); vals.push(params.scheduleCronExpr || null); }
  if (params.scheduleCronTz !== undefined) { sets.push(`schedule_cron_tz = $${idx++}`); vals.push(params.scheduleCronTz || null); }
  if (params.payloadText !== undefined) { sets.push(`payload_text = $${idx++}`); vals.push(params.payloadText); }
  if (params.payloadKind !== undefined) { sets.push(`payload_kind = $${idx++}`); vals.push(params.payloadKind); }
  if (params.enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(params.enabled); }

  sets.push("updated_at = NOW()");
  vals.push(id);

  const result = await query<CronJob>(
    `UPDATE cron_jobs SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  );

  if (result.rows.length === 0) throw new Error("Job not found");

  // Reschedule: cancel old timer and set up new one
  activeTimers.get(id)?.cancel();
  activeTimers.delete(id);
  if (result.rows[0].enabled) {
    scheduleJob(result.rows[0]);
  }

  return result.rows[0];
}

export async function deleteJob(id: string): Promise<void> {
  activeTimers.get(id)?.cancel();
  activeTimers.delete(id);
  await query("DELETE FROM cron_jobs WHERE id = $1", [id]);
}

/** Trigger a job immediately (for manual "Run now" from the UI). */
export async function executeJobNow(job: CronJob): Promise<void> {
  return executeJob(job);
}
