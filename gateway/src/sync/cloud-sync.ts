// Cloud Sync — provider-agnostic file sync via rclone
// Supports any rclone remote: Google Drive, iCloud (SFTP), Dropbox, S3, etc.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "../db/client.js";

const execFileAsync = promisify(execFile);

// ─── Types ───

export interface SyncProvider {
  id: string;
  name: string;
  type: string;
  rclone_remote: string | null;
  config: Record<string, unknown>;
  status: string;
  status_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncPair {
  id: string;
  name: string;
  source_provider_id: string;
  source_path: string;
  target_provider_id: string;
  target_path: string;
  direction: string;
  schedule: string;
  enabled: boolean;
  exclude_patterns: string[];
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  files_synced: number;
  created_at: string;
  updated_at: string;
  // joined fields
  source_provider?: SyncProvider;
  target_provider?: SyncProvider;
}

export interface SyncRun {
  id: string;
  pair_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  direction: string;
  files_transferred: number;
  files_deleted: number;
  bytes_transferred: number;
  error_message: string | null;
  details: Record<string, unknown>;
  pair_name?: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
}

// ─── rclone helpers ───

async function rcloneExec(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("rclone", args, { timeout: 120_000 });
    return stdout;
  } catch (err: any) {
    const msg = err.stderr || err.message || String(err);
    throw new Error(`rclone failed: ${msg}`);
  }
}

function buildRemotePath(provider: SyncProvider, path: string): string {
  if (provider.type === "local") return path;
  const remote = provider.rclone_remote || "";
  const r = remote.endsWith(":") ? remote : remote + ":";
  const p = path.startsWith("/") ? path.slice(1) : path;
  return `${r}${p}`;
}

// ─── Provider CRUD ───

export async function listProviders(): Promise<SyncProvider[]> {
  const result = await query<SyncProvider>(
    "SELECT * FROM sync_providers ORDER BY created_at",
  );
  return result.rows;
}

export async function getProvider(id: string): Promise<SyncProvider | null> {
  const result = await query<SyncProvider>(
    "SELECT * FROM sync_providers WHERE id = $1",
    [id],
  );
  return result.rows[0] || null;
}

export async function createProvider(data: {
  id: string;
  name: string;
  type: string;
  rclone_remote?: string;
  config?: Record<string, unknown>;
}): Promise<SyncProvider> {
  const result = await query<SyncProvider>(
    `INSERT INTO sync_providers (id, name, type, rclone_remote, config, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [data.id, data.name, data.type, data.rclone_remote || null, JSON.stringify(data.config || {})],
  );
  return result.rows[0];
}

export async function updateProvider(
  id: string,
  data: Partial<{ name: string; rclone_remote: string; config: Record<string, unknown>; status: string; status_message: string }>,
): Promise<SyncProvider> {
  const updates: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { updates.push(`name = $${idx++}`); params.push(data.name); }
  if (data.rclone_remote !== undefined) { updates.push(`rclone_remote = $${idx++}`); params.push(data.rclone_remote); }
  if (data.config !== undefined) { updates.push(`config = $${idx++}`); params.push(JSON.stringify(data.config)); }
  if (data.status !== undefined) { updates.push(`status = $${idx++}`); params.push(data.status); }
  if (data.status_message !== undefined) { updates.push(`status_message = $${idx++}`); params.push(data.status_message); }

  params.push(id);
  const result = await query<SyncProvider>(
    `UPDATE sync_providers SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0];
}

export async function deleteProvider(id: string): Promise<void> {
  await query("DELETE FROM sync_providers WHERE id = $1", [id]);
}

// ─── Check provider connectivity ───

