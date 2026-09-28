"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n";

export function PublicMobileMenu({ links, account }: { links: { href: string; label: string }[]; account: { href: string; label: string } | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the menu after navigation (state reset on prop change, without an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  return (
    <div className="ml-auto sm:ml-2 md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        aria-label={open ? t("common.close") : t("nav.openMenu")}
        className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-subtle"
      >
        {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
      </button>
      {open ? (
        <div id="public-mobile-menu" className="absolute inset-x-0 top-16 z-40 border-b border-line bg-surface px-4 py-3 shadow-[var(--shadow-pop)]">
          <ul className="flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-lg px-3 py-2.5 font-medium hover:bg-subtle">
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 flex gap-2 border-t border-line pt-3">
              {account ? (
                <Link href={account.href} className="flex-1 rounded-lg bg-brand px-3 py-2.5 text-center font-semibold text-white">
                  {account.label}
                </Link>
              ) : (
                <>
                  <Link href="/connexion" className="flex-1 rounded-lg border border-line-strong px-3 py-2.5 text-center font-semibold">
                    {t("public.nav.signIn")}
                  </Link>
                  <Link href="/inscription" className="flex-1 rounded-lg bg-brand px-3 py-2.5 text-center font-semibold text-white">
                    {t("public.nav.signUp")}
                  </Link>
                </>
              )}
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
