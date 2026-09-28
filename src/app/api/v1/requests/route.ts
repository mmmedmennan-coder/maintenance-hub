import { z } from "zod";
import { requestDraftSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { createRequestDraft, listCustomerRequests } from "@/server/modules/requests";

export const GET = actorRoute(
  { orgTypes: ["CUSTOMER"], query: z.object({ status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).max(500).default(1) }) },
  async ({ actor, query }) => withActor(actor, (tx) => listCustomerRequests(tx, actor, query)),
);

/** Creates a DRAFT request for an asset owned by the acting customer organization. */
export const POST = actorRoute({ orgTypes: ["CUSTOMER"], body: requestDraftSchema }, async ({ actor, body }) => withActor(actor, (tx) => createRequestDraft(tx, actor, body)));
