import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { getEntitlement } from "@/server/modules/providers";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("subscription.title") };

/** Pilot subscription: payments are arranged directly with the platform team and recorded manually. */
export default async function ProviderSubscriptionPage() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const { entitlement, subscription, plan } = await withActor(actor, async (tx) => {
    const subscription = await tx.providerSubscription.findUnique({ where: { providerOrgId: actor.orgId }, include: { plan: true, events: { orderBy: { createdAt: "desc" }, take: 20 } } });
    const plan = subscription?.plan ?? (await tx.subscriptionPlan.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }));
    return { entitlement: await getEntitlement(tx, actor.orgId), subscription, plan };
  });
  return (
    <>
      <PageHeader title={t("subscription.title")} description={t("subscription.intro")} />
      <Alert tone={entitlement.active ? "success" : "warn"} title={entitlement.active ? t("subscription.active") : t("subscription.inactive")} className="mb-6">
        {entitlement.paidUntil ? t("subscription.paidUntil", { date: formatCalendarDate(entitlement.paidUntil) }) : t("subscription.never")} {t("subscription.effect")}
      </Alert>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {plan ? (
          <Card>
            <CardHeader title={plan.name} description={t("subscription.planIntro")} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: t("subscription.price"), value: t("subscription.pricePerMonth", { price: formatMoney(plan.priceMinor, plan.currency) }) },
                  { label: t("subscription.staff"), value: t("subscription.staffValue", { n: plan.maxStaff }) },
                  { label: t("subscription.taxNote"), value: plan.taxNote },
                  { label: t("subscription.howToPay"), value: t("subscription.howToPayBody") },
                ]}
              />
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("subscription.history")} />
          <CardBody>
            {!subscription || subscription.events.length === 0 ? (
              <p className="text-sm text-muted">{t("subscription.noHistory")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {subscription.events.map((e) => (
                  <li key={e.id} className="py-2.5 text-sm">
                    <p className="font-medium">
                      {te("enums.subscriptionEvent", e.type)}
                      {e.amountMinor !== null ? ` · ${formatMoney(e.amountMinor, e.currency ?? "MAD")}` : ""}
                    </p>
                    <p className="text-xs text-muted">
                      {e.periodStart && e.periodEnd ? `${formatCalendarDate(e.periodStart)} → ${formatCalendarDate(e.periodEnd)} · ` : ""}
                      {formatDateTime(e.createdAt)}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                    {e.reason ? <p className="text-xs">{e.reason}</p> : null}
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
