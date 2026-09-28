import { paginationQuery } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listNotifications } from "@/server/modules/notifications";

export const GET = actorRoute({ query: paginationQuery }, async ({ actor, query }) => withActor(actor, (tx) => listNotifications(tx, actor, query.page)));
