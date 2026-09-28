import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";
import { serialPool } from "./serial-pool";

type Clients = { app?: PrismaClient; auth?: PrismaClient; worker?: PrismaClient };

// Reuse clients across hot reloads in development.
const store = globalThis as unknown as { __maintenanceHubDb?: Clients };
const clients: Clients = (store.__maintenanceHubDb ??= {});

const pools: ReturnType<typeof serialPool>[] = [];

function create(connectionString: string, max: number) {
  const pool = serialPool(connectionString, max);
  pools.push(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: "stdout", level: "error" }] });
}

/** Web runtime role (mh_app): row-level security enforced. Use through withActor/withPublic. */
export function appDb(): PrismaClient {
  return (clients.app ??= create(getEnv().DATABASE_URL, 10));
}

/** Better Auth role (mh_auth): identity and membership tables only. */
export function authDb(): PrismaClient {
  return (clients.auth ??= create(getEnv().AUTH_DATABASE_URL, 5));
}

/** Worker role (mh_worker): outbox, e-mail, PDF generation and reminders. */
export function workerDb(): PrismaClient {
  const url = getEnv().WORKER_DATABASE_URL;
  if (!url) throw new Error("WORKER_DATABASE_URL is required for the worker");
  return (clients.worker ??= create(url, 4));
}

export async function disconnectAll() {
  await Promise.all([clients.app?.$disconnect(), clients.auth?.$disconnect(), clients.worker?.$disconnect()]);
  clients.app = clients.auth = clients.worker = undefined;
  await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
}
