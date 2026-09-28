import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { t } from "@/lib/i18n";
import type { onboardingSchema, referralSchema, staffInviteSchema } from "@/lib/schemas";
import { type Actor, type OrgType, type Role, can, isRoleValidForOrg, workspaceHome } from "@/server/auth/roles";
import type { SessionInfo } from "@/server/auth/session";
import { authDb } from "@/server/db/clients";
import { withActor } from "@/server/db/context";
import { getEnv } from "@/server/env";
import { DomainError, forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/lib/infra";
import { queueEmail } from "@/server/notifications/email-queue";

const INVITATION_TTL_DAYS = 7;
const DEFAULT_PLAN_CODE = "PILOT_399";

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const DEFAULT_SERVICE_HOURS = { "1": [480, 1080], "2": [480, 1080], "3": [480, 1080], "4": [480, 1080], "5": [480, 1080], "6": [540, 780] };

/** Creates a customer or provider organization for the signed-in user (never PLATFORM). */
export async function onboardOrganization(session: SessionInfo, input: z.output<typeof onboardingSchema>) {
  if (!session.emailVerified) throw new DomainError("FORBIDDEN", "Vérifiez d'abord votre adresse e-mail.");
  const db = authDb();
  const orgId = randomUUID();
  const role: Role = input.type === "CUSTOMER" ? "customer_owner" : "provider_owner";
  const slug = `${slugify(input.name) || "entreprise"}-${orgId.slice(0, 6)}`;
  const existing = await db.member.count({ where: { userId: session.userId } });
  if (existing >= 10) throw new DomainError("CONFLICT", "Nombre maximal d'organisations atteint pour ce compte.");

  await db.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: input.name, slug, type: input.type, city: input.city } });
    await tx.member.create({ data: { id: randomUUID(), organizationId: orgId, userId: session.userId, role } });
    await tx.session.update({ where: { id: session.sessionId }, data: { activeOrganizationId: orgId } });
    await tx.auditEvent.createMany({
      data: [{ actorUserId: session.userId, actorOrgId: orgId, actorRole: role, action: "organization.created", targetType: "organization", targetId: orgId, metadata: { type: input.type } }],
    });
  });

  const actor: Actor = {
    userId: session.userId,
    userName: session.name,
    userEmail: session.email,
    orgId,
    orgName: input.name,
    orgType: input.type,
    role,
  };
  if (input.type === "PROVIDER") {
    await withActor(actor, async (tx) => {
      await tx.providerProfile.create({
        data: {
          providerOrgId: orgId,
          slug: slug,
          displayName: input.name,
          summary: "",
          description: "",
          city: input.city,
          serviceHours: DEFAULT_SERVICE_HOURS,
        },
      });
    });
  }
  return { organizationId: orgId, home: workspaceHome(input.type, role) };
}

export async function setActiveOrganization(session: SessionInfo, organizationId: string) {
  const db = authDb();
  const membership = await db.member.findFirst({
    where: { userId: session.userId, organizationId, organization: { archivedAt: null } },
    include: { organization: { select: { type: true } } },
  });
  if (!membership || !isRoleValidForOrg(membership.role, membership.organization.type)) throw notFound("Organisation");
  await db.session.update({ where: { id: session.sessionId }, data: { activeOrganizationId: organizationId } });
  return { home: workspaceHome(membership.organization.type, membership.role as Role) };
}

async function staffLimit(orgId: string): Promise<number> {
  const db = authDb();
  const sub = await db.providerSubscription.findUnique({ where: { providerOrgId: orgId }, include: { plan: true } });
  if (sub) return sub.plan.maxStaff;
  const plan = await db.subscriptionPlan.findUnique({ where: { code: DEFAULT_PLAN_CODE } });
  return plan?.maxStaff ?? 3;
}

function canInvite(actor: Actor, role: Role): boolean {
  if (actor.orgType === "CUSTOMER") return actor.role === "customer_owner";
  if (actor.orgType === "PROVIDER") {
    if (actor.role === "provider_owner") return true;
    return actor.role === "provider_dispatcher" && role === "technician";
  }
  return false;
}

