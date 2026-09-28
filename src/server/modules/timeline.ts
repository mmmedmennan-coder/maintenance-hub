import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";

export type JobEventType = Prisma.JobEventCreateManyInput["type"];

/** Appends an immutable timeline event (who, which side, when, from/to status). */
export async function recordJobEvent(
  tx: Tx,
  actor: Actor,
  target: { bookingId: string; workOrderId?: string | null; customerOrgId: string; providerOrgId: string },
  type: JobEventType,
  extra: Partial<Pick<Prisma.JobEventCreateManyInput, "fromStatus" | "toStatus" | "note" | "metadata">> = {},
) {
  await tx.jobEvent.createMany({
    data: [
      {
        bookingId: target.bookingId,
        workOrderId: target.workOrderId ?? null,
        customerOrgId: target.customerOrgId,
        providerOrgId: target.providerOrgId,
        type,
        actorUserId: actor.userId,
        actorOrgId: actor.orgId,
        actorSide: actor.orgType === "PLATFORM" ? "PLATFORM" : actor.orgType === "CUSTOMER" ? "CUSTOMER" : "PROVIDER",
        actorName: actor.userName,
        ...extra,
      },
    ],
  });
}
