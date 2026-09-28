import { z } from "zod";
import { siteUpdateSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getSite, updateSite } from "@/server/modules/assets";

const params = z.object({ id: z.uuid() });

export const GET = actorRoute({ orgTypes: ["CUSTOMER"], params }, async ({ actor, params }) => withActor(actor, (tx) => getSite(tx, actor, params.id)));
export const PATCH = actorRoute({ orgTypes: ["CUSTOMER"], params, body: siteUpdateSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => updateSite(tx, actor, params.id, body)),
);
