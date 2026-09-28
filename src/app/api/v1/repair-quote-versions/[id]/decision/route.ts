import { z } from "zod";
import { quoteDecisionSchema } from "@/lib/schemas";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { decideRepairQuote } from "@/server/modules/work";

/** Authorized customer approves or rejects one exact issued version (snapshot hash required). */
export const POST = actorRoute(
  { orgTypes: ["CUSTOMER"], roles: ["customer_owner", "customer_manager"], params: z.object({ id: z.uuid() }), body: quoteDecisionSchema },
  async ({ actor, params, body, idempotencyKey }) =>
    runIdempotent(actor, "repair_quote.decide", idempotencyKey, { id: params.id, ...body }, (tx) => decideRepairQuote(tx, actor, params.id, body)),
);
