import { z } from "zod";
import { siteSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { createSite, listSites } from "@/server/modules/assets";

export const GET = actorRoute({ orgTypes: ["CUSTOMER"], query: z.object({ archived: z.enum(["0", "1"]).optional() }) }, async ({ actor, query }) =>
  withActor(actor, (tx) => listSites(tx, actor, { includeArchived: query.archived === "1" })),
);

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], body: siteSchema }, async ({ actor, body }) => withActor(actor, (tx) => createSite(tx, actor, body)));
