import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getEquipmentHistory } from "@/server/modules/assets";

export const GET = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) =>
  withActor(actor, (tx) => getEquipmentHistory(tx, actor, params.id)),
);
