import { z } from "zod";
import { reasonSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { cancelBooking } from "@/server/modules/bookings";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body: reasonSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => cancelBooking(tx, actor, params.id, body.reason));
});
