import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authDb } from "@/server/db/clients";
import { withActor } from "@/server/db/context";
import { ensureUser } from "@/server/fixtures/identity";
import { createSite } from "@/server/modules/assets";
import { acceptInvitation, inviteStaff, onboardOrganization } from "@/server/modules/organizations";
import { submitProfileForReview } from "@/server/modules/providers";
import { expectCode, makeCustomer, makeProvider, ownerDb, uid } from "./helpers";

describe("organizations, roles and staff limits", () => {
  it("onboarding creates only customer/provider organizations and the platform role is never grantable", async () => {
    const email = `new.${uid()}@test.maintenance-hub.test`;
    const user = await ensureUser(ownerDb(), { email, name: "Nouveau", password: "Password-12345" });
    const sessionId = randomUUID();
    await ownerDb().session.create({ data: { id: sessionId, token: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const session = { sessionId, userId: user.id, name: "Nouveau", email, emailVerified: true, activeOrganizationId: null };
    const result = await onboardOrganization(session, { type: "PROVIDER", name: "Froid Nouveau", city: "Salé" });
    expect(result.home).toBe("/prestataire");
    const org = await ownerDb().organization.findUniqueOrThrow({ where: { id: result.organizationId } });
    expect(org.type).toBe("PROVIDER");
    const profile = await ownerDb().providerProfile.findUniqueOrThrow({ where: { providerOrgId: org.id } });
    expect(profile.status).toBe("DRAFT");
    // The auth role cannot create platform administrators (database trigger).
    const platform = await ownerDb().organization.create({ data: { id: randomUUID(), slug: `plat-${uid()}`, name: "Plateforme bis", type: "PLATFORM" } });
    await expect(authDb().member.create({ data: { id: randomUUID(), organizationId: platform.id, userId: user.id, role: "platform_admin" } })).rejects.toThrow();
    // A customer role cannot be added to a provider organization.
    await expect(authDb().member.create({ data: { id: randomUUID(), organizationId: org.id, userId: user.id, role: "customer_owner" } })).rejects.toThrow();
    // A provider cannot self-approve its profile.
    const actor = { userId: user.id, userName: "Nouveau", userEmail: email, orgId: org.id, orgName: org.name, orgType: "PROVIDER" as const, role: "provider_owner" as const };
    await expectCode(withActor(actor, (tx) => tx.providerProfile.update({ where: { id: profile.id }, data: { status: "APPROVED" } })), "FORBIDDEN");
    // Submitting an incomplete profile explains what is missing.
    await expectCode(withActor(actor, (tx) => submitProfileForReview(tx, actor)), "VALIDATION_ERROR");
  });

  it("provider staff are capped by the plan (members + pending invitations)", async () => {
    const provider = await makeProvider("Effectif");
    // Owner + two technicians already = 3 = pilot limit.
    await expectCode(inviteStaff(provider.manager, { email: `extra.${uid()}@test.maintenance-hub.test`, role: "technician" }), "ENTITLEMENT_REQUIRED");
    // Customers are not capped and invitations are role-checked.
    const customer = await makeCustomer("Équipe");
    const inviteEmail = `collegue.${uid()}@test.maintenance-hub.test`;
    await expectCode(inviteStaff(customer.owner, { email: inviteEmail, role: "technician" }), "VALIDATION_ERROR");
    await expectCode(inviteStaff(customer.viewer, { email: inviteEmail, role: "customer_viewer" }), "FORBIDDEN");
    const { invitationId } = await inviteStaff(customer.owner, { email: inviteEmail, role: "customer_manager" });
    // Someone else cannot accept an invitation addressed to another e-mail.
    const wrong = await ensureUser(ownerDb(), { email: `wrong.${uid()}@test.maintenance-hub.test`, name: "Mauvais", password: "Password-12345" });
    const wrongSession = randomUUID();
    await ownerDb().session.create({ data: { id: wrongSession, token: randomUUID(), userId: wrong.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await expectCode(acceptInvitation({ sessionId: wrongSession, userId: wrong.id, name: "Mauvais", email: wrong.email, emailVerified: true, activeOrganizationId: null }, invitationId), "NOT_FOUND");
    const invited = await ensureUser(ownerDb(), { email: inviteEmail, name: "Collègue", password: "Password-12345" });
    const sid = randomUUID();
    await ownerDb().session.create({ data: { id: sid, token: randomUUID(), userId: invited.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const accepted = await acceptInvitation({ sessionId: sid, userId: invited.id, name: "Collègue", email: inviteEmail, emailVerified: true, activeOrganizationId: null }, invitationId);
    expect(accepted.home).toBe("/client");
    const managerActor = { userId: invited.id, userName: "Collègue", userEmail: inviteEmail, orgId: customer.org.id, orgName: customer.org.name, orgType: "CUSTOMER" as const, role: "customer_manager" as const };
    await expect(
      withActor(managerActor, (tx) => createSite(tx, managerActor, { name: "Annexe", addressLine: "1 rue Test", city: "Salé", accessNotes: null, contactName: null, contactPhone: null })),
    ).resolves.toBeTruthy();
    // A forged acting organization grants nothing: RLS re-checks membership.
    const forged = { ...managerActor, orgId: (await makeCustomer("Victime")).org.id };
    expect(await withActor(forged, (tx) => tx.site.count())).toBe(0);
  });
});