export async function checkProvider(provider: SyncProvider): Promise<{ ok: boolean; message: string }> {
  try {
    if (provider.type === "local") {
      const { access } = await import("node:fs/promises");
      const basePath = (provider.config as any).basePath || "/";
      await access(basePath);
      return { ok: true, message: "Local filesystem accessible" };
    }

    const remote = provider.rclone_remote || "";
    const r = remote.endsWith(":") ? remote : remote + ":";
    await rcloneExec(["lsd", r, "--max-depth", "1"]);
    return { ok: true, message: "Connected successfully" };
  } catch (err: any) {
    return { ok: false, message: err.message || String(err) };
  }
}

// ─── Pair CRUD ───

export async function listPairs(): Promise<SyncPair[]> {
  const result = await query<SyncPair>(
    `SELECT sp.*,
       row_to_json(src) AS source_provider,
       row_to_json(tgt) AS target_provider
     FROM sync_pairs sp
     JOIN sync_providers src ON sp.source_provider_id = src.id
     JOIN sync_providers tgt ON sp.target_provider_id = tgt.id
     ORDER BY sp.created_at`,
  );
  return result.rows;
}

export async function getPair(id: string): Promise<SyncPair | null> {
  const result = await query<SyncPair>(
    `SELECT sp.*,
       row_to_json(src) AS source_provider,
       row_to_json(tgt) AS target_provider
     FROM sync_pairs sp
     JOIN sync_providers src ON sp.source_provider_id = src.id
     JOIN sync_providers tgt ON sp.target_provider_id = tgt.id
     WHERE sp.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function createPair(data: {
  name: string;
  source_provider_id: string;
  source_path: string;
  target_provider_id: string;
  target_path: string;
  direction?: string;
  schedule?: string;
  exclude_patterns?: string[];
}): Promise<SyncPair> {
  const result = await query<SyncPair>(
    `INSERT INTO sync_pairs (name, source_provider_id, source_path, target_provider_id, target_path, direction, schedule, exclude_patterns)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.name,
      data.source_provider_id,
      data.source_path,
      data.target_provider_id,
      data.target_path,
      data.direction || "bisync",
      data.schedule || "manual",
      data.exclude_patterns || [".DS_Store", "._*", ".Trash", "Thumbs.db", ".git"],
    ],
  );
  return result.rows[0];
}

