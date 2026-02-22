import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { query, close } from "./client.js";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../../.env") });

async function reset(): Promise<void> {
  console.log("Resetting database...");

  await query("DROP SCHEMA public CASCADE");
  await query("CREATE SCHEMA public");
  await query("GRANT ALL ON SCHEMA public TO joi");

  console.log("Database reset. Run `pnpm db:migrate` to re-apply migrations.");
  await close();
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
