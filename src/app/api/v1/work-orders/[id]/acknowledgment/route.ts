import { z } from "zod";
import { acknowledgeSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { respondToReport } from "@/server/modules/work";

/** Customer acknowledges the report or opens a dispute (separate records; payment unaffected). */
export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }), body: acknowledgeSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => respondToReport(tx, actor, params.id, body)),
);
