import { z } from "zod";
import { noShowSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { reportNoShow } from "@/server/modules/bookings";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body: noShowSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => reportNoShow(tx, actor, params.id, body));
});
