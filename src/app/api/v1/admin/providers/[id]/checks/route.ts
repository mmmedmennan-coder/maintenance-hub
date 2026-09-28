import { z } from "zod";
import { providerCheckSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { upsertProviderCheck } from "@/server/modules/admin";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: providerCheckSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => upsertProviderCheck(tx, actor, params.id, body));
});
