import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { respondToReschedule } from "@/server/modules/bookings";

const body = z.object({
  accept: z.boolean(),
  note: z.string().trim().max(500).optional().nullable(),
  technicianId: z.uuid().optional().nullable(),
});

/** Other party accepts (atomic slot replacement) or rejects a proposed new slot. */
export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => respondToReschedule(tx, actor, params.id, body.accept, { note: body.note, technicianId: body.technicianId })),
);
