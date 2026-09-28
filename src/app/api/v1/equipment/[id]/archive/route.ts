import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { setEquipmentArchived } from "@/server/modules/assets";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }), body: z.object({ archived: z.boolean() }) }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => setEquipmentArchived(tx, actor, params.id, body.archived));
});
