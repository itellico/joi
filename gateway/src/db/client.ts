import pg from "pg";

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

export default { query, getClient, transaction, close, resetPool, recordSuccess, recordFailure };
