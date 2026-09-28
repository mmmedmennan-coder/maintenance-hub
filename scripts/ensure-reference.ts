/** Inserts required reference data (categories, Rabat-Salé area, pilot plan). Idempotent. */
import { loadEnv } from "./lib/load-env";
import { ownerDb } from "./lib/owner-db";
import { ensureReferenceData } from "@/server/fixtures/reference-data";

async function main() {
  const file = loadEnv();
  const db = ownerDb();
  try {
    const { categories, area } = await ensureReferenceData(db);
    console.log(`[reference] ${file}: ${categories.length} equipment categories, area ${area.name}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[reference] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
