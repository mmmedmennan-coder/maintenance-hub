import { z } from "zod";
import { equipmentUpdateSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getEquipment, updateEquipment } from "@/server/modules/assets";

const params = z.object({ id: z.uuid() });

export const GET = actorRoute({ orgTypes: ["CUSTOMER"], params }, async ({ actor, params }) => withActor(actor, (tx) => getEquipment(tx, actor, params.id)));
export const PATCH = actorRoute({ orgTypes: ["CUSTOMER"], params, body: equipmentUpdateSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => updateEquipment(tx, actor, params.id, body)),
);
