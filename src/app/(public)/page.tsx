import { CalendarCheck, ClipboardList, FileCheck, Scale, ShieldCheck, Snowflake, SquareCheck, Wrench } from "lucide-react";
import { t } from "@/lib/i18n";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";

const STEPS = [
  { key: "request", icon: ClipboardList },
  { key: "compare", icon: Scale },
  { key: "book", icon: CalendarCheck },
  { key: "approve", icon: SquareCheck },
  { key: "report", icon: FileCheck },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div>
            <Badge tone="brand">{t("public.home.pilotBadge")}</Badge>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">{t("public.home.title")}</h1>
            <p className="mt-4 max-w-xl text-base text-ink-soft sm:text-lg">{t("public.home.subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/inscription?type=CUSTOMER" size="lg">
                {t("public.home.ctaCustomer")}
              </ButtonLink>
              <ButtonLink href="/inscription?type=PROVIDER" size="lg" variant="secondary">
                {t("public.home.ctaProvider")}
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-muted">{t("public.home.ctaNote")}</p>
          </div>
          <figure aria-label={t("public.home.illustrationLabel")} className="rounded-[var(--radius-card)] border border-line bg-canvas p-5 shadow-[var(--shadow-card)]">
            <figcaption className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
              <span>{t("public.home.illustrationTitle")}</span>
              <span>{t("public.home.illustrationTag")}</span>
            </figcaption>
            <ol className="space-y-3">
              {["one", "two", "three", "four"].map((k, i) => (
                <li key={k} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full ${i === 3 ? "bg-success-soft text-success" : "bg-brand-soft text-brand"}`}>
                    {i === 0 ? <Snowflake aria-hidden className="size-4" /> : i === 1 ? <Scale aria-hidden className="size-4" /> : i === 2 ? <Wrench aria-hidden className="size-4" /> : <FileCheck aria-hidden className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{t(`public.home.illustration.${k}.title`)}</p>
                    <p className="text-xs text-muted">{t(`public.home.illustration.${k}.body`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </figure>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-bold text-ink">{t("public.home.stepsTitle")}</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.key} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand">
                  <s.icon aria-hidden className="size-4" />
                </span>
                <span className="text-xs font-semibold text-muted">{t("public.home.stepLabel", { n: i + 1 })}</span>
              </div>
              <h3 className="mt-3 font-semibold text-ink">{t(`public.home.steps.${s.key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`public.home.steps.${s.key}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-2">
          {(["customers", "providers"] as const).map((who) => (
            <div key={who}>
              <h2 className="text-xl font-bold text-ink">{t(`public.home.${who}.title`)}</h2>
              <ul className="mt-4 space-y-3">
                {["a", "b", "c", "d"].map((k) => (
                  <li key={k} className="flex gap-3 text-sm text-ink-soft">
                    <SquareCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                    <span>{t(`public.home.${who}.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[var(--radius-card)] border border-warn-line bg-warn-soft p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5 text-warn" />
            <h2 className="text-lg font-bold text-ink">{t("public.home.limitsTitle")}</h2>
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-ink-soft md:grid-cols-2">
            {["a", "b", "c", "d"].map((k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden>•</span>
                {t(`public.home.limits.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
