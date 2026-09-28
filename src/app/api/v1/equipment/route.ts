import { z } from "zod";
import { equipmentSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { createEquipment, listEquipment } from "@/server/modules/assets";

const query = z.object({ siteId: z.uuid().optional(), categoryId: z.uuid().optional(), archived: z.enum(["0", "1"]).optional(), page: z.coerce.number().int().min(1).max(500).default(1) });

export const GET = actorRoute({ orgTypes: ["CUSTOMER"], query }, async ({ actor, query }) =>
  withActor(actor, (tx) => listEquipment(tx, actor, { siteId: query.siteId, categoryId: query.categoryId, includeArchived: query.archived === "1", page: query.page })),
);

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], body: equipmentSchema }, async ({ actor, body }) => withActor(actor, (tx) => createEquipment(tx, actor, body)));
