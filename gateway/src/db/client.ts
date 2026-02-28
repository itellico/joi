import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

let pool: pg.Pool | null = null;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_RESET = 3;

function buildPoolConfig(): pg.PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Check .env at the project root.");
  }

  return {
    connectionString,
    connectionTimeoutMillis: 5000,
    max: 20,
    ssl: false,
  };
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(buildPoolConfig());
    pool.on("error", (err) => {
      console.error("Unexpected PG pool error:", err);
    });
  }
  return pool;
}

/** Destroy and recreate the pool (e.g. after repeated connection failures). */
export async function resetPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch {
      // Ignore errors during teardown of a broken pool.
    }
    pool = null;
  }
  consecutiveFailures = 0;
}

/**
 * Record a query success/failure. After MAX_FAILURES_BEFORE_RESET consecutive
 * failures, the pool is destroyed and recreated on the next call. This handles
 * poisoned pools from transient network issues.
 */
export function recordSuccess(): void {
  consecutiveFailures = 0;
}

export async function recordFailure(): Promise<void> {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_FAILURES_BEFORE_RESET) {
    console.warn(
      `DB pool: ${consecutiveFailures} consecutive failures, resetting pool`,
    );
    await resetPool();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
  return getPool().connect();
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Re-read .env from disk, update DATABASE_URL in process.env, and reset the pool. */
export async function reloadFromEnv(): Promise<{ old: string; new: string }> {
  const oldUrl = process.env.DATABASE_URL || "(unset)";
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
  dotenv.config({ path: envPath, override: true });
  const runtimeScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/mini-runtime-env.sh");
  const result = spawnSync(runtimeScript, ["--plain"], { encoding: "utf-8", env: process.env });
  if (!result.error && result.status === 0) {
    const lines = (result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    for (const line of lines) {
      const equalIndex = line.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = line.slice(0, equalIndex).trim();
      const value = line.slice(equalIndex + 1);
      if (!key) continue;
      process.env[key] = value;
    }
  }
  const newUrl = process.env.DATABASE_URL || "(unset)";
  await resetPool();
  return { old: oldUrl, new: newUrl };
}

export default { query, getClient, transaction, close, resetPool, reloadFromEnv, recordSuccess, recordFailure };
