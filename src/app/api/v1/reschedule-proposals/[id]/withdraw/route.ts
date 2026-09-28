import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { withdrawReschedule } from "@/server/modules/bookings";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => withdrawReschedule(tx, actor, params.id));
});
