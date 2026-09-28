import { serviceAreaSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { upsertServiceArea } from "@/server/modules/reference";

export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], body: serviceAreaSchema }, async ({ actor, body }) => withActor(actor, (tx) => upsertServiceArea(tx, actor, null, body)));
