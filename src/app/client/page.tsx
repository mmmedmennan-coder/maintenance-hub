import { CalendarCheck, ClipboardList, FileCheck, Plus, Refrigerator, SquareCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { customerDashboard } from "@/server/modules/dashboards";
import { StatusBadge } from "@/components/domain/status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState, Stat } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.dashboard.title") };

export default async function CustomerDashboard() {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const d = await withActor(actor, (tx) => customerDashboard(tx, actor));
  const writer = can.customerWrite(actor);
  const todo = [
    ...d.approvals.map((a) => ({
      key: `a-${a.id}`,
      href: `/client/rendez-vous/${a.repairQuote.workOrder.bookingId}#devis`,
      label: t("customer.dashboard.todoApproval", { ref: a.repairQuote.workOrder.reference, total: formatMoney(a.totalMinor, a.currency) }),
      tone: "warn" as const,
    })),
    ...d.toAcknowledge.map((w) => ({ key: `r-${w.id}`, href: `/client/rendez-vous/${w.bookingId}#rapport`, label: t("customer.dashboard.todoReport", { ref: w.reference }), tone: "info" as const })),
    ...d.withOffers.map((r) => ({ key: `o-${r.id}`, href: `/client/demandes/${r.id}#offres`, label: t("customer.dashboard.todoOffers", { ref: r.reference, title: r.title }), tone: "info" as const })),
    ...d.needsReopen.map((r) => ({ key: `n-${r.id}`, href: `/client/demandes/${r.id}`, label: t("customer.dashboard.todoReopen", { ref: r.reference }), tone: "warn" as const })),
    ...d.drafts.map((r) => ({
      key: `d-${r.id}`,
      href: `/client/demandes/${r.id}`,
      label: r.source === "MAINTENANCE_PLAN" ? t("customer.dashboard.todoPlanDraft", { ref: r.reference, title: r.title }) : t("customer.dashboard.todoDraft", { ref: r.reference, title: r.title }),
      tone: "info" as const,
    })),
  ];
  return (
    <>
      <PageHeader
        title={t("customer.dashboard.title")}
        description={t("customer.dashboard.intro", { org: actor.orgName })}
        actions={
          writer ? (
            <>
              <ButtonLink href="/client/demandes/nouvelle" icon={<Plus aria-hidden className="size-4" />}>
                {t("customer.requests.new")}
              </ButtonLink>
              <ButtonLink href="/client/equipements/nouveau" variant="secondary">
                {t("customer.equipment.new")}
              </ButtonLink>
            </>
          ) : null
        }
      />
      {!writer ? <Alert tone="info" className="mb-6">{t("common.readOnly")}</Alert> : null}
      {d.equipmentCount === 0 && writer ? (
        <Alert tone="info" title={t("customer.dashboard.startTitle")} className="mb-6">
          {t("customer.dashboard.startBody")}{" "}
          <Link href={d.sitesCount === 0 ? "/client/sites/nouveau" : "/client/equipements/nouveau"} className="font-semibold underline">
            {d.sitesCount === 0 ? t("customer.sites.new") : t("customer.equipment.new")}
          </Link>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("customer.dashboard.statOpen")} value={d.openRequests} icon={ClipboardList} />
        <Stat label={t("customer.dashboard.statPending")} value={d.pendingBookings.length} icon={CalendarCheck} hint={t("customer.dashboard.statPendingHint")} />
        <Stat label={t("customer.dashboard.statApprovals")} value={d.approvals.length} icon={SquareCheck} tone={d.approvals.length ? "warn" : "neutral"} />
        <Stat label={t("customer.dashboard.statEquipment")} value={d.equipmentCount} icon={Refrigerator} hint={t("customer.dashboard.statSites", { count: d.sitesCount })} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("customer.dashboard.todo")} description={t("customer.dashboard.todoIntro")} />
          <CardBody>
            {todo.length === 0 ? (
              <p className="text-sm text-muted">{t("customer.dashboard.todoEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {todo.map((item) => (
                  <li key={item.key} className="py-2.5">
                    <Link href={item.href} className="flex items-start gap-2 text-sm font-medium text-ink hover:text-brand">
                      {item.tone === "warn" ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" /> : <FileCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />}
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d.openDisputes ? <p className="mt-3 text-sm text-danger">{t("customer.dashboard.disputes", { count: d.openDisputes })}</p> : null}
            {d.plansProposed ? (
              <p className="mt-2 text-sm">
                <Link className="font-semibold text-brand hover:underline" href="/client/plans">
                  {t("customer.dashboard.plans", { count: d.plansProposed })}
                </Link>
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("customer.dashboard.upcoming")} actions={<Link href="/client/rendez-vous" className="text-sm font-semibold text-brand hover:underline">{t("common.view")}</Link>} />
          <CardBody>
            {d.upcoming.length === 0 && d.pendingBookings.length === 0 ? (
              <EmptyState title={t("customer.dashboard.noUpcoming")}>{t("customer.dashboard.noUpcomingBody")}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {d.pendingBookings.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/client/rendez-vous/${b.id}`} className="text-sm font-medium hover:text-brand">
                      {b.reference} · {t("customer.dashboard.awaitingConfirmation", { date: formatDateTime(b.confirmationDeadline) })}
                    </Link>
                    <StatusBadge domain="booking" status="PENDING_CONFIRMATION" />
                  </li>
                ))}
                {d.upcoming.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/client/rendez-vous/${b.id}`} className="text-sm hover:text-brand">
                      <span className="font-medium">{formatDateTime(b.scheduledStart)}</span> · {b.equipment.label} · {b.site.name}
                      <span className="block text-xs text-muted">{t("customer.dashboard.withTechnician", { name: b.technicianName ?? "—" })}</span>
                    </Link>
                    <StatusBadge domain="workOrder" status={b.workOrder?.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
