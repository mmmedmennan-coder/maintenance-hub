import { t } from "@/lib/i18n";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="text-2xl font-bold text-ink">{t("errors.notFoundTitle")}</h1>
      <p className="text-ink-soft">{t("errors.notFoundBody")}</p>
      <ButtonLink href="/" className="mt-2">
        {t("errors.backHome")}
      </ButtonLink>
    </main>
  );
}
