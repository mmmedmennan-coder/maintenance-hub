import { supportMessageSchema } from "@/lib/schemas";
import { withPublic, withUser } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { publicRoute } from "@/server/http";
import { isPublicRateLimited } from "@/server/lib/rate-limit";
import { createSupportMessage } from "@/server/modules/notifications";

export const POST = publicRoute({ body: supportMessageSchema }, async ({ request, session, body }) => {
  if (await isPublicRateLimited("support", request, 5, 3600)) {
    throw new DomainError("RATE_LIMITED", "Trop de messages envoyés. Réessayez plus tard.");
  }
  if (session) await withUser(session.userId, (tx) => createSupportMessage(tx, session.userId, body));
  else await withPublic((tx) => createSupportMessage(tx, null, body));
});
