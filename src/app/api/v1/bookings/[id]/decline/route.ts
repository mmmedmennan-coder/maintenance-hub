import { z } from "zod";
import { reasonSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { declineBooking } from "@/server/modules/bookings";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: reasonSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => declineBooking(tx, actor, params.id, body.reason));
});
