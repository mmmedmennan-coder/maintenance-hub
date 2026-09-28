import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { formatMoney, minorToInput } from "@/lib/money";
import { addDaysToDateString, durationLabel, formatDateTime, formatWindow, localDateString, localTimeString } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getEntitlement } from "@/server/modules/providers";
import { getInvitationForProvider } from "@/server/modules/requests";
import { StatusBadge } from "@/components/domain/status-badge";
import { DeclineInvitationButton, DiscardOfferDraftButton, OfferEditor, type OfferValues, WithdrawOfferButton } from "@/features/offer-editor";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("providerInvitations.detailTitle") };

export default async function ProviderInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withActor(actor, async (tx) => ({ ...(await getInvitationForProvider(tx, actor, id)), entitlement: await getEntitlement(tx, actor.orgId) })).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { invitation, attachments, booking, entitlement } = data;
  const brief = invitation.brief;
  const offer = invitation.offer;
  const versions = offer?.versions ?? [];
  const draft = versions.find((v) => v.status === "DRAFT");
  const issued = versions.find((v) => v.status === "ISSUED");
  const base = draft ?? issued ?? versions[0];
  const kind = brief.kind === "MAINTENANCE" ? "MAINTENANCE" : "DIAGNOSTIC";
  const active = ["INVITED", "OFFERED"].includes(invitation.status) && (!offer || !["SELECTED", "CLOSED"].includes(offer.status));
  const firstWindow = brief.preferredWindows[0];
  const today = localDateString(new Date());
  const windowStart = base?.windowStart ?? (firstWindow ? new Date(firstWindow.start) : null);
  const windowEnd = base?.windowEnd ?? (firstWindow ? new Date(firstWindow.end) : null);
  const initial: OfferValues = {
    kind,
    scope: base?.scope ?? "",
    calloutFee: base?.calloutFeeMinor ? minorToInput(base.calloutFeeMinor) : "",
    serviceFee: base?.serviceFeeMinor ? minorToInput(base.serviceFeeMinor) : "",
    taxRate: base?.taxRateBp !== null && base?.taxRateBp !== undefined ? String(base.taxRateBp / 100).replace(".", ",") : "20",
    taxNote: base?.taxNote ?? "",
    windowDate: windowStart && windowStart.getTime() > Date.now() ? localDateString(windowStart) : addDaysToDateString(today, 1),
    windowStart: windowStart ? localTimeString(windowStart) : "09:00",
    windowEnd: windowEnd ? localTimeString(windowEnd) : "12:00",
    estimatedDurationMin: base?.estimatedDurationMin ?? (kind === "DIAGNOSTIC" ? 60 : 120),
    exclusions: base?.exclusions ?? "",
    cancellationTerms: base?.cancellationTerms ?? t("offerEditor.defaultCancellation"),
    warrantyTerms: base?.warrantyTerms ?? "",
    validDays: 7,
  };
  return (
    <>
      <PageHeader
        title={`${brief.reference} · ${brief.title}`}
        back={{ href: "/prestataire/invitations", label: t("providerInvitations.title") }}
        meta={
          <>
            <StatusBadge domain="invitation" status={invitation.status} />
            <Badge>{te("enums.requestKind", brief.kind)}</Badge>
            {invitation.invitedAsAdmin ? <Badge tone="info">{t("providerInvitations.routed")}</Badge> : null}
          </>
        }
        actions={invitation.status === "INVITED" ? <DeclineInvitationButton invitationId={invitation.id} /> : null}
      />
      {booking ? (
        <Alert tone="info" title={t("providerInvitations.selected")} className="mb-6">
          <Link href={`/prestataire/rendez-vous/${booking.id}`} className="font-semibold underline">
            {booking.reference} · {te("status.booking", booking.status)}
          </Link>
        </Alert>
      ) : null}
      {!entitlement.active && active ? (
        <Alert tone="warn" title={t("providerInvitations.notEntitled")} className="mb-6">
          <Link href="/prestataire/abonnement" className="font-semibold underline">
            {t("providerDashboard.openSubscription")}
          </Link>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("providerInvitations.brief")} description={t("providerInvitations.briefNote")} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: t("booking.category"), value: brief.equipmentCategory },
                  { label: t("booking.brandModel"), value: [brief.brand, brief.model].filter(Boolean).join(" ") || null },
                  { label: t("providerInvitations.installedYear"), value: brief.installedYear ? String(brief.installedYear) : null },
                  { label: t("providerInvitations.where"), value: `${brief.city}${brief.serviceAreaName ? ` (${brief.serviceAreaName})` : ""}` },
                  { label: t("booking.symptoms"), value: brief.symptoms },
                  { label: t("providerInvitations.windows"), value: brief.preferredWindows.map((w) => formatWindow(w.start, w.end)).join("\n") },
                  { label: t("providerInvitations.received"), value: formatDateTime(invitation.createdAt) },
                ].filter((i) => i.value)}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("providerInvitations.attachments")} />
            <CardBody>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted">{t("providerInvitations.noAttachments")}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                      {a.mimeType?.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element -- private authorized thumbnail
                        <img src={`/api/v1/documents/${a.id}/download?inline=1`} alt="" className="size-12 rounded object-cover" />
                      ) : null}
                      <a href={`/api/v1/documents/${a.id}/download`} className="min-w-0 truncate font-semibold text-brand hover:underline">
                        {a.originalName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {versions.filter((v) => v.status !== "DRAFT").length ? (
            <Card>
              <CardHeader title={t("providerInvitations.versions")} />
              <CardBody>
                <ul className="divide-y divide-line">
                  {versions
                    .filter((v) => v.status !== "DRAFT")
                    .map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span>
                          <span className="font-semibold">{t("quote.version", { n: v.versionNo })}</span> · {formatMoney(v.totalMinor, v.currency)}
                          <span className="block text-xs text-muted">
                            {formatWindow(v.windowStart, v.windowEnd)} · {durationLabel(v.estimatedDurationMin)} · {t("quote.issuedOn", { date: formatDateTime(v.issuedAt) })}
                          </span>
                        </span>
                        <StatusBadge domain="offerVersion" status={v.status} />
                      </li>
                    ))}
                </ul>
                {issued && offer && active ? (
                  <div className="mt-3">
                    <WithdrawOfferButton offerId={offer.id} />
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="min-w-0">
          {active ? (
            <Card>
              <CardHeader
                title={draft ? t("providerInvitations.editDraft", { n: draft.versionNo }) : issued ? t("providerInvitations.revise") : t("providerInvitations.newOffer")}
                description={issued && !draft ? t("providerInvitations.reviseIntro", { n: issued.versionNo }) : t("providerInvitations.offerIntro")}
                actions={draft && offer ? <DiscardOfferDraftButton offerId={offer.id} /> : null}
              />
              <CardBody>
                <OfferEditor invitationId={invitation.id} offerId={offer?.id ?? null} initial={initial} kind={kind} />
              </CardBody>
            </Card>
          ) : (
            <Alert tone="info" title={t("providerInvitations.inactive")}>
              {invitation.declineReason ?? t("providerInvitations.inactiveBody")}
            </Alert>
          )}
        </div>
      </div>
    </>
  );
}
