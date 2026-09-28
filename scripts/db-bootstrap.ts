/**
 * Local/staging database bootstrap. Run once with a PostgreSQL superuser:
 *
 *   npm run db:bootstrap                        (dev database from .env)
 *   ENV_FILE=.env.test npm run db:bootstrap     (test database)
 *
 * Creates (idempotently):
 *   - mh_owner  : owns the schema, runs migrations (MIGRATION_DATABASE_URL)
 *   - mh_app    : web runtime, row-level security enforced (DATABASE_URL)
 *   - mh_auth   : Better Auth runtime, identity tables only (AUTH_DATABASE_URL)
 *   - mh_worker : background worker (WORKER_DATABASE_URL)
 * None of the runtime roles is superuser, owner, or has BYPASSRLS.
 * Role names are fixed because migrations reference them in GRANTs and policies.
 */
import { Client } from "pg";
import { loadEnv, requireEnv } from "./lib/load-env";

const EXPECTED = {
  MIGRATION_DATABASE_URL: "mh_owner",
  DATABASE_URL: "mh_app",
  AUTH_DATABASE_URL: "mh_auth",
  WORKER_DATABASE_URL: "mh_worker",
} as const;

function ident(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function literal(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const file = loadEnv();
  const superUrl = requireEnv("POSTGRES_SUPERUSER_URL");
  const roles = Object.entries(EXPECTED).map(([envName, expectedUser]) => {
    const url = new URL(requireEnv(envName));
    const user = decodeURIComponent(url.username);
    if (user !== expectedUser) {
      throw new Error(`${envName} must use role "${expectedUser}" (found "${user}").`);
    }
    return { user, password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  });
  const database = roles[0]!.database;
  if (roles.some((r) => r.database !== database)) {
    throw new Error("All database URLs must point at the same database.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:bootstrap is a local/staging helper. Provision production roles as documented in docs/DEPLOYMENT.md.");
  }

  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  try {
    for (const role of roles) {
      if (role.password.length < 12) throw new Error(`Password for ${role.user} must be at least 12 characters.`);
      const exists = await admin.query("select 1 from pg_roles where rolname = $1", [role.user]);
      const verb = exists.rowCount ? "ALTER" : "CREATE";
      await admin.query(
        `${verb} ROLE ${ident(role.user)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(role.password)}`,
      );
      console.log(`[bootstrap] role ${role.user}: ${verb === "CREATE" ? "created" : "updated"}`);
    }
    const dbExists = await admin.query("select 1 from pg_database where datname = $1", [database]);
    if (!dbExists.rowCount) {
      await admin.query(`CREATE DATABASE ${ident(database)} OWNER mh_owner ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`[bootstrap] database ${database}: created`);
    } else {
      await admin.query(`ALTER DATABASE ${ident(database)} OWNER TO mh_owner`);
      console.log(`[bootstrap] database ${database}: exists`);
    }
  } finally {
    await admin.end();
  }

  const dbUrl = new URL(superUrl);
  dbUrl.pathname = `/${database}`;
  const db = new Client({ connectionString: dbUrl.toString() });
  await db.connect();
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await db.query(`REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC`);
    await db.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(database)} TO mh_app, mh_auth, mh_worker`);
    await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await db.query("ALTER SCHEMA public OWNER TO mh_owner");
    await db.query("GRANT USAGE ON SCHEMA public TO mh_app, mh_auth, mh_worker");
    console.log(`[bootstrap] ${file}: database ${database} ready. Next: npm run db:migrate`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("[bootstrap] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
