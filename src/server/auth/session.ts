import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authDb } from "@/server/db/clients";
import { DomainError } from "@/server/errors";
import { getAuth } from "./auth";
import { type Actor, type OrgType, type Role, isRoleValidForOrg, workspaceHome } from "./roles";

export type SessionInfo = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  activeOrganizationId: string | null;
};

export type Membership = {
  orgId: string;
  orgName: string;
  orgType: OrgType;
  role: Role;
  isDemo: boolean;
};

async function loadSession(h: Headers): Promise<SessionInfo | null> {
  const result = await getAuth().api.getSession({ headers: h });
  if (!result) return null;
  const session = result.session as typeof result.session & { activeOrganizationId?: string | null };
  return {
    sessionId: session.id,
    userId: result.user.id,
    name: result.user.name,
    email: result.user.email,
    emailVerified: result.user.emailVerified,
    activeOrganizationId: session.activeOrganizationId ?? null,
  };
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  const rows = await authDb().member.findMany({
    where: { userId, organization: { archivedAt: null } },
    include: { organization: { select: { id: true, name: true, type: true, isDemo: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((m) => isRoleValidForOrg(m.role, m.organization.type))
    .map((m) => ({
      orgId: m.organization.id,
      orgName: m.organization.name,
      orgType: m.organization.type,
      role: m.role as Role,
      isDemo: m.organization.isDemo,
    }));
}

/** Picks the session's active organization if the user is (still) a member of it. */
export function pickActor(session: SessionInfo, memberships: Membership[]): Actor | null {
  const active = memberships.find((m) => m.orgId === session.activeOrganizationId) ?? memberships[0];
  if (!active) return null;
  return {
    userId: session.userId,
    userName: session.name,
    userEmail: session.email,
    orgId: active.orgId,
    orgName: active.orgName,
    orgType: active.orgType,
    role: active.role,
  };
}

// ---------------------------------------------------------------------------
// Server Components / pages
// ---------------------------------------------------------------------------

export const getSession = cache(async () => loadSession(await headers()));
export const getMemberships = cache(async (userId: string) => loadMemberships(userId));

export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await getSession();
  if (!session) return null;
  return pickActor(session, await getMemberships(session.userId));
});

/** Only accepts same-site relative paths, preventing open redirects. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("://")) {
    return fallback;
  }
  return next;
}

export async function requirePageActor(options: { orgTypes?: OrgType[]; roles?: Role[]; path: string }): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect(`/connexion?next=${encodeURIComponent(options.path)}`);
  const actor = pickActor(session, await getMemberships(session.userId));
  if (!actor) redirect("/onboarding");
  if (options.orgTypes && !options.orgTypes.includes(actor.orgType)) redirect(workspaceHome(actor.orgType, actor.role));
  if (options.roles && !options.roles.includes(actor.role)) redirect(workspaceHome(actor.orgType, actor.role));
  return actor;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function getApiSession(request: Request) {
  return loadSession(request.headers);
}

export async function requireApiActor(request: Request): Promise<Actor> {
  const session = await loadSession(request.headers);
  if (!session) throw new DomainError("UNAUTHENTICATED", "Connexion requise.");
  const actor = pickActor(session, await loadMemberships(session.userId));
  if (!actor) throw new DomainError("FORBIDDEN", "Aucune organisation active. Terminez l'inscription de votre entreprise.");
  return actor;
}
