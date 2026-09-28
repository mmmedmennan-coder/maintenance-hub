import { z } from "zod";
import { workOrderActionSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { performWorkAction } from "@/server/modules/work";

/**
 * Assigned technician (or provider dispatcher) records an ALLOWED domain action. There is no
 * endpoint that accepts an arbitrary status: transitions are validated by the service and
 * by the database guard.
 */
export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: workOrderActionSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => performWorkAction(tx, actor, params.id, body)),
);
