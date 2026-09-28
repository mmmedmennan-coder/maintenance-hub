import { maintenancePlanSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listPlans, proposePlan } from "@/server/modules/maintenance";

export const GET = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor }) => withActor(actor, (tx) => listPlans(tx, actor)));
/** Provider proposes a recurrence it has set; the customer must consent before reminders start. */
export const POST = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], body: maintenancePlanSchema }, async ({ actor, body }) =>
  withActor(actor, (tx) => proposePlan(tx, actor, body)),
);
