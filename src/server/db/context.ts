import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/roles";
import { mapDatabaseError } from "@/server/errors";
import { appDb } from "./clients";

/** Transaction client carrying the verified request context. Pass it to every nested call. */
export type Tx = Prisma.TransactionClient;

export type TxOptions = { timeoutMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel };

async function run<T>(db: PrismaClient, userId: string, orgId: string, fn: (tx: Tx) => Promise<T>, opts?: TxOptions) {
  try {
    return await db.$transaction(
      async (tx) => {
        // Transaction-local (is_local = true): never leaks to other pooled requests.
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.org_id', ${orgId}, true)`;
        return fn(tx);
      },
      { maxWait: 5_000, timeout: opts?.timeoutMs ?? 15_000, isolationLevel: opts?.isolationLevel },
    );
  } catch (error) {
    throw mapDatabaseError(error) ?? error;
  }
}

/**
 * Runs `fn` in one database transaction as the given actor. The user and acting
 * organization come from the verified session; PostgreSQL re-validates membership in
 * every policy (app.org()), so row-level security applies to all queries in `fn`.
 */
export function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
  return run(appDb(), actor.userId, actor.orgId, fn, opts);
}

/** Anonymous context: only public projections (approved providers, reference data) are visible. */
export function withPublic<T>(fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
  return run(appDb(), "", "", fn, opts);
}

/** Signed-in user without an acting organization (onboarding, invitation acceptance). */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
  return run(appDb(), userId, "", fn, opts);
}
