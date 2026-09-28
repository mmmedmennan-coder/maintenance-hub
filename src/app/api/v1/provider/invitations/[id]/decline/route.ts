import { z } from "zod";
import { declineInvitationSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { declineInvitation } from "@/server/modules/requests";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: declineInvitationSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => declineInvitation(tx, actor, params.id, body.reason));
});
