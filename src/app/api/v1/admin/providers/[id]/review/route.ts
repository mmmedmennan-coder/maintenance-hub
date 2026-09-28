import { z } from "zod";
import { providerReviewSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { reviewProvider } from "@/server/modules/admin";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: providerReviewSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => reviewProvider(tx, actor, params.id, body));
});
