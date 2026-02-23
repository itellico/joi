// macOS Permission Guard — prevents repeated "node would like to access data" dialogs
// Checks permission once per resource, caches the result, and skips on denial.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type PermissionState = "unknown" | "granted" | "denied";

interface PermissionEntry {
  state: PermissionState;
  checkedAt: number;
  error?: string;
}

// Cache of permission states per resource
const permissions = new Map<string, PermissionEntry>();

// How long to respect a denial before re-checking (1 hour)
const DENIAL_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Check if we have macOS permission to access a specific resource.
 * Returns true if access is granted, false if denied (cached).
 * Only actually probes macOS on first call or after cooldown.
 */
export async function checkPermission(
  resource: "contacts" | "messages" | "things",
): Promise<boolean> {
  const cached = permissions.get(resource);

  // If previously granted, trust it
  if (cached?.state === "granted") return true;

  // If recently denied, skip without prompting again
  if (cached?.state === "denied") {
    const elapsed = Date.now() - cached.checkedAt;
    if (elapsed < DENIAL_COOLDOWN_MS) return false;
    // Cooldown expired — re-check
  }

  // Probe the resource with a minimal, fast check
  try {
    switch (resource) {
      case "contacts":
        await execFileAsync(
          "osascript",
          ["-l", "JavaScript", "-e", 'const app = Application("Contacts"); JSON.stringify(app.people().length);'],
          { timeout: 10000 },
        );
        break;

      case "messages":
        await execFileAsync(
          "osascript",
          ["-e", 'tell application "Messages" to name'],
          { timeout: 10000 },
        );
        break;

      case "things":
        await execFileAsync(
          "osascript",
          ["-e", 'tell application "Things3" to name'],
          { timeout: 10000 },
        );
        break;
    }

    permissions.set(resource, { state: "granted", checkedAt: Date.now() });
    console.log(`[PermissionGuard] ${resource}: granted`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    permissions.set(resource, { state: "denied", checkedAt: Date.now(), error: msg });
    console.warn(
      `[PermissionGuard] ${resource}: denied — will skip for ${DENIAL_COOLDOWN_MS / 60000} min. ` +
      `Grant access in System Settings > Privacy & Security > Automation. Error: ${msg}`,
    );
    return false;
  }
}

/**
 * Guard wrapper — runs the callback only if permission is granted.
 * Returns null if permission was denied.
 */
export async function withPermission<T>(
  resource: "contacts" | "messages" | "things",
  fn: () => Promise<T>,
): Promise<T | null> {
  const ok = await checkPermission(resource);
  if (!ok) return null;

  try {
    return await fn();
  } catch (err) {
    // If the error looks like a macOS permission denial, mark as denied
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("not allowed") ||
      msg.includes("Not authorized") ||
      msg.includes("errAEPrivilegeError") ||
      msg.includes("Operation not permitted") ||
      msg.includes("-1743")
    ) {
      permissions.set(resource, { state: "denied", checkedAt: Date.now(), error: msg });
      console.warn(`[PermissionGuard] ${resource}: permission revoked during call — caching denial`);
      return null;
    }
    throw err; // Re-throw non-permission errors
  }
}

/** Reset a specific permission (e.g., after user grants access in System Settings) */
export function resetPermission(resource: "contacts" | "messages" | "things"): void {
  permissions.delete(resource);
  console.log(`[PermissionGuard] ${resource}: reset — will re-check on next access`);
}

/** Get current permission states (for debug/UI) */
export function getPermissionStates(): Record<string, PermissionEntry> {
  const result: Record<string, PermissionEntry> = {};
  for (const [k, v] of permissions) result[k] = v;
  return result;
}
