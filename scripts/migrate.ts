/**
 * Applies pending SQL migrations from prisma/migrations using the migration (owner) role.
 * Records history in `_prisma_migrations`, exactly like `prisma migrate deploy`.
 *
 *   npm run db:migrate                 (uses .env)
 *   ENV_FILE=.env.test npm run db:migrate
 */
import { loadEnv, requireEnv } from "./lib/load-env";
import { createEngine, NO_FILTERS, readMigrationsList } from "./lib/schema-engine";

async function main() {
  const file = loadEnv();
  const url = requireEnv("MIGRATION_DATABASE_URL");
  const { engine } = await createEngine(url);
  try {
    const result = await engine.applyMigrations({
      migrationsList: readMigrationsList(),
      filters: NO_FILTERS,
    });
    const applied = result.appliedMigrationNames;
    console.log(
      applied.length === 0
        ? `[migrate] ${file}: database is up to date.`
        : `[migrate] ${file}: applied ${applied.length} migration(s):\n  - ${applied.join("\n  - ")}`,
    );
  } finally {
    engine.free();
  }
}

main().catch((error) => {
  console.error("[migrate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
