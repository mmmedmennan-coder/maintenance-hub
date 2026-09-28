import { z } from "zod";
import { disputeCommentSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { addDisputeComment } from "@/server/modules/feedback";

export const POST = actorRoute({ params: z.object({ id: z.uuid() }), body: disputeCommentSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => addDisputeComment(tx, actor, params.id, body.body));
});
