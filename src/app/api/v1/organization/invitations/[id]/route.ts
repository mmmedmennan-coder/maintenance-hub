import { z } from "zod";
import { actorRoute } from "@/server/http";
import { cancelInvitation } from "@/server/modules/organizations";

export const DELETE = actorRoute({ params: z.object({ id: z.string().min(1).max(64) }), orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, params }) => {
  await cancelInvitation(actor, params.id);
});
