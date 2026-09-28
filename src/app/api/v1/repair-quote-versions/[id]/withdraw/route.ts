import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { withdrawRepairQuote } from "@/server/modules/work";

/** Deletes a draft, or withdraws an issued version still awaiting the customer's decision. */
export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => {
  await withActor(actor, (tx) => withdrawRepairQuote(tx, actor, params.id));
});
