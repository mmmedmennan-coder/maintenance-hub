import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listReviewsForModeration } from "@/server/modules/feedback";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], query: z.object({ status: z.enum(["PENDING_MODERATION", "PUBLISHED", "REJECTED"]).default("PENDING_MODERATION") }) }, async ({ actor, query }) =>
  withActor(actor, (tx) => listReviewsForModeration(tx, actor, query.status)),
);
