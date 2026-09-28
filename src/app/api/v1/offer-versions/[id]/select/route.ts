import { z } from "zod";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { selectOfferVersion } from "@/server/modules/offers";

/** Customer selects one exact issued version (Idempotency-Key recommended). */
export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params, idempotencyKey }) =>
  runIdempotent(actor, "offer.select", idempotencyKey, { versionId: params.id }, (tx) => selectOfferVersion(tx, actor, params.id)),
);
