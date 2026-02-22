// APNs (Apple Push Notification service) client
// Uses Node.js built-in http2 — zero external dependencies
// Token-based auth with .p8 key from Apple Developer portal

import http2 from "node:http2";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query } from "../db/client.js";

interface APNsConfig {
  keyPath: string;      // Path to .p8 auth key file
  keyId: string;        // Key ID from Apple Developer portal
  teamId: string;       // Team ID from Apple Developer portal
  bundleId: string;     // App bundle ID (com.joi.app)
  production: boolean;  // true = production APNs, false = sandbox
}

interface APNsPayload {
  aps: {
    alert?: { title: string; subtitle?: string; body?: string } | string;
    badge?: number;
    sound?: string | { critical?: number; name?: string; volume?: number };
    "thread-id"?: string;
    "mutable-content"?: number;
    "content-available"?: number;
    "interruption-level"?: "passive" | "active" | "time-sensitive" | "critical";
    "relevance-score"?: number;
  };
  [key: string]: unknown;
}

interface APNsResponse {
  statusCode: number;
  apnsId?: string;
  reason?: string;
}

let config: APNsConfig | null = null;
let cachedJWT: { token: string; expires: number } | null = null;
let h2Session: http2.ClientHttp2Session | null = null;

const APNS_HOST_PROD = "api.push.apple.com";
const APNS_HOST_DEV = "api.sandbox.push.apple.com";

export function configureAPNs(opts: APNsConfig): void {
  // Resolve relative paths from project root (parent of gateway/)
  const projectRoot = path.resolve(import.meta.dirname || process.cwd(), "../../..");
  const resolvedPath = path.isAbsolute(opts.keyPath)
    ? opts.keyPath
    : path.resolve(projectRoot, opts.keyPath);

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`[APNs] Auth key not found at ${resolvedPath} — push notifications disabled`);
    return;
  }
  config = { ...opts, keyPath: resolvedPath };
  console.log(`[APNs] Configured (${opts.production ? "production" : "sandbox"}, bundle: ${opts.bundleId})`);
}

export function isAPNsConfigured(): boolean {
  return config !== null;
}

function getJWT(): string {
  if (!config) throw new Error("APNs not configured");

  // Reuse JWT if still valid (tokens last 1 hour, refresh at 50 min)
  if (cachedJWT && Date.now() < cachedJWT.expires) {
    return cachedJWT.token;
  }

  const key = fs.readFileSync(config.keyPath, "utf8");
  const now = Math.floor(Date.now() / 1000);

  // JWT Header
  const header = Buffer.from(JSON.stringify({
    alg: "ES256",
    kid: config.keyId,
  })).toString("base64url");

  // JWT Payload
  const payload = Buffer.from(JSON.stringify({
    iss: config.teamId,
    iat: now,
  })).toString("base64url");

  // Sign with ES256
  const signer = crypto.createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" }, "base64url");

  const token = `${header}.${payload}.${signature}`;
  cachedJWT = { token, expires: Date.now() + 50 * 60 * 1000 }; // 50 minutes

  return token;
}

function getH2Session(): http2.ClientHttp2Session {
  if (h2Session && !h2Session.closed && !h2Session.destroyed) {
    return h2Session;
  }

  const host = config!.production ? APNS_HOST_PROD : APNS_HOST_DEV;
  h2Session = http2.connect(`https://${host}:443`);

  h2Session.on("error", (err) => {
    console.error("[APNs] HTTP/2 session error:", err.message);
    h2Session = null;
  });

  h2Session.on("close", () => {
    h2Session = null;
  });

  return h2Session;
}

export async function sendPush(
  deviceToken: string,
  payload: APNsPayload,
  opts?: { expiration?: number; priority?: number; collapseId?: string; pushType?: string },
): Promise<APNsResponse> {
  if (!config) {
    return { statusCode: 0, reason: "APNs not configured" };
  }

  const session = getH2Session();
  const jwt = getJWT();

  const headers: http2.OutgoingHttpHeaders = {
    ":method": "POST",
    ":path": `/3/device/${deviceToken}`,
    "authorization": `bearer ${jwt}`,
    "apns-topic": config.bundleId,
    "apns-push-type": opts?.pushType ?? "alert",
    "apns-priority": String(opts?.priority ?? 10),
  };

  if (opts?.expiration !== undefined) headers["apns-expiration"] = String(opts.expiration);
  if (opts?.collapseId) headers["apns-collapse-id"] = opts.collapseId;

  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = session.request(headers);
    let responseData = "";

    req.on("response", (resHeaders) => {
      const statusCode = resHeaders[":status"] as number;
      const apnsId = resHeaders["apns-id"] as string | undefined;

      req.on("data", (chunk: Buffer) => {
        responseData += chunk.toString();
      });

      req.on("end", () => {
        let reason: string | undefined;
        if (responseData) {
          try {
            reason = JSON.parse(responseData).reason;
          } catch { /* ignore */ }
        }
        resolve({ statusCode, apnsId, reason });
      });
    });

    req.on("error", (err) => {
      resolve({ statusCode: 0, reason: err.message });
    });

    req.end(body);
  });
}

// Send push to all registered devices
export async function pushToAllDevices(
  payload: APNsPayload,
  opts?: { collapseId?: string; pushType?: string },
): Promise<void> {
  if (!config) return;

  const result = await query<{ device_token: string; environment: string }>(
    "SELECT device_token, environment FROM push_tokens WHERE enabled = true",
  );

  for (const row of result.rows) {
    const res = await sendPush(row.device_token, payload, opts);

    if (res.statusCode === 200) {
      console.log(`[APNs] Sent to ${row.device_token.slice(0, 8)}... (${res.apnsId})`);
    } else if (res.statusCode === 410 || res.reason === "Unregistered") {
      // Token is no longer valid — disable it
      await query("UPDATE push_tokens SET enabled = false, updated_at = NOW() WHERE device_token = $1", [row.device_token]);
      console.warn(`[APNs] Token expired, disabled: ${row.device_token.slice(0, 8)}...`);
    } else {
      console.error(`[APNs] Failed (${res.statusCode}): ${res.reason} — token: ${row.device_token.slice(0, 8)}...`);
    }

    // Log delivery
    await query(
      `INSERT INTO notification_log (event_type, title, body, data, device_token, apns_id, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        (payload as any)._eventType ?? "unknown",
        typeof payload.aps.alert === "string" ? payload.aps.alert : payload.aps.alert?.title ?? "",
        typeof payload.aps.alert === "string" ? null : payload.aps.alert?.body ?? null,
        JSON.stringify(payload),
        row.device_token,
        res.apnsId ?? null,
        res.statusCode === 200 ? "sent" : "failed",
        res.reason ?? null,
      ],
    ).catch(() => {}); // Don't fail on log errors
  }
}

export function closeAPNs(): void {
  h2Session?.close();
  h2Session = null;
  cachedJWT = null;
}
