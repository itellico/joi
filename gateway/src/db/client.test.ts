import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let poolConstructorArgs: Record<string, unknown>[] = [];
const mockPoolInstance = {
  on: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock("pg", () => {
  class MockPool {
    constructor(config: Record<string, unknown>) {
      poolConstructorArgs.push(config);
      Object.assign(this, mockPoolInstance);
    }
  }
  return { default: { Pool: MockPool }, Pool: MockPool };
});

const originalEnv = { ...process.env };
const TEST_DB_URL = "postgresql://joi:joi@192.168.178.58:5434/joi";

function resetModule() {
  vi.resetModules();
  poolConstructorArgs = [];
}

describe("db/client buildPoolConfig", () => {
  beforeEach(() => {
    resetModule();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when DATABASE_URL is not set", async () => {
    const client = await import("./client.js");
    await expect(client.query("SELECT 1")).rejects.toThrow("DATABASE_URL is not set");
  });

  it("uses DATABASE_URL when set", async () => {
    process.env.DATABASE_URL = TEST_DB_URL;

    const client = await import("./client.js");
    await client.query("SELECT 1");

    expect(poolConstructorArgs).toHaveLength(1);
    const arg = poolConstructorArgs[0];
    expect(arg.connectionString).toBe(TEST_DB_URL);
    expect(arg.ssl).toBe(false);
    expect(arg.connectionTimeoutMillis).toBe(5000);
    expect(arg.max).toBe(20);
  });

  it("passes connectionString directly without parsing", async () => {
    const url = "postgresql://user:pass@10.0.0.1:5432/mydb";
    process.env.DATABASE_URL = url;

    const client = await import("./client.js");
    await client.query("SELECT 1");

    expect(poolConstructorArgs[0].connectionString).toBe(url);
    expect(poolConstructorArgs[0].host).toBeUndefined();
  });
});

describe("db/client pool auto-reset", () => {
  beforeEach(() => {
    resetModule();
    process.env.DATABASE_URL = TEST_DB_URL;
    mockPoolInstance.end.mockReset();
    mockPoolInstance.end.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resets pool after 3 consecutive failures", async () => {
    const client = await import("./client.js");
    await client.query("SELECT 1");
    expect(poolConstructorArgs).toHaveLength(1);

    await client.recordFailure();
    await client.recordFailure();
    expect(poolConstructorArgs).toHaveLength(1);

    await client.recordFailure();
    expect(mockPoolInstance.end).toHaveBeenCalled();

    await client.query("SELECT 1");
    expect(poolConstructorArgs).toHaveLength(2);
  });

  it("resets failure counter on success", async () => {
    const client = await import("./client.js");
    await client.query("SELECT 1");

    await client.recordFailure();
    await client.recordFailure();
    client.recordSuccess();

    await client.recordFailure();
    expect(poolConstructorArgs).toHaveLength(1);
  });

  it("resetPool destroys and allows recreation", async () => {
    const client = await import("./client.js");
    await client.query("SELECT 1");
    expect(poolConstructorArgs).toHaveLength(1);

    await client.resetPool();
    expect(mockPoolInstance.end).toHaveBeenCalled();

    await client.query("SELECT 1");
    expect(poolConstructorArgs).toHaveLength(2);
  });

  it("resetPool is safe when pool doesn't exist", async () => {
    const client = await import("./client.js");
    await client.resetPool();
    expect(mockPoolInstance.end).not.toHaveBeenCalled();
  });
});

describe("db/client transaction", () => {
  beforeEach(() => {
    resetModule();
    process.env.DATABASE_URL = TEST_DB_URL;
    mockPoolInstance.connect.mockReset();
    mockPoolInstance.query.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("commits on success", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPoolInstance.connect.mockResolvedValue(mockClient);

    const client = await import("./client.js");
    const result = await client.transaction(async (c) => {
      await c.query("INSERT INTO t VALUES (1)");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("rolls back on error and rethrows", async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === "FAIL") throw new Error("boom");
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPoolInstance.connect.mockResolvedValue(mockClient);

    const client = await import("./client.js");
    await expect(
      client.transaction(async (c) => {
        await c.query("FAIL");
      }),
    ).rejects.toThrow("boom");

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe("db/client close", () => {
  beforeEach(() => {
    resetModule();
    process.env.DATABASE_URL = TEST_DB_URL;
    mockPoolInstance.end.mockReset();
    mockPoolInstance.end.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("ends the pool and nullifies it", async () => {
    const client = await import("./client.js");
    await client.query("SELECT 1");

    await client.close();
    expect(mockPoolInstance.end).toHaveBeenCalled();
  });

  it("is a no-op when pool was never created", async () => {
    const client = await import("./client.js");
    await client.close();
    expect(mockPoolInstance.end).not.toHaveBeenCalled();
  });
});
