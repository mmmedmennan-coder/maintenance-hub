/**
 * Integration tests run against a REAL PostgreSQL test database (.env.test) using the
 * production-style roles: mh_app (RLS enforced), mh_auth, mh_worker. The schema is reset
 * and migrated once per run; reference data is inserted through the owner role.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { config } from "dotenv";

export default async function setup() {
  config({ path: ".env.test", override: true, quiet: true });
  const env = { ...process.env, ENV_FILE: ".env.test" };
  execSync("npx tsx scripts/db-reset-dev.ts --yes", { stdio: "inherit", env });
  execSync("npx tsx scripts/migrate.ts", { stdio: "inherit", env });
  execSync("npx tsx --tsconfig tsconfig.worker.json scripts/ensure-reference.ts", { stdio: "inherit", env });
  fs.rmSync(process.env.STORAGE_LOCAL_DIR ?? "./storage/test-private", { recursive: true, force: true });
}
