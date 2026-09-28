import { z } from "zod";
import { reviewResponseSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { respondToReview } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: reviewResponseSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => respondToReview(tx, actor, params.id, body.body));
});
