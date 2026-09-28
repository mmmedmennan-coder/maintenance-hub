/**
 * Generates a new migration folder containing the SQL needed to move from a previous
 * version of prisma/schema.prisma to the current one. No database is required.
 *
 *   npm run db:diff -- <migration_name> [--from <path-to-old-schema>|--from-empty]
 *
 * Default "from" is the committed schema (`git show HEAD:prisma/schema.prisma`).
 * Always review the generated SQL. Security objects (RLS, triggers, exclusion
 * constraints, grants) live in hand-written migrations and are never generated here.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./lib/load-env";
import { createEngine, MIGRATIONS_DIR, NO_FILTERS, SCHEMA_PATH } from "./lib/schema-engine";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--"));
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error("Usage: npm run db:diff -- <snake_case_name> [--from <file>|--from-empty]");
  }
  const current = fs.readFileSync(SCHEMA_PATH, "utf8");
  const fromIdx = args.indexOf("--from");
  let from: { tag: "empty" } | { tag: "schemaDatamodel"; files: { path: string; content: string }[] };
  if (args.includes("--from-empty")) {
    from = { tag: "empty" };
  } else {
    const previous =
      fromIdx >= 0
        ? fs.readFileSync(path.resolve(args[fromIdx + 1] ?? ""), "utf8")
        : execSync("git show HEAD:prisma/schema.prisma", { encoding: "utf8" });
    from = { tag: "schemaDatamodel", files: [{ path: "schema.prisma", content: previous }] };
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? "postgresql://unused@localhost:5432/unused";
  const { engine } = await createEngine(url, current);
  try {
    const result = await engine.diff({
      from,
      to: { tag: "schemaDatamodel", files: [{ path: "schema.prisma", content: current }] },
      script: true,
      exitCode: null,
      filters: NO_FILTERS,
    });
    const sql = (result.stdout ?? "").trim();
    if (!sql || sql === "-- This is an empty migration.") {
      console.log("[db:diff] No schema changes detected.");
      return;
    }
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const dir = path.join(MIGRATIONS_DIR, `${stamp}_${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "migration.sql"), sql + "\n");
    console.log(`[db:diff] Wrote ${path.relative(process.cwd(), dir)}/migration.sql — review it before applying.`);
  } finally {
    engine.free();
  }
}

main().catch((error) => {
  console.error("[db:diff] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
