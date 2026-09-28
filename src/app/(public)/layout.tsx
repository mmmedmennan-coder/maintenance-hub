import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { workspaceHome } from "@/server/auth/roles";
import { getActor, getSession } from "@/server/auth/session";
import { Brand } from "@/components/domain/app-shell";
import { PublicMobileMenu } from "@/components/domain/public-menu";
import { ButtonLink } from "@/components/ui/button";

const LINKS = [
  { href: "/comment-ca-marche", key: "howItWorks" },
  { href: "/prestataires", key: "directory" },
  { href: "/tarifs", key: "pricing" },
  { href: "/contact", key: "contact" },
];

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const actor = session ? await getActor() : null;
  const home = actor ? workspaceHome(actor.orgType, actor.role) : session ? "/onboarding" : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow">
        {t("app.skipToContent")}
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Brand />
          <nav aria-label={t("public.nav.label")} className="ml-6 hidden md:block">
            <ul className="flex gap-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink">
                    {t(`public.nav.${l.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            {home ? (
              <ButtonLink href={home} size="sm">
                {t("public.nav.myWorkspace")}
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/connexion" variant="ghost" size="sm">
                  {t("public.nav.signIn")}
                </ButtonLink>
                <ButtonLink href="/inscription" size="sm">
                  {t("public.nav.signUp")}
                </ButtonLink>
              </>
            )}
          </div>
          <PublicMobileMenu
            links={LINKS.map((l) => ({ href: l.href, label: t(`public.nav.${l.key}`) }))}
            account={home ? { href: home, label: t("public.nav.myWorkspace") } : null}
          />
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted sm:grid-cols-3 sm:px-6">
          <div>
            <p className="font-semibold text-ink">{t("app.name")}</p>
            <p className="mt-1">{t("public.footer.about")}</p>
          </div>
          <ul className="space-y-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link className="hover:text-ink hover:underline" href={l.href}>
                  {t(`public.nav.${l.key}`)}
                </Link>
              </li>
            ))}
            <li>
              <Link className="hover:text-ink hover:underline" href="/confidentialite">
                {t("public.nav.privacy")}
              </Link>
            </li>
          </ul>
          <p>{t("public.footer.disclaimer")}</p>
        </div>
      </footer>
    </div>
  );
}
