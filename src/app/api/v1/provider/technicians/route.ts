import { technicianSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { createTechnician, listTechnicians } from "@/server/modules/technicians";

export const GET = actorRoute({ orgTypes: ["PROVIDER"] }, async ({ actor }) => withActor(actor, (tx) => listTechnicians(tx, actor)));
export const POST = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], body: technicianSchema }, async ({ actor, body }) =>
  withActor(actor, (tx) => createTechnician(tx, actor, body)),
);
