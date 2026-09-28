import { SquareCheck } from "lucide-react";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { withPublic } from "@/server/db/context";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";

export const metadata: Metadata = { title: t("public.pricing.title") };

export default async function PricingPage() {
  const plan = await withPublic((tx) => tx.subscriptionPlan.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }));
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("public.pricing.title")}</h1>
      <p className="mt-3 max-w-3xl text-ink-soft">{t("public.pricing.intro")}</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardBody className="space-y-4 p-6">
            <Badge tone="brand">{t("public.pricing.customers.badge")}</Badge>
            <h2 className="text-xl font-bold text-ink">{t("public.pricing.customers.title")}</h2>
            <p className="text-3xl font-bold text-ink">{t("public.pricing.customers.price")}</p>
            <ul className="space-y-2 text-sm text-ink-soft">
              {["a", "b", "c"].map((k) => (
                <li key={k} className="flex gap-2">
                  <SquareCheck aria-hidden className="size-5 shrink-0 text-brand" />
                  {t(`public.pricing.customers.${k}`)}
                </li>
              ))}
            </ul>
            <ButtonLink href="/inscription?type=CUSTOMER">{t("public.home.ctaCustomer")}</ButtonLink>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4 p-6">
            <Badge tone="warn">{t("public.pricing.providers.badge")}</Badge>
            <h2 className="text-xl font-bold text-ink">{plan?.name ?? t("public.pricing.providers.title")}</h2>
            {plan ? (
              <p className="text-3xl font-bold text-ink">
                {formatMoney(plan.priceMinor, plan.currency)}
                <span className="text-base font-medium text-muted"> {t("public.pricing.providers.perMonth")}</span>
              </p>
            ) : (
              <p className="text-muted">{t("public.pricing.providers.unavailable")}</p>
            )}
            <p className="text-sm text-muted">{plan?.taxNote}</p>
            <ul className="space-y-2 text-sm text-ink-soft">
              <li className="flex gap-2">
                <SquareCheck aria-hidden className="size-5 shrink-0 text-brand" />
                {t("public.pricing.providers.staff", { n: plan?.maxStaff ?? 3 })}
              </li>
              {["a", "b", "c", "d"].map((k) => (
                <li key={k} className="flex gap-2">
                  <SquareCheck aria-hidden className="size-5 shrink-0 text-brand" />
                  {t(`public.pricing.providers.${k}`)}
                </li>
              ))}
            </ul>
            <ButtonLink href="/inscription?type=PROVIDER" variant="secondary">
              {t("public.home.ctaProvider")}
            </ButtonLink>
          </CardBody>
        </Card>
      </div>
      <Alert tone="warn" title={t("public.pricing.honestTitle")} className="mt-8">
        {t("public.pricing.honestBody")}
      </Alert>
    </div>
  );
}
