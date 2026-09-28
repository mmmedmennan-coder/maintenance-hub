import { z } from "zod";
import { rescheduleProposalSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { proposeReschedule } from "@/server/modules/bookings";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body: rescheduleProposalSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => proposeReschedule(tx, actor, params.id, body)),
);
