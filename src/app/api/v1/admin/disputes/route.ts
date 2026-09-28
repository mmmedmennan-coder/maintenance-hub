import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listDisputes } from "@/server/modules/feedback";

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], query: z.object({ status: z.string().max(20).optional() }) }, async ({ actor, query }) =>
  withActor(actor, (tx) => listDisputes(tx, actor, query.status)),
);
