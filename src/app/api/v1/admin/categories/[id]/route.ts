import { z } from "zod";
import { categorySchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { upsertEquipmentCategory } from "@/server/modules/reference";

export const PATCH = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: categorySchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => upsertEquipmentCategory(tx, actor, params.id, body)),
);
