import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { query, close } from "./client.js";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../../.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY id",
  );
  return new Set(result.rows.map((r) => r.name));
}

async function migrate(): Promise<void> {
  console.log("Running migrations...");

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`  Applying: ${file}`);

    await query(sql);
    await query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    count++;
  }

  if (count === 0) {
    console.log("  No new migrations to apply.");
  } else {
    console.log(`  Applied ${count} migration(s).`);
  }

  await close();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
