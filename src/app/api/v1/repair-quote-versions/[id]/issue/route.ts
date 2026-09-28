import { z } from "zod";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { issueRepairQuote } from "@/server/modules/work";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params, idempotencyKey }) =>
  runIdempotent(actor, "repair_quote.issue", idempotencyKey, params, (tx) => issueRepairQuote(tx, actor, params.id)),
);
