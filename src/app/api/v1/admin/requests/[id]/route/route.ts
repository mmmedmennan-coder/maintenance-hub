import { z } from "zod";
import { adminInviteProviderSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { inviteProviders } from "@/server/modules/requests";

/** Human-assisted routing: an administrator invites one suitable provider (audited). */
export const POST = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], params: z.object({ id: z.uuid() }), body: adminInviteProviderSchema }, async ({ actor, params, body }) =>
  withActor(actor, (tx) => inviteProviders(tx, actor, params.id, { providerOrgIds: [body.providerOrgId] })),
);
