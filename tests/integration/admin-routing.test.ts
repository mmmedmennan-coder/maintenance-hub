import { beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/server/db/context";
import { listUnmatchedRequests, createRequestDraft, getInvitationForProvider, getRequestForCustomer, inviteProviders, submitRequest } from "@/server/modules/requests";
import { expectCode, inDays, makeAdmin, makeCustomer, makeProvider } from "./helpers";

describe("human-assisted breakdown routing", () => {
  let customer: Awaited<ReturnType<typeof makeCustomer>>;
  let provider: Awaited<ReturnType<typeof makeProvider>>;
  let unapproved: Awaited<ReturnType<typeof makeProvider>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    customer = await makeCustomer("Panne");
    provider = await makeProvider("Dépannage");
    unapproved = await makeProvider("Non vérifié", { approved: false });
    admin = await makeAdmin();
  });

  it("an administrator routes a breakdown to one eligible provider without being able to edit the request", async () => {
    const request = await withActor(customer.owner, (tx) =>
      createRequestDraft(tx, customer.owner, {
        equipmentId: customer.equipment.id,
        kind: "BREAKDOWN",
        title: "Vitrine à l'arrêt",
        symptoms: "Compresseur ne démarre plus depuis ce matin.",
        preferredWindows: [{ date: inDays(1), start: "08:00", end: "18:00" }],
      }),
    );
    await withActor(customer.owner, (tx) => submitRequest(tx, customer.owner, request.id));

    const queue = await withActor(admin, (tx) => listUnmatchedRequests(tx, admin));
    expect(queue.some((r) => r.id === request.id)).toBe(true);

    // Unapproved providers are never routable.
    await expectCode(withActor(admin, (tx) => inviteProviders(tx, admin, request.id, { providerOrgIds: [unapproved.org.id] })), "VALIDATION_ERROR");
    await withActor(admin, (tx) => inviteProviders(tx, admin, request.id, { providerOrgIds: [provider.org.id] }));

    const detail = await withActor(customer.owner, (tx) => getRequestForCustomer(tx, customer.owner, request.id));
    expect(detail.request.invitations).toHaveLength(1);
    expect(detail.request.invitations[0]!.invitedAsAdmin).toBe(true);
    expect((await withActor(admin, (tx) => listUnmatchedRequests(tx, admin))).some((r) => r.id === request.id)).toBe(false);

    const invitation = await withActor(provider.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
    const seen = await withActor(provider.manager, (tx) => getInvitationForProvider(tx, provider.manager, invitation.id));
    expect(seen.invitation.brief.kind).toBe("BREAKDOWN");
    expect(JSON.stringify(seen.invitation.brief)).not.toContain("avenue de France");

    // The platform can read the request but row-level security does not let it modify it.
    const updated = await withActor(admin, (tx) => tx.serviceRequest.updateMany({ where: { id: request.id }, data: { title: "Modifié" } }));
    expect(updated.count).toBe(0);
  });
});
