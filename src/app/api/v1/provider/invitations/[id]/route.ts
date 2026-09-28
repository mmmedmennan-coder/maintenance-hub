import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getInvitationForProvider } from "@/server/modules/requests";

/** Limited request brief for an invited provider + its own offer versions (never competitors'). */
export const GET = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) =>
  withActor(actor, (tx) => getInvitationForProvider(tx, actor, params.id)),
);
