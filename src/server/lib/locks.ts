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

/**
 * SELECT ... FOR UPDATE on one row (subject to row-level security). Serializes competing
 * transitions on the same aggregate; returns false when the row is not visible.
 */
export async function lockForUpdate(tx: Tx, table: keyof typeof LOCKABLE, id: string): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${LOCKABLE[table]}" WHERE id = $1 FOR UPDATE`, id);
  return rows.length > 0;
}
