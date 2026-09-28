import { z } from "zod";
import { serviceAreaSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { upsertServiceArea } from "@/server/modules/reference";

export const PATCH = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: serviceAreaSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => upsertServiceArea(tx, actor, params.id, body)),
);
