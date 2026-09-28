import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { revokeInvitation } from "@/server/modules/requests";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => revokeInvitation(tx, actor, params.id));
});
