import { z } from "zod";
import { reviewModerationSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { moderateReview } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: reviewModerationSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => moderateReview(tx, actor, params.id, body));
});
