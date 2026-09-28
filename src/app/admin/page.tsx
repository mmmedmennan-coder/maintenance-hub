import { CircleAlert, Route, Scale, ShieldCheck, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { adminMetrics } from "@/server/modules/admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Stat } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.dashboard.title") };

function Breakdown({ title, domain, data }: { title: string; domain: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.dashboard.none")}</p>
        ) : (
          <dl className="grid gap-1 text-sm">
            {entries.map(([status, count]) => (
              <div key={status} className="flex justify-between gap-4">
                <dt className="text-muted">{te(`status.${domain}`, status)}</dt>
                <dd className="font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

/** Pilot operations overview: every figure is a live count from the database (no invented numbers). */
export default async function AdminDashboard() {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const m = await withActor(actor, (tx) => adminMetrics(tx, actor));
  const queueIssues = m.queue ? Number(m.queue.outbox_dead) + Number(m.queue.email_dead) + Number(m.queue.outbox_failed) + Number(m.queue.email_failed) : 0;
  return (
    <>
      <PageHeader title={t("admin.dashboard.title")} description={t("admin.dashboard.intro")} />
      {queueIssues > 0 ? (
        <Alert tone="danger" title={t("admin.dashboard.queueIssues")} className="mb-6">
          {t("admin.dashboard.queueBody", {
            outboxFailed: Number(m.queue?.outbox_failed ?? 0),
            outboxDead: Number(m.queue?.outbox_dead ?? 0),
            emailFailed: Number(m.queue?.email_failed ?? 0),
            emailDead: Number(m.queue?.email_dead ?? 0),
          })}
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/routage" className="block">
          <Stat label={t("admin.dashboard.unmatched")} value={m.unmatched} icon={Route} tone={m.unmatched ? "warn" : "neutral"} hint={t("admin.dashboard.unmatchedHint")} />
        </Link>
        <Link href="/admin/prestataires?statut=SUBMITTED" className="block">
          <Stat label={t("admin.dashboard.toReview")} value={m.providers.SUBMITTED ?? 0} icon={ShieldCheck} tone={m.providers.SUBMITTED ? "warn" : "neutral"} />
        </Link>
        <Link href="/admin/litiges" className="block">
          <Stat label={t("admin.dashboard.disputes")} value={m.openDisputes} icon={Scale} tone={m.openDisputes ? "danger" : "neutral"} />
        </Link>
        <Link href="/admin/avis" className="block">
          <Stat label={t("admin.dashboard.reviews")} value={m.pendingReviews} icon={Star} />
        </Link>
        <Link href="/admin/abonnements" className="block">
          <Stat label={t("admin.dashboard.subscriptions")} value={`${m.subscriptions.active} / ${m.subscriptions.total}`} icon={Wallet} hint={t("admin.dashboard.subscriptionsHint")} />
        </Link>
        <Stat
          label={t("admin.dashboard.confirmationRate")}
          value={m.confirmationRate === null ? "—" : `${Math.round(m.confirmationRate * 100)} %`}
          icon={CircleAlert}
          hint={t("admin.dashboard.confirmationRateHint")}
        />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Breakdown title={t("admin.dashboard.providers")} domain="provider" data={m.providers} />
        <Breakdown title={t("admin.dashboard.requests")} domain="request" data={m.requests} />
        <Breakdown title={t("admin.dashboard.bookings")} domain="booking" data={m.bookings} />
        <Breakdown title={t("admin.dashboard.workOrders")} domain="workOrder" data={m.workOrders} />
      </div>
      <p className="mt-6 text-xs text-muted">
        {t("admin.dashboard.queue", { pending: Number(m.queue?.outbox_pending ?? 0) })}
      </p>
    </>
  );
}
