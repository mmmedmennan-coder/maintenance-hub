import { availabilityWindowSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { addAvailabilityWindow } from "@/server/modules/technicians";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], body: availabilityWindowSchema }, async ({ actor, body }) =>
  withActor(actor, (tx) => addAvailabilityWindow(tx, actor, body)),
);
