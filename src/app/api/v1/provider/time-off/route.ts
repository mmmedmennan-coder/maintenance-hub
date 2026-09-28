import { timeOffSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { addTimeOff } from "@/server/modules/technicians";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], body: timeOffSchema }, async ({ actor, body }) =>
  withActor(actor, (tx) => addTimeOff(tx, actor, body)),
);
