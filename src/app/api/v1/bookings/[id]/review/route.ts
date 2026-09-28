import { z } from "zod";
import { reviewSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { createReview } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }), body: reviewSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => createReview(tx, actor, params.id, body)),
);
