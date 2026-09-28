import { z } from "zod";
import { paymentActionSchema } from "@/lib/schemas";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { updatePayment } from "@/server/modules/payments";

/** Payee confirms/rejects a reported payment or reverses a confirmed one; admins may reverse (audited). */
export const POST = actorRoute({ orgTypes: ["PROVIDER", "PLATFORM"], params: z.object({ id: z.uuid() }), body: paymentActionSchema }, async ({ actor, params, body, idempotencyKey }) =>
  runIdempotent(actor, "payment.update", idempotencyKey, { id: params.id, ...body }, (tx) => updatePayment(tx, actor, params.id, body)),
);
