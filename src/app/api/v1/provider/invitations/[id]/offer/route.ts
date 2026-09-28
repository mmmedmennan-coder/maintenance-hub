import { z } from "zod";
import { offerDraftSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { saveOfferDraft } from "@/server/modules/offers";

/** Creates or updates the provider's editable DRAFT offer version for this invitation. */
export const PUT = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: offerDraftSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => saveOfferDraft(tx, actor, params.id, body)),
);
