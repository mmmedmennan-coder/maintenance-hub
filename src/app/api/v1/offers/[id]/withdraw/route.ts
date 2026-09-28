import { z } from "zod";
import { reasonSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { withdrawOffer } from "@/server/modules/offers";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: reasonSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => withdrawOffer(tx, actor, params.id, body.reason));
});
