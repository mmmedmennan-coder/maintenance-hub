import { z } from "zod";
import { reasonSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { hideReviewResponse } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: reasonSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => hideReviewResponse(tx, actor, params.id, body.reason));
});
