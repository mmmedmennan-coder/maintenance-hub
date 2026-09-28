import { z } from "zod";
import { repairQuoteSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { notFound } from "@/server/errors";
import { actorRoute } from "@/server/http";
import { saveRepairQuoteDraft } from "@/server/modules/work";

/** Saves the draft of a new version (revision) of an existing repair quote. */
export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: repairQuoteSchema }, async ({ actor, params, body }) =>
  withActor(actor, async (tx) => {
    const quote = await tx.repairQuote.findFirst({ where: { id: params.id, providerOrgId: actor.orgId } });
    if (!quote) throw notFound("Devis");
    return saveRepairQuoteDraft(tx, actor, quote.workOrderId, quote.id, body);
  }),
);
