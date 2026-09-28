import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { submitProfileForReview } from "@/server/modules/providers";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] }, async ({ actor }) => {
  await withActor(actor, (tx) => submitProfileForReview(tx, actor));
});
