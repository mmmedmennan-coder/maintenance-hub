import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { addDaysToDateString, formatDateTime, formatWindow, localDateString, localTimeString, minutesToLabel, nowMs } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { eligibleProvidersForRequest } from "@/server/modules/providers";
import { MAX_INVITATIONS, type PreferredWindow, getRequestForCustomer } from "@/server/modules/requests";
import { DocumentList } from "@/components/domain/document-list";
import { DocumentUploader } from "@/components/domain/document-uploader";
import { type ComparableOffer, OfferComparison } from "@/components/domain/offer-comparison";
import { StatusBadge } from "@/components/domain/status-badge";
import { CancelRequestButton, DraftEditForm, InviteProviders, ReopenRequestButton, RevokeInvitationButton, SubmitRequestButton } from "@/features/request-actions";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.requestDetail.title") };

export default async function RequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ prestataire?: string; etape?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withActor(actor, async (tx) => {
    const detail = await getRequestForCustomer(tx, actor, id);
    const eligible = detail.request.status === "OPEN" && detail.request.kind !== "BREAKDOWN" ? await eligibleProvidersForRequest(tx, detail.request.equipmentCategoryId, detail.request.serviceAreaId) : [];
    return { ...detail, eligible };
  }).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { request, providers, ratings, offers, documents } = data;
  const writer = can.customerWrite(actor);
  const windows = request.preferredWindows as PreferredWindow[];
  const activeInvites = request.invitations.filter((i) => i.status === "INVITED" || i.status === "OFFERED");
  const invitedIds = new Set(request.invitations.map((i) => i.providerOrgId));
  const activeBooking = request.bookings.find((b) => ["PENDING_CONFIRMATION", "CONFIRMED", "COMPLETED"].includes(b.status));
  const lastBooking = request.bookings[0];
  const now = nowMs();

  const comparable: ComparableOffer[] = offers
    .filter((o) => o.versions.length > 0)
    .map((o) => {
      const v = o.versions[0]!;
      const p = providers.get(o.providerOrgId);
      const rating = ratings.get(o.providerOrgId);
      return {
        versionId: v.id,
        providerName: p?.displayName ?? "—",
        providerSlug: p?.status === "APPROVED" ? p.slug : null,
        providerIsDemo: p?.isDemo ?? false,
        verifiedChecks: p?.checks.map((c) => c.type) ?? [],
        rating: { avg: rating?.avg ?? null, count: rating?.count ?? 0 },
        status: v.status,
        versionNo: v.versionNo,
        previousVersions: o.versions.length - 1,
        kind: v.kind,
        scope: v.scope,
        calloutFeeMinor: v.calloutFeeMinor,
        serviceFeeMinor: v.serviceFeeMinor,
        taxRateBp: v.taxRateBp,
        taxNote: v.taxNote,
        subtotalMinor: v.subtotalMinor,
        taxMinor: v.taxMinor,
        totalMinor: v.totalMinor,
        currency: v.currency,
        windowStart: v.windowStart?.toISOString() ?? null,
        windowEnd: v.windowEnd?.toISOString() ?? null,
        estimatedDurationMin: v.estimatedDurationMin,
        exclusions: v.exclusions,
        cancellationTerms: v.cancellationTerms,
        warrantyTerms: v.warrantyTerms,
        expiresAt: v.expiresAt?.toISOString() ?? null,
        issuedAt: v.issuedAt?.toISOString() ?? null,
        expired: !!v.expiresAt && v.expiresAt.getTime() <= now,
      };
    });

  const routing =
    request.kind === "BREAKDOWN" && request.status === "OPEN"
      ? comparable.some((o) => o.status === "ISSUED")
        ? "offers"
        : activeInvites.length
          ? "awaiting"
          : "unassigned"
      : null;
  const hours = (request.serviceArea?.routingHours ?? {}) as Record<string, [number, number]>;
  const hoursLabel = Object.entries(hours).map(([d, [a, b]]) => `${te("enums.weekdayShort", d)} ${minutesToLabel(a)}–${minutesToLabel(b)}`).join(", ");
  const pendingUploads = documents.filter((d) => d.status === "PENDING").length;
  const editable = writer && ["DRAFT", "OPEN"].includes(request.status);

  return (
    <>
      <PageHeader
        title={`${request.reference} · ${request.title}`}
        back={{ href: "/client/demandes", label: t("customer.requests.title") }}
        meta={
          <>
            <StatusBadge domain="request" status={request.status} />
            <Badge>{te("enums.requestKind", request.kind)}</Badge>
            {request.source !== "MARKETPLACE" ? <Badge tone="info">{te("enums.requestSource", request.source)}</Badge> : null}
          </>
        }
        actions={
          writer ? (
            <>
              {request.status === "BOOKING" && !activeBooking ? <ReopenRequestButton id={request.id} /> : null}
              {["DRAFT", "OPEN"].includes(request.status) || (request.status === "BOOKING" && !activeBooking) ? <CancelRequestButton id={request.id} /> : null}
            </>
          ) : null
        }
      />

      {request.status === "DRAFT" ? (
        <Card className="mb-6 border-brand">
          <CardHeader title={t("customer.requestDetail.draftTitle")} description={t("customer.requestDetail.draftIntro")} />
          <CardBody className="space-y-4">
            {writer ? (
              <SubmitRequestButton id={request.id} disabledReason={pendingUploads ? t("customer.requestDetail.pendingUploads") : null} />
            ) : null}
            {request.source === "MAINTENANCE_PLAN" ? <Alert tone="info">{t("customer.requestDetail.fromPlan")}</Alert> : null}
          </CardBody>
        </Card>
      ) : null}

      {routing ? (
        <Alert tone={routing === "unassigned" ? "warn" : "info"} title={t(`customer.requestDetail.routing.${routing}`)} className="mb-6">
          {t("customer.requestDetail.routingBody", { hours: hoursLabel || "—" })}
        </Alert>
      ) : null}

      {request.status === "BOOKING" && lastBooking ? (
        <Alert
          tone={activeBooking ? "info" : "warn"}
          title={activeBooking ? t("customer.requestDetail.bookingActive", { ref: lastBooking.reference }) : t(`customer.requestDetail.bookingEnded.${lastBooking.status}`)}
          className="mb-6"
        >
          {activeBooking ? (
            <>
              {lastBooking.status === "PENDING_CONFIRMATION" ? t("customer.requestDetail.pendingUntil", { date: formatDateTime(lastBooking.confirmationDeadline) }) : null}{" "}
              <Link href={`/client/rendez-vous/${lastBooking.id}`} className="font-semibold underline">{t("customer.requestDetail.openBooking")}</Link>
            </>
          ) : (
            <>
              {lastBooking.declineReason ? `${t("customer.requestDetail.reason")} : ${lastBooking.declineReason}. ` : ""}
              {t("customer.requestDetail.reopenHint")}
            </>
          )}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-6">
          {request.status !== "DRAFT" && request.kind !== "BREAKDOWN" && request.status === "OPEN" && writer ? (
            <Card>
              <CardHeader title={t("customer.requestDetail.inviteTitle")} description={t("customer.requestDetail.inviteIntro", { max: MAX_INVITATIONS })} />
              <CardBody>
                <InviteProviders
                  requestId={request.id}
                  remaining={MAX_INVITATIONS - activeInvites.length}
                  preselect={sp.prestataire}
                  providers={data.eligible
                    .filter((p) => !invitedIds.has(p.providerOrgId))
                    .map((p) => ({ providerOrgId: p.providerOrgId, displayName: p.displayName, summary: p.summary, city: p.city, isDemo: p.isDemo, checks: p.checks.map((c) => c.type), slug: p.slug }))}
                />
              </CardBody>
            </Card>
          ) : null}

          <section id="offres" className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{t("customer.requestDetail.offersTitle")}</h2>
            {comparable.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong bg-surface p-4 text-sm text-muted">
                {request.status === "DRAFT" ? t("customer.requestDetail.offersAfterSubmit") : t("customer.requestDetail.noOffers")}
              </p>
            ) : (
              <OfferComparison offers={comparable} canSelect={writer && request.status === "OPEN"} requestReference={request.reference} />
            )}
          </section>

          <Card>
            <CardHeader title={t("customer.requestDetail.invitationsTitle")} />
            <CardBody>
              {request.invitations.length === 0 ? (
                <p className="text-sm text-muted">{request.kind === "BREAKDOWN" ? t("customer.requestDetail.routingPending") : t("customer.requestDetail.noInvitations")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {request.invitations.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="text-sm">
                        <span className="font-medium text-ink">{providers.get(inv.providerOrgId)?.displayName ?? "—"}</span>
                        <span className="block text-xs text-muted">
                          {t("customer.requestDetail.invitedOn", { date: formatDateTime(inv.createdAt) })}
                          {inv.invitedAsAdmin ? ` · ${t("customer.requestDetail.routedByPlatform")}` : ""}
                          {inv.declineReason ? ` · ${inv.declineReason}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge domain="invitation" status={inv.status} />
                        {writer && request.status === "OPEN" && ["INVITED", "OFFERED"].includes(inv.status) ? <RevokeInvitationButton id={inv.id} /> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {request.bookings.length ? (
            <Card>
              <CardHeader title={t("customer.requestDetail.bookingsTitle")} />
              <CardBody>
                <ul className="divide-y divide-line">
                  {request.bookings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/client/rendez-vous/${b.id}`} className="text-sm font-medium hover:text-brand">
                        {b.reference} · {providers.get(b.providerOrgId)?.displayName ?? "—"}
                        {b.scheduledStart ? <span className="block text-xs text-muted">{formatWindow(b.scheduledStart, b.scheduledEnd)}</span> : null}
                      </Link>
                      <StatusBadge domain="booking" status={b.status} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("customer.requestDetail.summary")} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: t("customer.wizard.equipment"), value: <Link className="text-brand hover:underline" href={`/client/equipements/${request.equipment.id}`}>{request.equipment.label}</Link> },
                  { label: t("customer.equipment.category"), value: request.equipmentCategory.labelFr },
                  { label: t("customer.equipment.site"), value: `${request.site.name} — ${request.site.city}` },
                  { label: t("customer.sites.area"), value: request.serviceArea?.name ?? t("customer.sites.outsideArea") },
                  { label: t("customer.wizard.symptoms"), value: request.symptoms },
                  { label: t("customer.wizard.windowsTitle"), value: windows.map((w) => formatWindow(w.start, w.end)).join("\n") },
                  { label: t("customer.requestDetail.submittedAt"), value: formatDateTime(request.submittedAt) },
                ]}
              />
              <p className="mt-4 text-xs text-muted">{t("customer.requestDetail.briefNote")}</p>
            </CardBody>
          </Card>
          <Card id="photos">
            <CardHeader title={t("customer.requestDetail.photosTitle")} description={t("customer.requestDetail.photosIntro")} />
            <CardBody className="space-y-4">
              {sp.etape === "photos" && request.status === "DRAFT" ? <Alert tone="info">{t("customer.requestDetail.photosStep")}</Alert> : null}
              <DocumentList docs={documents.map((d) => ({ ...d, canDelete: editable }))} emptyLabel={t("customer.requestDetail.noPhotos")} />
              {editable ? <DocumentUploader target={{ requestId: request.id }} kind="PHOTO" allowShare defaultShare /> : null}
            </CardBody>
          </Card>
          {request.status === "DRAFT" && writer ? (
            <Card>
              <CardHeader title={t("customer.requestDetail.editDraft")} />
              <CardBody>
                <DraftEditForm
                  id={request.id}
                  version={request.version}
                  tomorrow={addDaysToDateString(localDateString(new Date()), 1)}
                  initial={{
                    title: request.title,
                    symptoms: request.symptoms,
                    preferredWindows: windows.map((w) => ({ date: localDateString(new Date(w.start)), start: localTimeString(new Date(w.start)), end: localTimeString(new Date(w.end)) })),
                  }}
                />
              </CardBody>
            </Card>
          ) : null}
          {request.status === "CLOSED" && lastBooking ? <ButtonLink href={`/client/rendez-vous/${lastBooking.id}`} variant="secondary">{t("customer.requestDetail.openBooking")}</ButtonLink> : null}
        </div>
      </div>
    </>
  );
}
