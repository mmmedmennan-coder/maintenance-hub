import { z } from "zod";
import { paymentSchema } from "@/lib/schemas";
import { runIdempotent } from "@/server/api";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listPayments, recordPayment } from "@/server/modules/payments";

const params = z.object({ id: z.uuid() });

export const GET = actorRoute({ params, roles: ["customer_owner", "customer_manager", "customer_viewer", "provider_owner", "provider_dispatcher", "platform_admin"] }, async ({ actor, params }) =>
  withActor(actor, (tx) => listPayments(tx, actor, params.id)),
);

/** Customer reports a direct payment (REPORTED); provider records a receipt (CONFIRMED). */
export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params, body: paymentSchema }, async ({ actor, params, body, idempotencyKey }) =>
  runIdempotent(actor, "payment.record", idempotencyKey, { bookingId: params.id, ...body }, (tx) => recordPayment(tx, actor, params.id, body)),
);
