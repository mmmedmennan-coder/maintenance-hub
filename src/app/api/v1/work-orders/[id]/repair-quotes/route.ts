import { z } from "zod";
import { repairQuoteSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { saveRepairQuoteDraft } from "@/server/modules/work";

/** Starts a new repair quote (first scope or change order) as an editable draft. */
export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: repairQuoteSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => saveRepairQuoteDraft(tx, actor, params.id, null, body)),
);
