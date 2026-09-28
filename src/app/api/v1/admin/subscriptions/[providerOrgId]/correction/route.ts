import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { correctSubscription } from "@/server/modules/admin";

const body = z.object({ paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), reason: z.string().trim().min(3).max(500) });

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ providerOrgId: z.string().min(1).max(64) }), body }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => correctSubscription(tx, actor, params.providerOrgId, body.paidUntil, body.reason));
});
