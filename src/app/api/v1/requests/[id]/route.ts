import { z } from "zod";
import { requestUpdateSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getRequestForCustomer, updateRequestDraft } from "@/server/modules/requests";

const params = z.object({ id: z.uuid() });

export const GET = actorRoute({ orgTypes: ["CUSTOMER", "PLATFORM"], params }, async ({ actor, params }) =>
  withActor(actor, async (tx) => {
    const { request, offers, documents } = await getRequestForCustomer(tx, actor, params.id);
    return { request, offers, documents };
  }),
);

export const PATCH = actorRoute({ orgTypes: ["CUSTOMER"], params, body: requestUpdateSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => updateRequestDraft(tx, actor, params.id, body)),
);
