/**
 * Drops and recreates the application schema of a LOCAL development or test database.
 * Refuses to run in production or against a database whose name does not end with
 * "_dev", "_test" or equal "maintenance_hub". Requires --yes.
 *
 *   npm run db:reset-dev -- --yes && npm run db:migrate && npm run db:seed
 */
import { Client } from "pg";
import { loadEnv, requireEnv } from "./lib/load-env";

async function main() {
  const file = loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
  if (!process.argv.includes("--yes")) throw new Error("This destroys all data. Re-run with --yes to confirm.");
  const url = new URL(requireEnv("MIGRATION_DATABASE_URL"));
  const database = url.pathname.slice(1);
  if (!(database === "maintenance_hub" || database.endsWith("_dev") || database.endsWith("_test"))) {
    throw new Error(`Refusing to reset database "${database}" (not a recognised local database name).`);
  }
  if (!["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(url.hostname)) {
    throw new Error(`Refusing to reset a non-local database host (${url.hostname}).`);
  }
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS app CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO mh_app, mh_auth, mh_worker;
    `);
    console.log(`[reset] ${file}: schema of ${database} dropped and recreated. Next: npm run db:migrate`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[reset] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
