import { z } from "zod";
import { inviteProvidersSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { inviteProviders } from "@/server/modules/requests";

/** Customer (or routing administrator) invites up to three eligible providers. */
export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PLATFORM"], params: z.object({ id: z.uuid() }), body: inviteProvidersSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => inviteProviders(tx, actor, params.id, body)),
);
