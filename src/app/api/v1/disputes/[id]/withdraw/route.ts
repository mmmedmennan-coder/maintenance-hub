import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { withdrawDispute } from "@/server/modules/feedback";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => withdrawDispute(tx, actor, params.id));
});