export async function updatePair(
  id: string,
  data: Partial<{
    name: string;
    source_path: string;
    target_path: string;
    direction: string;
    schedule: string;
    enabled: boolean;
    exclude_patterns: string[];
  }>,
): Promise<SyncPair> {
  const updates: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { updates.push(`name = $${idx++}`); params.push(data.name); }
  if (data.source_path !== undefined) { updates.push(`source_path = $${idx++}`); params.push(data.source_path); }
  if (data.target_path !== undefined) { updates.push(`target_path = $${idx++}`); params.push(data.target_path); }
  if (data.direction !== undefined) { updates.push(`direction = $${idx++}`); params.push(data.direction); }
  if (data.schedule !== undefined) { updates.push(`schedule = $${idx++}`); params.push(data.schedule); }
  if (data.enabled !== undefined) { updates.push(`enabled = $${idx++}`); params.push(data.enabled); }
  if (data.exclude_patterns !== undefined) { updates.push(`exclude_patterns = $${idx++}`); params.push(data.exclude_patterns); }

  params.push(id);
  const result = await query<SyncPair>(
    `UPDATE sync_pairs SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0];
}

export async function deletePair(id: string): Promise<void> {
  await query("DELETE FROM sync_pairs WHERE id = $1", [id]);
}

// ─── Browse filesystem / remote ───

export async function browse(providerId: string, path: string): Promise<BrowseEntry[]> {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  if (provider.type === "local") {
    const { readdir, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const fullPath = path || "/";
    const entries = await readdir(fullPath);
    const results: BrowseEntry[] = [];

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      try {
        const s = await stat(join(fullPath, entry));
        results.push({
          name: entry,
          path: join(fullPath, entry),
          is_dir: s.isDirectory(),
          size: s.size,
          mod_time: s.mtime.toISOString(),
        });
      } catch {
        // skip unreadable entries
      }
    }

    return results.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // rclone lsjson for remote providers
  const remotePath = buildRemotePath(provider, path || "");
  const stdout = await rcloneExec(["lsjson", remotePath, "--no-modtime", "--no-mimetype"]);
  const items = JSON.parse(stdout || "[]") as Array<{ Path: string; Name: string; Size: number; IsDir: boolean; ModTime?: string }>;

  return items
    .map((item) => ({
      name: item.Name,
      path: path ? `${path}/${item.Name}` : item.Name,
      is_dir: item.IsDir,
      size: item.Size || 0,
      mod_time: item.ModTime || "",
    }))
    .sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// ─── Sync execution ───

export async function executeSyncPair(pairId: string): Promise<SyncRun> {
  const pair = await getPair(pairId);
  if (!pair) throw new Error(`Sync pair not found: ${pairId}`);
  if (!pair.source_provider || !pair.target_provider) throw new Error("Provider data missing");

  const runResult = await query<SyncRun>(
    `INSERT INTO sync_runs (pair_id, direction) VALUES ($1, $2) RETURNING *`,
    [pairId, pair.direction],
  );
  const run = runResult.rows[0];

  await query(
    `UPDATE sync_pairs SET last_sync_status = 'running', updated_at = NOW() WHERE id = $1`,
    [pairId],
  );

  const sourcePath = buildRemotePath(pair.source_provider, pair.source_path);
  const targetPath = buildRemotePath(pair.target_provider, pair.target_path);

  const args: string[] = [];

  switch (pair.direction) {
    case "push":
      args.push("sync", sourcePath, targetPath);
      break;
    case "pull":
      args.push("sync", targetPath, sourcePath);
      break;
    case "bisync":
      args.push("bisync", sourcePath, targetPath, "--resync");
      break;
    default:
      args.push("sync", sourcePath, targetPath);
  }

  for (const pattern of pair.exclude_patterns || []) {
    args.push("--exclude", pattern);
  }

  args.push("--stats-one-line", "--stats-log-level", "NOTICE", "-v");

  try {
    const output = await rcloneExec(args);

    const transferredMatch = output.match(/Transferred:\s+(\d+)\s/);
    const deletedMatch = output.match(/Deleted:\s+(\d+)/);

    const filesTransferred = transferredMatch ? parseInt(transferredMatch[1], 10) : 0;
    const filesDeleted = deletedMatch ? parseInt(deletedMatch[1], 10) : 0;

    await query(
      `UPDATE sync_runs SET status = 'success', completed_at = NOW(),
         files_transferred = $1, files_deleted = $2,
         details = $3
       WHERE id = $4`,
      [filesTransferred, filesDeleted, JSON.stringify({ output: output.slice(0, 10000) }), run.id],
    );

    await query(
      `UPDATE sync_pairs SET last_sync_at = NOW(), last_sync_status = 'success',
         last_sync_message = $1, files_synced = files_synced + $2, updated_at = NOW()
       WHERE id = $3`,
      [`${filesTransferred} transferred, ${filesDeleted} deleted`, filesTransferred, pairId],
    );

    return { ...run, status: "success", files_transferred: filesTransferred, files_deleted: filesDeleted };
  } catch (err: any) {
    const errorMsg = err.message || String(err);

    await query(
      `UPDATE sync_runs SET status = 'error', completed_at = NOW(), error_message = $1 WHERE id = $2`,
      [errorMsg.slice(0, 2000), run.id],
    );

    await query(
      `UPDATE sync_pairs SET last_sync_at = NOW(), last_sync_status = 'error',
         last_sync_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorMsg.slice(0, 500), pairId],
    );

    return { ...run, status: "error", error_message: errorMsg };
  }
}

// ─── Run history ───

