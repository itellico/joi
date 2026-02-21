// AutoDev Proxy — gateway-side thin relay between the AutoDev worker and web clients.
// Caches status/log so REST endpoints work even when the worker reconnects.

import type { WebSocket } from "ws";
import { frame, parseFrame, type Frame, type AutoDevStatusData, type AutoDevLogData } from "../protocol.js";

interface BroadcastFn {
  (type: string, data: unknown): void;
}

const MAX_LOG_CHARS = 500_000;

export class AutoDevProxy {
  private broadcastToClients: BroadcastFn;
  private workerWs: WebSocket | null = null;
  private cachedStatus: (AutoDevStatusData & { paused?: boolean; systemInfo?: unknown }) | null = null;
  private logBuffer = "";

  constructor(broadcastToClients: BroadcastFn) {
    this.broadcastToClients = broadcastToClients;
  }

  get workerConnected(): boolean {
    return this.workerWs !== null && this.workerWs.readyState === 1; // WebSocket.OPEN
  }

  getStatus(): AutoDevStatusData & { paused?: boolean; systemInfo?: unknown; workerConnected?: boolean } {
    if (this.cachedStatus) {
      return { ...this.cachedStatus, workerConnected: this.workerConnected };
    }
    return {
      state: "waiting",
      projectUuid: null,
      projectTitle: null,
      currentTask: null,
      completedCount: 0,
      queue: [],
      workerConnected: false,
    };
  }

  getLog(): string {
    return this.logBuffer;
  }

  setWorkerSocket(ws: WebSocket): void {
    // Clean up previous worker connection
    if (this.workerWs && this.workerWs !== ws) {
      try { this.workerWs.close(); } catch { /* ignore */ }
    }

    this.workerWs = ws;
    console.log("[AutoDevProxy] Worker connected");

    ws.on("close", () => {
      if (this.workerWs === ws) {
        this.workerWs = null;
        console.log("[AutoDevProxy] Worker disconnected");
      }
    });

    ws.on("error", (err) => {
      console.error("[AutoDevProxy] Worker WS error:", err);
      if (this.workerWs === ws) {
        this.workerWs = null;
      }
    });
  }

  handleWorkerMessage(msg: Frame): void {
    switch (msg.type) {
      case "autodev.worker_hello": {
        // Full sync: worker sends its complete status + log
        const data = msg.data as { status?: AutoDevStatusData; log?: string } | undefined;
        if (data?.status) {
          this.cachedStatus = data.status;
        }
        if (data?.log !== undefined) {
          this.logBuffer = data.log;
        }
        // Broadcast current state to web clients
        this.broadcastToClients("autodev.status", this.getStatus());
        if (this.logBuffer) {
          this.broadcastToClients("autodev.log", { delta: this.logBuffer, full: true } satisfies AutoDevLogData);
        }
        break;
      }

      case "autodev.status": {
        this.cachedStatus = msg.data as AutoDevStatusData;
        this.broadcastToClients("autodev.status", this.getStatus());
        break;
      }

      case "autodev.log": {
        const logData = msg.data as AutoDevLogData;
        this.logBuffer += logData.delta;
        if (this.logBuffer.length > MAX_LOG_CHARS) {
          this.logBuffer = "--- log truncated ---\n" + this.logBuffer.slice(-MAX_LOG_CHARS * 0.8);
        }
        this.broadcastToClients("autodev.log", logData);
        break;
      }

      case "autodev.task_complete":
      case "autodev.error": {
        this.broadcastToClients(msg.type, msg.data);
        break;
      }
    }
  }

  /** Send cached status + log to a single newly-connected web client */
  sendSyncToClient(ws: import("ws").WebSocket): void {
    if (ws.readyState !== 1) return;
    ws.send(frame("autodev.status" as any, this.getStatus()));
    if (this.logBuffer) {
      ws.send(frame("autodev.log" as any, { delta: this.logBuffer, full: true } satisfies AutoDevLogData));
    }
  }

  sendToWorker(type: string, data?: unknown): void {
    if (!this.workerWs || this.workerWs.readyState !== 1) {
      console.warn("[AutoDevProxy] Cannot send to worker — not connected");
      return;
    }
    this.workerWs.send(frame(type as any, data));
  }
}
