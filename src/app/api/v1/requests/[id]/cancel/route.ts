import { z } from "zod";
import { reasonSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { cancelRequest } from "@/server/modules/requests";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }), body: reasonSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => cancelRequest(tx, actor, params.id, body.reason));
});
