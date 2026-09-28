import type { Metadata } from "next";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("public.privacy.title") };

const SECTIONS = ["data", "sharing", "retention", "rights", "status"];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("public.privacy.title")}</h1>
      <p className="mt-3 text-ink-soft">{t("public.privacy.intro")}</p>
      {SECTIONS.map((k) => (
        <section key={k} className="mt-8">
          <h2 className="text-lg font-semibold text-ink">{t(`public.privacy.${k}.title`)}</h2>
          <p className="prose-plain mt-2 text-sm text-ink-soft">{t(`public.privacy.${k}.body`)}</p>
        </section>
      ))}
    </div>
  );
}
