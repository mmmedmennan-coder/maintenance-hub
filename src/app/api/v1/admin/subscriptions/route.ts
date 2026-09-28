import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listSubscriptions } from "@/server/modules/admin";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] }, async ({ actor }) => withActor(actor, (tx) => listSubscriptions(tx, actor)));
