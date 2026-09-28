import { z } from "zod";
import { subscriptionPeriodSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { recordSubscriptionPeriod } from "@/server/modules/admin";

/** Manually recorded subscription period (pilot). Audited. */
export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ providerOrgId: z.string().min(1).max(64) }), body: subscriptionPeriodSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => recordSubscriptionPeriod(tx, actor, params.providerOrgId, body));
});
