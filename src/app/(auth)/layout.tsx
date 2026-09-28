import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Brand } from "@/components/domain/app-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Brand />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">{children}</div>
      </main>
      <footer className="pb-6 text-center text-xs text-muted">
        <p>{t("public.footer.disclaimer")}</p>
      </footer>
    </div>
  );
}
