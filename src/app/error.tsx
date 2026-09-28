"use client";

import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold text-ink">{t("errors.serverTitle")}</h1>
      <p className="text-ink-soft">{t("errors.serverBody")}</p>
      <Button onClick={reset} className="mt-2">
        {t("errors.retry")}
      </Button>
    </main>
  );
}
