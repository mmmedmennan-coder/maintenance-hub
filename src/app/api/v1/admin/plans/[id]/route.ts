import { z } from "zod";
import { subscriptionPlanSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { updateSubscriptionPlan } from "@/server/modules/admin";

export const PATCH = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: subscriptionPlanSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => updateSubscriptionPlan(tx, actor, params.id, body));
});
