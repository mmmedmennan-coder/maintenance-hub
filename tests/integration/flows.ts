import type { Actor } from "@/server/auth/roles";
import { withActor } from "@/server/db/context";
import { confirmBooking } from "@/server/modules/bookings";
import { issueOffer, saveOfferDraft, selectOfferVersion } from "@/server/modules/offers";
import { createRequestDraft, inviteProviders, submitRequest } from "@/server/modules/requests";
import type { makeCustomer, makeProvider } from "./helpers";

type Customer = Awaited<ReturnType<typeof makeCustomer>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;

export function offerFor(date: string, kind: "DIAGNOSTIC" | "MAINTENANCE" = "DIAGNOSTIC", overrides: Record<string, unknown> = {}) {
  return {
    kind,
    scope: kind === "MAINTENANCE" ? "Nettoyage condenseur, contrôle charge et températures." : "Diagnostic du circuit frigorifique.",
    calloutFee: 10_000,
    serviceFee: 25_000,
    taxRate: 2000,
    taxNote: null,
    windowDate: date,
    windowStart: "07:00",
    windowEnd: "20:00",
    estimatedDurationMin: 60,
    exclusions: "Pièces non incluses.",
    cancellationTerms: "Annulation sans frais jusqu'à 24 h avant.",
    warrantyTerms: null,
    validDays: 7,
    ...overrides,
  };
}

/** Customer request → one provider offer → selection. Returns ids; booking is PENDING. */
export async function pendingBooking(customer: Customer, provider: Provider, date: string, kind: "DIAGNOSTIC" | "MAINTENANCE" = "DIAGNOSTIC") {
  const request = await withActor(customer.owner, (tx) =>
    createRequestDraft(tx, customer.owner, {
      equipmentId: customer.equipment.id,
      kind,
      title: kind === "MAINTENANCE" ? "Entretien semestriel" : "Panne de froid vitrine",
      symptoms: "Température trop haute depuis deux jours.",
      preferredWindows: [{ date, start: "08:00", end: "18:00" }],
    }),
  );
  await withActor(customer.owner, (tx) => submitRequest(tx, customer.owner, request.id));
  await withActor(customer.owner, (tx) => inviteProviders(tx, customer.owner, request.id, { providerOrgIds: [provider.org.id] }));
  const invitation = await withActor(provider.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
  const draft = await withActor(provider.manager, (tx) => saveOfferDraft(tx, provider.manager, invitation.id, offerFor(date, kind)));
  await withActor(provider.manager, (tx) => issueOffer(tx, provider.manager, draft.offerId));
  const selected = await withActor(customer.owner, (tx) => selectOfferVersion(tx, customer.owner, draft.versionId));
  return { requestId: request.id, invitationId: invitation.id, offerId: draft.offerId, versionId: draft.versionId, bookingId: selected.bookingId };
}

export async function confirm(provider: Provider, bookingId: string, date: string, start: string, techIndex = 0, actor: Actor = provider.manager) {
  const booking = await withActor(actor, (tx) => tx.booking.findUniqueOrThrow({ where: { id: bookingId } }));
  return withActor(actor, (tx) =>
    confirmBooking(tx, actor, bookingId, {
      technicianId: provider.technicians[techIndex]!.id,
      date,
      start,
      durationMin: 60,
      bufferBeforeMin: 30,
      bufferAfterMin: 30,
      expectedLockVersion: booking.lockVersion,
    }),
  );
}

export async function confirmedBooking(customer: Customer, provider: Provider, date: string, start: string, kind: "DIAGNOSTIC" | "MAINTENANCE" = "DIAGNOSTIC", techIndex = 0) {
  const pending = await pendingBooking(customer, provider, date, kind);
  const confirmed = await confirm(provider, pending.bookingId, date, start, techIndex);
  return { ...pending, workOrderId: confirmed.workOrderId };
}