export async function listMembers(actor: Actor) {
  const db = authDb();
  const [members, invitations] = await Promise.all([
    db.member.findMany({
      where: { organizationId: actor.orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { organizationId: actor.orgId, status: "pending", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const limit = actor.orgType === "PROVIDER" ? await staffLimit(actor.orgId) : null;
  return {
    members: members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role as Role, createdAt: m.createdAt })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role as Role, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    staffLimit: limit,
  };
}

export async function inviteStaff(actor: Actor, input: z.output<typeof staffInviteSchema>) {
  const role = input.role as Role;
  if (actor.orgType === "PLATFORM" || !isRoleValidForOrg(role, actor.orgType)) {
    throw new DomainError("VALIDATION_ERROR", "Ce rôle n'existe pas pour votre type d'organisation.", { fields: { role: ["Rôle invalide."] } });
  }
  if (!canInvite(actor, role)) throw forbidden();
  const db = authDb();
  const email = input.email.toLowerCase();

  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const recent = await db.invitation.count({ where: { organizationId: actor.orgId, createdAt: { gt: dayAgo } } });
  if (recent >= 20) throw new DomainError("RATE_LIMITED", "Trop d'invitations envoyées aujourd'hui. Réessayez demain.");

  const alreadyMember = await db.member.findFirst({ where: { organizationId: actor.orgId, user: { email } } });
  if (alreadyMember) throw new DomainError("CONFLICT", "Cette personne est déjà membre de l'organisation.");

  const invitationId = randomUUID();
  await db.$transaction(
    async (tx) => {
      if (actor.orgType === "PROVIDER") {
        const limit = await staffLimit(actor.orgId);
        const [members, pending] = await Promise.all([
          tx.member.count({ where: { organizationId: actor.orgId } }),
          tx.invitation.count({ where: { organizationId: actor.orgId, status: "pending", expiresAt: { gt: new Date() } } }),
        ]);
        if (members + pending >= limit) {
          throw new DomainError("ENTITLEMENT_REQUIRED", t("errors.staffLimit", { limit }));
        }
      }
      await tx.invitation.updateMany({
        where: { organizationId: actor.orgId, email, status: "pending" },
        data: { status: "canceled" },
      });
      await tx.invitation.create({
        data: {
          id: invitationId,
          organizationId: actor.orgId,
          email,
          role,
          status: "pending",
          inviterId: actor.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600_000),
        },
      });
      await tx.auditEvent.createMany({
        data: [{ actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, action: "staff.invited", targetType: "invitation", targetId: invitationId, metadata: { role } }],
      });
    },
    { isolationLevel: "Serializable" },
  );
  const env = getEnv();
  await queueEmail(db, {
    category: "staff.invitation",
    dedupeKey: `staff.invitation:${invitationId}`,
    to: email,
    subject: t("email.staffInvite.subject", { org: actor.orgName, app: env.APP_NAME }),
    text: t("email.staffInvite.body", {
      inviter: actor.userName,
      org: actor.orgName,
      role: t(`roles.${role}`),
      url: `${env.APP_URL}/invitations/${invitationId}`,
      days: INVITATION_TTL_DAYS,
    }),
  });
  return { invitationId };
}

export async function getInvitationForUser(session: SessionInfo, invitationId: string) {
  const invitation = await authDb().invitation.findUnique({
    where: { id: invitationId },
    include: { organization: { select: { name: true, type: true } }, inviter: { select: { name: true } } },
  });
  // Do not reveal invitations addressed to someone else.
  if (!invitation || invitation.email.toLowerCase() !== session.email.toLowerCase()) return null;
  return {
    id: invitation.id,
    orgName: invitation.organization.name,
    orgType: invitation.organization.type as OrgType,
    role: invitation.role as Role,
    inviterName: invitation.inviter.name,
    status: invitation.status,
    expired: invitation.expiresAt <= new Date(),
  };
}

export async function acceptInvitation(session: SessionInfo, invitationId: string) {
  if (!session.emailVerified) throw new DomainError("FORBIDDEN", "Vérifiez d'abord votre adresse e-mail.");
  const db = authDb();
  const result = await db.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { id: invitationId }, include: { organization: true } });
    if (!invitation || invitation.email.toLowerCase() !== session.email.toLowerCase()) throw notFound("Invitation");
    if (invitation.status !== "pending") throw new DomainError("INVALID_TRANSITION", "Cette invitation n'est plus valide.");
    if (invitation.expiresAt <= new Date()) throw new DomainError("INVALID_TRANSITION", "Cette invitation a expiré.");
    const role = invitation.role as Role;
    if (!isRoleValidForOrg(role, invitation.organization.type)) throw forbidden();
    const existing = await tx.member.findFirst({ where: { organizationId: invitation.organizationId, userId: session.userId } });
    if (!existing) {
      await tx.member.create({ data: { id: randomUUID(), organizationId: invitation.organizationId, userId: session.userId, role } });
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } });
    await tx.session.update({ where: { id: session.sessionId }, data: { activeOrganizationId: invitation.organizationId } });
    await tx.auditEvent.createMany({
      data: [{ actorUserId: session.userId, actorOrgId: invitation.organizationId, actorRole: role, action: "staff.joined", targetType: "invitation", targetId: invitation.id }],
    });
    return { orgId: invitation.organizationId, orgName: invitation.organization.name, orgType: invitation.organization.type as OrgType, role };
  });

  if (result.role === "technician") {
    const actor: Actor = { userId: session.userId, userName: session.name, userEmail: session.email, orgId: result.orgId, orgName: result.orgName, orgType: "PROVIDER", role: "technician" };
    await withActor(actor, async (tx) => {
      const profile = await tx.technicianProfile.findFirst({ where: { providerOrgId: result.orgId, userId: session.userId } });
      if (!profile) {
        await tx.technicianProfile.create({ data: { providerOrgId: result.orgId, userId: session.userId, displayName: session.name } });
      }
    });
  }
  return { home: workspaceHome(result.orgType, result.role) };
}

