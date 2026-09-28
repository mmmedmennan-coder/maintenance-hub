import { z } from "zod";
import { planDecisionSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { decidePlan } from "@/server/modules/maintenance";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body: planDecisionSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => decidePlan(tx, actor, params.id, body)),
);
