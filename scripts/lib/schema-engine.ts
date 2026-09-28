/**
 * Thin wrapper around Prisma's official WebAssembly schema engine
 * (@prisma/schema-engine-wasm, pinned to the engine hash of the installed Prisma 7.10.0).
 *
 * Why: `prisma migrate deploy` needs a native engine binary downloaded from
 * binaries.prisma.sh at first use. Using the WASM build of the same engine lets the
 * migration commands run on machines where that download is blocked (CI sandboxes,
 * restricted corporate networks) while writing the standard `_prisma_migrations`
 * history. `npx prisma migrate deploy` remains a fully compatible alternative.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { SchemaEngine } from "@prisma/schema-engine-wasm";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma/migrations");
export const SCHEMA_PATH = path.resolve(process.cwd(), "prisma/schema.prisma");

type ConnectedAdapter = {
  executeScript(script: string): Promise<void>;
  underlyingDriver(): { query(sql: string): Promise<unknown> };
};

/**
 * @prisma/adapter-pg 7.10 splits migration scripts on every ";" before executing them,
 * which breaks PL/pgSQL function bodies and loses atomicity. The native engine sends each
 * migration as one script; we restore that behaviour: the whole file is sent with the
 * simple-query protocol, so PostgreSQL runs it as a single implicit transaction.
 */
function wholeScript<T extends ConnectedAdapter>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === "executeScript") {
        return async (script: string) => {
          try {
            await target.underlyingDriver().query(script);
          } catch (error) {
            (target as unknown as { onError(e: unknown): never }).onError(error);
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

class WholeScriptPg {
  constructor(private readonly inner: PrismaPg) {}
  get provider() {
    return this.inner.provider;
  }
  get adapterName() {
    return this.inner.adapterName;
  }
  async connect() {
    return wholeScript(await this.inner.connect());
  }
  async connectToShadowDb() {
    return wholeScript(await this.inner.connectToShadowDb());
  }
}

export async function createEngine(connectionString: string, schemaContent?: string) {
  const content = schemaContent ?? fs.readFileSync(SCHEMA_PATH, "utf8");
  const factory = new WholeScriptPg(new PrismaPg({ connectionString }));
  const adapter = bindMigrationAwareSqlAdapterFactory(factory as unknown as PrismaPg);
  const logs: string[] = [];
  const engine = await SchemaEngine.new(
    { datamodels: [["schema.prisma", content]] },
    (line: string) => logs.push(line),
    adapter,
  );
  return { engine, logs };
}

export function readMigrationsList() {
  const dirs = fs.existsSync(MIGRATIONS_DIR)
    ? fs
        .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  const lockPath = path.join(MIGRATIONS_DIR, "migration_lock.toml");
  return {
    baseDir: MIGRATIONS_DIR,
    lockfile: {
      path: "migration_lock.toml",
      content: fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : null,
    },
    shadowDbInitScript: "",
    migrationDirectories: dirs.map((name) => {
      const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
      return {
        path: name,
        migrationFile: {
          path: "migration.sql",
          content: fs.existsSync(file)
            ? { tag: "ok" as const, value: fs.readFileSync(file, "utf8") }
            : { tag: "error" as const, value: "missing migration.sql" },
        },
      };
    }),
  };
}

export const NO_FILTERS = { externalTables: [] as string[], externalEnums: [] as string[] };
