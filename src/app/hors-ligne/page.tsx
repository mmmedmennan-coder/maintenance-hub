import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";

// Static, public, contains no user data: cached by the service worker at install time.
export const dynamic = "force-static";
export const metadata: Metadata = { title: t("app.offlineTitle"), robots: { index: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-warn-soft text-warn">
        <WifiOff aria-hidden className="size-7" />
      </span>
      <h1 className="text-2xl font-bold text-ink">{t("app.offlineTitle")}</h1>
      <p className="text-ink-soft">{t("app.offlineBody")}</p>
      <a href="/" className="inline-flex h-11 items-center rounded-lg bg-brand px-4 font-semibold text-white">
        {t("app.offlineRetry")}
      </a>
    </main>
  );
}