export async function cancelInvitation(actor: Actor, invitationId: string) {
  const db = authDb();
  const invitation = await db.invitation.findFirst({ where: { id: invitationId, organizationId: actor.orgId } });
  if (!invitation) throw notFound("Invitation");
  if (!canInvite(actor, invitation.role as Role)) throw forbidden();
  if (invitation.status !== "pending") throw new DomainError("INVALID_TRANSITION", "Cette invitation n'est plus en attente.");
  await db.invitation.update({ where: { id: invitationId }, data: { status: "canceled" } });
  await db.auditEvent.createMany({ data: [{ actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, action: "staff.invitation_canceled", targetType: "invitation", targetId: invitationId }] });
}

async function assertOwnersRemain(orgId: string, excludeMemberId: string, ownerRole: Role) {
  const owners = await authDb().member.count({ where: { organizationId: orgId, role: ownerRole, id: { not: excludeMemberId } } });
  if (owners === 0) throw new DomainError("INVALID_TRANSITION", "L'organisation doit conserver au moins un propriétaire.");
}

export async function changeMemberRole(actor: Actor, memberId: string, role: Role) {
  const ownerRole: Role = actor.orgType === "CUSTOMER" ? "customer_owner" : "provider_owner";
  if (actor.role !== ownerRole) throw forbidden();
  if (actor.orgType === "PLATFORM" || !isRoleValidForOrg(role, actor.orgType)) throw forbidden("Rôle invalide pour cette organisation.");
  const db = authDb();
  const member = await db.member.findFirst({ where: { id: memberId, organizationId: actor.orgId } });
  if (!member) throw notFound("Membre");
  if (member.role === ownerRole && role !== ownerRole) await assertOwnersRemain(actor.orgId, member.id, ownerRole);
  await db.member.update({ where: { id: member.id }, data: { role } });
  await db.auditEvent.createMany({
    data: [{ actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, action: "staff.role_changed", targetType: "member", targetId: member.id, metadata: { from: member.role, to: role } }],
  });
  if (role === "technician") {
    const user = await db.user.findUnique({ where: { id: member.userId }, select: { name: true } });
    await withActor(actor, async (tx) => {
      const profile = await tx.technicianProfile.findFirst({ where: { providerOrgId: actor.orgId, userId: member.userId } });
      if (!profile) await tx.technicianProfile.create({ data: { providerOrgId: actor.orgId, userId: member.userId, displayName: user?.name ?? "Technicien" } });
    });
  }
}

export async function removeMember(actor: Actor, memberId: string) {
  const ownerRole: Role = actor.orgType === "CUSTOMER" ? "customer_owner" : "provider_owner";
  if (actor.role !== ownerRole) throw forbidden();
  const db = authDb();
  const member = await db.member.findFirst({ where: { id: memberId, organizationId: actor.orgId } });
  if (!member) throw notFound("Membre");
  if (member.role === ownerRole) await assertOwnersRemain(actor.orgId, member.id, ownerRole);
  await db.$transaction(async (tx) => {
    await tx.member.delete({ where: { id: member.id } });
    await tx.session.updateMany({ where: { userId: member.userId, activeOrganizationId: actor.orgId }, data: { activeOrganizationId: null } });
    await tx.auditEvent.createMany({
      data: [{ actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, action: "staff.removed", targetType: "member", targetId: member.id, metadata: { role: member.role } }],
    });
  });
  if (actor.orgType === "PROVIDER") {
    // Keep historical assignments; just deactivate the technician profile.
    await withActor(actor, (tx) =>
      tx.technicianProfile.updateMany({ where: { providerOrgId: actor.orgId, userId: member.userId }, data: { active: false } }),
    );
  }
}

/** A customer invites its current maintenance company to register (not an approval). */
export async function referProvider(actor: Actor, input: z.output<typeof referralSchema>) {
  if (!can.customerWrite(actor)) throw forbidden();
  const env = getEnv();
  await withActor(actor, async (tx) => {
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const recent = await tx.providerReferral.count({ where: { customerOrgId: actor.orgId, createdAt: { gt: dayAgo } } });
    if (recent >= 10) throw new DomainError("RATE_LIMITED", "Trop d'invitations envoyées aujourd'hui.");
    const referral = await tx.providerReferral.create({
      data: { customerOrgId: actor.orgId, invitedById: actor.userId, email: input.email, companyName: input.companyName, message: input.message },
      select: { id: true },
    });
    await queueEmail(tx, {
      category: "provider.referral",
      dedupeKey: `provider.referral:${referral.id}`,
      to: input.email,
      subject: t("email.referral.subject", { org: actor.orgName, app: env.APP_NAME }),
      text: t("email.referral.body", {
        company: input.companyName,
        org: actor.orgName,
        message: input.message ?? "",
        url: `${env.APP_URL}/inscription?type=PROVIDER`,
        app: env.APP_NAME,
      }),
    });
    await audit(tx, actor, { action: "provider.referred", targetType: "provider_referral", targetId: referral.id });
  });
}
