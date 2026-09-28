import { z } from "zod";
import { disputeResolutionSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { adminDisputeAction } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: disputeResolutionSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => adminDisputeAction(tx, actor, params.id, body));
});
