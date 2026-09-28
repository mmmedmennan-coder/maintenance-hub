import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listProvidersForReview } from "@/server/modules/admin";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], query: z.object({ status: z.string().max(20).optional() }) }, async ({ actor, query }) =>
  withActor(actor, (tx) => listProvidersForReview(tx, actor, query.status)),
);
