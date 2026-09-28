import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listUnmatchedRequests } from "@/server/modules/requests";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] }, async ({ actor }) => withActor(actor, (tx) => listUnmatchedRequests(tx, actor)));
