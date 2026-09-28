import "server-only";
import type { Actor } from "@/server/auth/roles";
import { type Tx, withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { findIdempotentOutcome, idempotent } from "@/server/lib/infra";

/**
 * Runs a mutation with an optional Idempotency-Key (scoped to the acting organization and
 * operation). A concurrent duplicate that loses the race returns the committed outcome.
 */
export async function runIdempotent<T>(actor: Actor, operation: string, key: string | null, request: unknown, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    const result = await withActor(actor, (tx) => idempotent(tx, actor, operation, key, request, () => fn(tx)));
    return result.body;
  } catch (error) {
    if (key && error instanceof DomainError && ["CONFLICT", "INVALID_TRANSITION", "VERSION_CONFLICT"].includes(error.code)) {
      const replay = await withActor(actor, (tx) => findIdempotentOutcome<T>(tx, actor, operation, key, request));
      if (replay) return replay.body;
    }
    throw error;
  }
}
