import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listProviderInvitations } from "@/server/modules/requests";

export const GET = actorRoute(
  { orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], query: z.object({ status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).max(500).default(1) }) },
  async ({ actor, query }) => withActor(actor, (tx) => listProviderInvitations(tx, actor, query)),
);
