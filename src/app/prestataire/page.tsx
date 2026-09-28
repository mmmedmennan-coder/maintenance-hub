import { CalendarCheck, Inbox, Receipt, Scale, SquareCheck, Users, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { providerDashboard } from "@/server/modules/dashboards";
import { StatusBadge } from "@/components/domain/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState, Stat } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("providerDashboard.title") };

export default async function ProviderDashboard() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const d = await withActor(actor, (tx) => providerDashboard(tx, actor));
  const status = d.profile?.status ?? "DRAFT";
  return (
    <>
      <PageHeader title={t("providerDashboard.title")} description={t("providerDashboard.intro", { org: actor.orgName })} />
      {status !== "APPROVED" ? (
        <Alert tone={status === "REJECTED" || status === "SUSPENDED" ? "danger" : "warn"} title={t(`providerDashboard.profile.${status}`)} className="mb-4">
          {d.profile?.statusReason ? `${d.profile.statusReason} ` : ""}
          <Link href="/prestataire/profil" className="font-semibold underline">
            {t("providerDashboard.openProfile")}
          </Link>
        </Alert>
      ) : null}
      {!d.entitlement.active ? (
        <Alert tone="warn" title={t("providerDashboard.subscriptionInactive")} className="mb-4">
          {d.entitlement.paidUntil ? t("providerDashboard.paidUntilPast", { date: formatDate(d.entitlement.paidUntil) }) : t("providerDashboard.noSubscription")}{" "}
          <Link href="/prestataire/abonnement" className="font-semibold underline">
            {t("providerDashboard.openSubscription")}
          </Link>
        </Alert>
      ) : null}
      {d.technicians === 0 ? (
        <Alert tone="info" title={t("providerDashboard.noTechnicians")} className="mb-4">
          <Link href="/prestataire/techniciens" className="font-semibold underline">
            {t("providerDashboard.addTechnician")}
          </Link>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("providerDashboard.statInvitations")} value={d.newInvitations.length} icon={Inbox} tone={d.newInvitations.length ? "warn" : "neutral"} />
        <Stat label={t("providerDashboard.statPending")} value={d.pendingBookings.length} icon={CalendarCheck} tone={d.pendingBookings.length ? "warn" : "neutral"} />
        <Stat label={t("providerDashboard.statApproval")} value={d.awaitingDecision} icon={SquareCheck} hint={t("providerDashboard.statParts", { n: d.awaitingParts })} />
        <Stat label={t("providerDashboard.statPayments")} value={d.paymentsToConfirm} icon={Receipt} tone={d.paymentsToConfirm ? "warn" : "neutral"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("providerDashboard.inbox")} actions={<Link href="/prestataire/invitations" className="text-sm font-semibold text-brand hover:underline">{t("common.view")}</Link>} />
          <CardBody>
            {d.newInvitations.length === 0 && d.pendingBookings.length === 0 ? (
              <p className="text-sm text-muted">{t("providerDashboard.inboxEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.pendingBookings.map((b) => (
                  <li key={b.id} className="py-2.5">
                    <Link href={`/prestataire/rendez-vous/${b.id}`} className="text-sm font-medium hover:text-brand">
                      {t("providerDashboard.confirmBooking", { ref: b.reference, date: formatDateTime(b.confirmationDeadline) })}
                    </Link>
                  </li>
                ))}
                {d.newInvitations.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <Link href={`/prestataire/invitations/${i.id}`} className="text-sm hover:text-brand">
                      <span className="font-medium">{i.brief.reference} · {i.brief.title}</span>
                      <span className="block text-xs text-muted">
                        {te("enums.requestKind", i.brief.kind)} · {i.brief.equipmentCategory} · {i.brief.city} · {formatDateTime(i.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("providerDashboard.upcoming")} actions={<Link href="/prestataire/calendrier" className="text-sm font-semibold text-brand hover:underline">{t("nav.calendar")}</Link>} />
          <CardBody>
            {d.upcoming.length === 0 ? (
              <EmptyState title={t("providerDashboard.noUpcoming")} />
            ) : (
              <ul className="divide-y divide-line">
                {d.upcoming.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/prestataire/rendez-vous/${b.id}`} className="text-sm hover:text-brand">
                      <span className="font-medium">{formatDateTime(b.scheduledStart)}</span> · {b.site.name}, {b.site.city}
                      <span className="block text-xs text-muted">{b.reference} · {b.technicianName ?? "—"}</span>
                    </Link>
                    {b.workOrder ? <StatusBadge domain="workOrder" status={b.workOrder.status} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label={t("providerDashboard.statActive")} value={d.reportsDue} icon={Wrench} hint={t("providerDashboard.statActiveHint")} />
        <Stat label={t("providerDashboard.statDisputes")} value={d.openDisputes} icon={Scale} tone={d.openDisputes ? "danger" : "neutral"} />
        <Stat label={t("providerDashboard.statTechnicians")} value={d.technicians} icon={Users} />
      </div>
    </>
  );
}
