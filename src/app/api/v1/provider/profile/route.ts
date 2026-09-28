import { providerProfileSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getOwnProfile, updateOwnProfile } from "@/server/modules/providers";

export const GET = actorRoute({ orgTypes: ["PROVIDER"] }, async ({ actor }) => withActor(actor, (tx) => getOwnProfile(tx, actor)));
export const PUT = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], body: providerProfileSchema }, async ({ actor, body }) =>
  withActor(actor, (tx) => updateOwnProfile(tx, actor, body)),
);
