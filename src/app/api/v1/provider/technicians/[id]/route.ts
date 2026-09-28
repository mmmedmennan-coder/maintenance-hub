import { z } from "zod";
import { technicianSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { updateTechnician } from "@/server/modules/technicians";

export const PATCH = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], params: z.object({ id: z.uuid() }), body: technicianSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => updateTechnician(tx, actor, params.id, body)),
);
