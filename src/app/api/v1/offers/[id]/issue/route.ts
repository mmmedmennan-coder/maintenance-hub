import { z } from "zod";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { issueOffer } from "@/server/modules/offers";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params, idempotencyKey }) =>
  runIdempotent(actor, "offer.issue", idempotencyKey, params, (tx) => issueOffer(tx, actor, params.id)),
);
