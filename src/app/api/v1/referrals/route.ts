import { referralSchema } from "@/lib/schemas";
import { actorRoute } from "@/server/http";
import { referProvider } from "@/server/modules/organizations";

export const POST = actorRoute({ body: referralSchema, orgTypes: ["CUSTOMER"] }, async ({ actor, body }) => {
  await referProvider(actor, body);
});
