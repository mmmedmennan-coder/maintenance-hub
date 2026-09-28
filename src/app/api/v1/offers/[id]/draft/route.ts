import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { discardOfferDraft } from "@/server/modules/offers";

export const DELETE = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => discardOfferDraft(tx, actor, params.id));
});
