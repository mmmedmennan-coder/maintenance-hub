import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { setSiteArchived } from "@/server/modules/assets";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }), body: z.object({ archived: z.boolean() }) }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => setSiteArchived(tx, actor, params.id, body.archived));
});
