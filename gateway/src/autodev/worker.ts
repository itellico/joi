// AutoDev Worker — standalone process entry point.
// Runs the AutoDev loop independently, connects to gateway via WebSocket.
// Self-healing: the bash wrapper (scripts/dev-autodev.sh) restarts on crash.

import WebSocket from "ws";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { AutoDevManager } from "./manager.js";
import { frame, parseFrame, type AutoDevStatusData, type AutoDevConfigureData } from "../protocol.js";

const config = loadConfig();

// Build WS URL — must hit /ws path and include auth token if configured
function buildGatewayUrl(): string {
  const base = `ws://localhost:${config.gateway.port}/ws`;
  const secret = config.gateway.secret;
  return secret ? `${base}?token=${encodeURIComponent(secret)}` : base;
}
const GATEWAY_URL = buildGatewayUrl();
const WORKER_LOCK_DIR = join(tmpdir(), "joi-autodev-worker.lock");
const WORKER_LOCK_PID_FILE = join(WORKER_LOCK_DIR, "pid");

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
const MAX_RECONNECT_DELAY = 30_000;

// Buffer events when disconnected — we only need the latest status
let pendingStatus: (AutoDevStatusData & { paused?: boolean; systemInfo?: unknown }) | null = null;

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseWorkerLock(): void {
  try {
    rmSync(WORKER_LOCK_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function tryCreateWorkerLock(): boolean {
  try {
    mkdirSync(WORKER_LOCK_DIR);
    writeFileSync(WORKER_LOCK_PID_FILE, String(process.pid), "utf8");
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
    return false;
  }
}

function readLockPid(): number | null {
  try {
    const raw = readFileSync(WORKER_LOCK_PID_FILE, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function acquireWorkerLock(): boolean {
  if (tryCreateWorkerLock()) return true;

  const existingPid = readLockPid();
  if (existingPid !== null && existingPid !== process.pid && isPidRunning(existingPid)) {
    console.log(`[AutoDev Worker] Another worker is already running (PID ${existingPid}). Exiting.`);
    return false;
  }

  // Stale lock; try to reclaim it.
  releaseWorkerLock();
  if (tryCreateWorkerLock()) return true;

  const winnerPid = readLockPid();
  if (winnerPid !== null && winnerPid !== process.pid) {
    console.log(`[AutoDev Worker] Another worker won lock (PID ${winnerPid}). Exiting.`);
  } else {
    console.log("[AutoDev Worker] Another worker won lock. Exiting.");
  }
  return false;
}

function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

function sendToGateway(type: string, data: unknown): void {
  if (isConnected()) {
    ws!.send(frame(type as any, data));
    pendingStatus = null;
  } else if (type === "autodev.status") {
    // Buffer latest status for sync on reconnect
    pendingStatus = data as AutoDevStatusData;
  }
}

// Create the manager with a broadcast function that sends over WS
if (!acquireWorkerLock()) {
  process.exit(0);
}
process.on("exit", releaseWorkerLock);

const manager = new AutoDevManager(sendToGateway, config);

function connect(): void {
  if (shuttingDown) return;

  console.log(`[AutoDev Worker] Connecting to ${GATEWAY_URL}...`);

  ws = new WebSocket(GATEWAY_URL);

  ws.on("open", () => {
    console.log("[AutoDev Worker] Connected to gateway");
    reconnectDelay = 1000; // Reset backoff

    // Send full sync: status + log
    const helloData = {
      status: manager.getStatus(),
      log: manager.getLog(),
    };
    ws!.send(frame("autodev.worker_hello" as any, helloData));

    // Flush any buffered status
    if (pendingStatus) {
      ws!.send(frame("autodev.status" as any, pendingStatus));
      pendingStatus = null;
    }
  });

  ws.on("message", (raw) => {
    const msg = parseFrame(String(raw));
    if (!msg) return;

    switch (msg.type) {
      case "autodev.pause":
        manager.pause();
        break;
      case "autodev.resume":
        manager.resume();
        break;
      case "autodev.stop-current":
        manager.stopCurrent();
        break;
      case "autodev.configure":
        manager.configureRuntime((msg.data as AutoDevConfigureData) || {}, "gateway");
        break;
    }
  });

  ws.on("close", () => {
    ws = null;
    if (shuttingDown) return;
    console.log(`[AutoDev Worker] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    // Suppress connection noise — close handler will reconnect
    const code = (err as any).code;
    if (code !== "ECONNREFUSED" && code !== "ECONNRESET") {
      console.error("[AutoDev Worker] WS error:", err.message);
    }
  });
}

// Start connecting
connect();

// Graceful shutdown — force-exit after 3s if something hangs
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("[AutoDev Worker] Shutting down...");

  // Cancel any pending reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  // Shutdown manager (clears timers, aborts current task)
  manager.shutdown();

  // Close WS
  if (ws) { try { ws.close(); } catch { /* ignore */ } }

  // Force exit after 3s in case something hangs
  const forceTimer = setTimeout(() => {
    console.log("[AutoDev Worker] Force exit");
    process.exit(1);
  }, 3000);
  forceTimer.unref(); // Don't keep process alive just for this timer

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
