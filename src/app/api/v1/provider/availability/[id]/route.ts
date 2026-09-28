import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { removeAvailabilityWindow } from "@/server/modules/technicians";

export const DELETE = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => removeAvailabilityWindow(tx, actor, params.id));
});
