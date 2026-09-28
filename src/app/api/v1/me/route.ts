import { publicRoute } from "@/server/http";
import { loadMemberships } from "@/server/auth/session";
import { DomainError } from "@/server/errors";

export const GET = publicRoute({}, async ({ session }) => {
  if (!session) throw new DomainError("UNAUTHENTICATED", "Connexion requise.");
  const memberships = await loadMemberships(session.userId);
  return {
    user: { id: session.userId, name: session.name, email: session.email },
    activeOrganizationId: session.activeOrganizationId,
    memberships,
  };
});
