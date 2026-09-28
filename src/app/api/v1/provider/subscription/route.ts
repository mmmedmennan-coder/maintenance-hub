import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getEntitlement } from "@/server/modules/providers";

export const GET = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] }, async ({ actor }) => withActor(actor, (tx) => getEntitlement(tx, actor.orgId)));
