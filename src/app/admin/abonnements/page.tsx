import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, addMonthsToDateString, formatCalendarDate, formatDateTime, localDateString } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listSubscriptions } from "@/server/modules/admin";
import { StatusBadge } from "@/components/domain/status-badge";
import { PlanEditForm, SubscriptionCorrectionButton, SubscriptionPeriodForm } from "@/features/admin-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.subscriptions.title") };

/** Manual pilot subscriptions: periods are recorded after payment is collected outside the platform. */
export default async function AdminSubscriptionsPage() {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const { providers, plans } = await withActor(actor, (tx) => listSubscriptions(tx, actor));
  const today = localDateString(new Date());
  const plan = plans.find((p) => p.active) ?? plans[0];
  return (
    <>
      <PageHeader title={t("admin.subscriptions.title")} description={t("admin.subscriptions.intro")} />
      <Alert tone="info" className="mb-6">{t("admin.subscriptions.manualNote")}</Alert>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {providers.map((p) => {
            const paidUntil = p.subscription?.paidUntil?.toISOString().slice(0, 10) ?? null;
            const active = !!paidUntil && paidUntil >= today;
            const start = paidUntil && paidUntil >= today ? addDaysToDateString(paidUntil, 1) : today;
            return (
              <Card key={p.id}>
                <CardHeader
                  title={p.displayName}
                  description={paidUntil ? t("subscription.paidUntil", { date: formatCalendarDate(paidUntil) }) : t("subscription.never")}
                  actions={
                    <>
                      <StatusBadge domain="provider" status={p.status} />
                      <Badge tone={active ? "success" : "warn"}>{active ? t("subscription.active") : t("subscription.inactive")}</Badge>
                      {p.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
                    </>
                  }
                />
                <CardBody className="space-y-4">
                  {p.subscription?.events.length ? (
                    <ul className="space-y-1 text-xs text-muted">
                      {p.subscription.events.map((e) => (
                        <li key={e.id}>
                          {formatDateTime(e.createdAt)} · {te("enums.subscriptionEvent", e.type)}
                          {e.periodStart && e.periodEnd ? ` · ${formatCalendarDate(e.periodStart)} → ${formatCalendarDate(e.periodEnd)}` : ""}
                          {e.amountMinor !== null ? ` · ${formatMoney(e.amountMinor, e.currency ?? "MAD")}` : ""} · {e.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-brand">{t("admin.subscriptions.record")}</summary>
                    <div className="mt-3">
                      <SubscriptionPeriodForm providerOrgId={p.providerOrgId} defaults={{ periodStart: start, periodEnd: addDaysToDateString(addMonthsToDateString(start, 1), -1), amount: plan?.priceMinor ?? 0 }} />
                    </div>
                  </details>
                  {p.subscription ? <SubscriptionCorrectionButton providerOrgId={p.providerOrgId} paidUntil={paidUntil} /> : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
        <div className="space-y-4">
          {plans.map((pl) => (
            <Card key={pl.id}>
              <CardHeader title={pl.name} description={`${pl.code} · ${formatMoney(pl.priceMinor, pl.currency)} / ${t("admin.subscriptions.month")}`} />
              <CardBody>
                <PlanEditForm plan={{ id: pl.id, name: pl.name, priceMinor: pl.priceMinor, maxStaff: pl.maxStaff, taxNote: pl.taxNote, active: pl.active }} />
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
