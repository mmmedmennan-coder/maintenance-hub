import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getProviderForReview } from "@/server/modules/admin";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => withActor(actor, (tx) => getProviderForReview(tx, actor, params.id)));