export async function listRuns(pairId?: string, limit = 50): Promise<SyncRun[]> {
  if (pairId) {
    const result = await query<SyncRun>(
      `SELECT * FROM sync_runs WHERE pair_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [pairId, limit],
    );
    return result.rows;
  }

  const result = await query<SyncRun>(
    `SELECT sr.*, sp.name AS pair_name FROM sync_runs sr
     JOIN sync_pairs sp ON sr.pair_id = sp.id
     ORDER BY sr.started_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

// ─── Stats ───

export async function getSyncStats(): Promise<{
  total_pairs: number;
  active_pairs: number;
  running: number;
  last_error: SyncRun | null;
  total_runs: number;
  providers: number;
}> {
  const [pairs, running, lastError, totalRuns, providers] = await Promise.all([
    query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE enabled) AS active FROM sync_pairs"),
    query("SELECT COUNT(*) AS count FROM sync_runs WHERE status = 'running'"),
    query<SyncRun>("SELECT * FROM sync_runs WHERE status = 'error' ORDER BY started_at DESC LIMIT 1"),
    query("SELECT COUNT(*) AS count FROM sync_runs"),
    query("SELECT COUNT(*) AS count FROM sync_providers"),
  ]);

  return {
    total_pairs: parseInt(pairs.rows[0].total, 10),
    active_pairs: parseInt(pairs.rows[0].active, 10),
    running: parseInt(running.rows[0].count, 10),
    last_error: lastError.rows[0] || null,
    total_runs: parseInt(totalRuns.rows[0].count, 10),
    providers: parseInt(providers.rows[0].count, 10),
  };
}

// ─── List rclone remotes (auto-discover) ───

export async function listRcloneRemotes(): Promise<Array<{ name: string; type: string }>> {
  try {
    const output = await rcloneExec(["listremotes", "--long"]);
    return output
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        const [name, type] = line.split(/\s+/);
        return { name: name.replace(/:$/, ""), type: type || "unknown" };
      });
  } catch {
    return [];
  }
}

// ─── Check if rclone is installed ───

export async function isRcloneInstalled(): Promise<boolean> {
  try {
    await execFileAsync("which", ["rclone"]);
    return true;
  } catch {
    return false;
  }
}

// ─── Scheduled sync runner ───

const SCHEDULE_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "daily": 24 * 60 * 60_000,
};

let syncTimer: ReturnType<typeof setInterval> | null = null;
const runningPairs = new Set<string>();

async function tickScheduledSyncs(onComplete?: (pairId: string, run: SyncRun) => void): Promise<void> {
  try {
    const pairs = await listPairs();
    const now = Date.now();

    for (const pair of pairs) {
      if (!pair.enabled || pair.schedule === "manual") continue;
      if (runningPairs.has(pair.id)) continue;

      const intervalMs = SCHEDULE_MS[pair.schedule];
      if (!intervalMs) continue;

      const lastSync = pair.last_sync_at ? new Date(pair.last_sync_at).getTime() : 0;
      if (now - lastSync < intervalMs) continue;

      // Time to sync
      runningPairs.add(pair.id);
      console.log(`[CloudSync] Scheduled sync: ${pair.name} (${pair.schedule})`);

      executeSyncPair(pair.id)
        .then((run) => {
          console.log(`[CloudSync] Completed: ${pair.name} — ${run.status}`);
          onComplete?.(pair.id, run);
        })
        .catch((err) => console.error(`[CloudSync] Failed: ${pair.name}`, err))
        .finally(() => runningPairs.delete(pair.id));
    }
  } catch (err) {
    console.error("[CloudSync] Scheduler tick error:", err);
  }
}

export function startSyncScheduler(onComplete?: (pairId: string, run: SyncRun) => void): void {
  if (syncTimer) return;
  console.log("[CloudSync] Scheduler started (checking every 30s)");
  syncTimer = setInterval(() => tickScheduledSyncs(onComplete), 30_000);
  // Run once immediately
  tickScheduledSyncs(onComplete);
}

export function stopSyncScheduler(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log("[CloudSync] Scheduler stopped");
  }
}
