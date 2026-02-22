// Structured Logger: Writes to console + PostgreSQL gateway_logs table
// Used across all gateway modules for queryable real-time logging

import { query } from "./db/client.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "gateway" | "agent" | "cron" | "knowledge" | "obsidian" | "outline" | "pty" | "autolearn" | "access";

interface LogEntry {
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: Record<string, unknown>;
}

// In-memory ring buffer for fast reads (keeps last 500 entries)
const LOG_BUFFER_SIZE = 500;
const logBuffer: Array<LogEntry & { id: number; created_at: string }> = [];
let logId = 0;

// Broadcast callback for real-time WebSocket log streaming
let broadcastFn: ((type: string, data: unknown) => void) | null = null;

export function setLogBroadcast(fn: (type: string, data: unknown) => void): void {
  broadcastFn = fn;
}

function writeLog(entry: LogEntry): void {
  const now = new Date().toISOString();
  const buffered = { ...entry, id: ++logId, created_at: now };

  // Ring buffer
  logBuffer.push(buffered);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

  // Console output
  const prefix = `[${entry.source}]`;
  switch (entry.level) {
    case "debug": console.debug(prefix, entry.message); break;
    case "info":  console.log(prefix, entry.message); break;
    case "warn":  console.warn(prefix, entry.message); break;
    case "error": console.error(prefix, entry.message); break;
  }

  // WebSocket broadcast
  broadcastFn?.("log.entry", buffered);

  // Persist to DB (fire-and-forget, don't block)
  query(
    `INSERT INTO gateway_logs (level, source, message, metadata) VALUES ($1, $2, $3, $4)`,
    [entry.level, entry.source, entry.message, JSON.stringify(entry.metadata || {})],
  ).catch(() => { /* DB might not be ready */ });
}

export function log(source: LogSource, message: string, metadata?: Record<string, unknown>): void {
  writeLog({ level: "info", source, message, metadata });
}

export function logWarn(source: LogSource, message: string, metadata?: Record<string, unknown>): void {
  writeLog({ level: "warn", source, message, metadata });
}

export function logError(source: LogSource, message: string, metadata?: Record<string, unknown>): void {
  writeLog({ level: "error", source, message, metadata });
}

export function logDebug(source: LogSource, message: string, metadata?: Record<string, unknown>): void {
  writeLog({ level: "debug", source, message, metadata });
}

// Get recent logs from memory buffer (fast)
export function getRecentLogs(options?: {
  limit?: number;
  level?: LogLevel;
  source?: LogSource;
}): Array<LogEntry & { id: number; created_at: string }> {
  let filtered = logBuffer;
  if (options?.level) filtered = filtered.filter((l) => l.level === options.level);
  if (options?.source) filtered = filtered.filter((l) => l.source === options.source);
  const limit = options?.limit || 100;
  return filtered.slice(-limit);
}

// Get logs from DB (slower but complete history)
export async function queryLogs(options?: {
  limit?: number;
  level?: LogLevel;
  source?: LogSource;
  since?: string;
  search?: string;
}): Promise<Array<{ id: number; level: string; source: string; message: string; metadata: unknown; created_at: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (options?.level) {
    conditions.push(`level = $${paramIdx++}`);
    params.push(options.level);
  }
  if (options?.source) {
    conditions.push(`source = $${paramIdx++}`);
    params.push(options.source);
  }
  if (options?.since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(options.since);
  }
  if (options?.search) {
    conditions.push(`message ILIKE $${paramIdx++}`);
    params.push(`%${options.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit || 200;

  const result = await query(
    `SELECT id, level, source, message, metadata, created_at
     FROM gateway_logs ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx}`,
    [...params, limit],
  );
  return result.rows as any;
}

// Prune old logs (call from cron)
export async function pruneLogs(olderThanDays = 7): Promise<number> {
  const result = await query(
    `DELETE FROM gateway_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
    [olderThanDays],
  );
  return result.rowCount ?? 0;
}
