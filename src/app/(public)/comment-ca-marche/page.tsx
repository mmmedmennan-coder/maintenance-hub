import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export const metadata: Metadata = { title: t("public.how.title") };

const JOURNEY = ["search", "describe", "compare", "book", "diagnose", "approve", "track", "close"];
const RULES = ["verification", "availability", "cancellation", "priceChanges", "completion", "reviews"];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("public.how.title")}</h1>
      <p className="mt-3 text-ink-soft">{t("public.how.intro")}</p>

      <h2 className="mt-10 text-xl font-bold text-ink">{t("public.how.journeyTitle")}</h2>
      <ol className="mt-4 space-y-3">
        {JOURNEY.map((k, i) => (
          <li key={k} className="flex gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
            <div>
              <h3 className="font-semibold text-ink">{t(`public.how.journey.${k}.title`)}</h3>
              <p className="mt-1 text-sm text-muted">
                <strong className="font-semibold text-ink-soft">{t("public.how.customer")} </strong>
                {t(`public.how.journey.${k}.customer`)}
              </p>
              <p className="mt-1 text-sm text-muted">
                <strong className="font-semibold text-ink-soft">{t("public.how.providerSystem")} </strong>
                {t(`public.how.journey.${k}.provider`)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-xl font-bold text-ink">{t("public.how.pathsTitle")}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(["scheduled", "breakdown"] as const).map((k) => (
          <Card key={k}>
            <CardBody>
              <h3 className="font-semibold text-ink">{t(`public.how.paths.${k}.title`)}</h3>
              <p className="mt-2 text-sm text-muted">{t(`public.how.paths.${k}.body`)}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft">{t("public.how.pricingNote")}</p>

      <h2 className="mt-10 text-xl font-bold text-ink">{t("public.how.rulesTitle")}</h2>
      <dl className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        {RULES.map((k) => (
          <div key={k} className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr]">
            <dt className="font-semibold text-ink">{t(`public.how.rules.${k}.title`)}</dt>
            <dd className="text-sm text-muted">{t(`public.how.rules.${k}.body`)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/inscription?type=CUSTOMER">{t("public.home.ctaCustomer")}</ButtonLink>
        <ButtonLink href="/prestataires" variant="secondary">
          {t("public.how.browse")}
        </ButtonLink>
      </div>
    </div>
  );
}
