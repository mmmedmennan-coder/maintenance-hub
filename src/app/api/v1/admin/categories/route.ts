import { categorySchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { upsertEquipmentCategory } from "@/server/modules/reference";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], body: categorySchema }, async ({ actor, body }) => withActor(actor, (tx) => upsertEquipmentCategory(tx, actor, null, body)));
