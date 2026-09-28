import "server-only";
import type { Tx } from "@/server/db/context";

const LOCKABLE = {
  service_request: "service_request",
  booking: "booking",
  offer: "offer",
  work_order: "work_order",
  repair_quote: "repair_quote",
  payment_record: "payment_record",
  reschedule_proposal: "reschedule_proposal",
  maintenance_plan: "maintenance_plan",
} as const;

type Lockable = keyof typeof LOCKABLE;

/** Transaction-scoped advisory lock on one aggregate (released at commit/rollback). */
async function advisoryLock(tx: Tx, table: Lockable, id: string) {
  await tx.$queryRawUnsafe(`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))`, `${LOCKABLE[table]}:${id}`);
}

/**
 * SELECT ... FOR UPDATE on one row (subject to row-level security). Serializes competing
 * transitions on the same aggregate; returns false when the row is not visible or not
 * updatable by the caller. Service requests additionally take an advisory lock so that
 * platform routing (which may read but not update a customer's request) is serialized too.
 */
export async function lockForUpdate(tx: Tx, table: Lockable, id: string): Promise<boolean> {
  if (table === "service_request") await advisoryLock(tx, table, id);
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${LOCKABLE[table]}" WHERE id = $1 FOR UPDATE`, id);
  return rows.length > 0;
}

/** For callers allowed to read but not update the row (platform routing): advisory lock + visibility. */
export async function lockVisible(tx: Tx, table: Lockable, id: string): Promise<boolean> {
  await advisoryLock(tx, table, id);
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${LOCKABLE[table]}" WHERE id = $1`, id);
  return rows.length > 0;
}
