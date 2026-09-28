"use client";

import {
  BadgeCheck,
  Bell,
  Building,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Menu,
  Receipt,
  Refrigerator,
  Route,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareCheck,
  Star,
  Tags,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { cn } from "@/components/ui/cn";

export type Workspace = "customer" | "customerViewer" | "provider" | "technician" | "admin";

type NavItem = { href: string; key: string; icon: LucideIcon; exact?: boolean };

const NAV: Record<Workspace, NavItem[]> = {
  customer: [
    { href: "/client", key: "dashboard", icon: LayoutDashboard, exact: true },
    { href: "/client/demandes", key: "requests", icon: ClipboardList },
    { href: "/client/rendez-vous", key: "bookings", icon: CalendarDays },
    { href: "/client/approbations", key: "approvals", icon: SquareCheck },
    { href: "/client/equipements", key: "equipment", icon: Refrigerator },
    { href: "/client/sites", key: "sites", icon: Building },
    { href: "/client/historique", key: "history", icon: ScrollText },
    { href: "/client/documents", key: "documents", icon: FileText },
    { href: "/client/paiements", key: "payments", icon: Wallet },
    { href: "/client/plans", key: "plans", icon: CalendarClock },
    { href: "/client/equipe", key: "team", icon: Users },
  ],
  customerViewer: [
    { href: "/client", key: "dashboard", icon: LayoutDashboard, exact: true },
    { href: "/client/demandes", key: "requests", icon: ClipboardList },
    { href: "/client/rendez-vous", key: "bookings", icon: CalendarDays },
    { href: "/client/equipements", key: "equipment", icon: Refrigerator },
    { href: "/client/sites", key: "sites", icon: Building },
    { href: "/client/historique", key: "history", icon: ScrollText },
    { href: "/client/documents", key: "documents", icon: FileText },
    { href: "/client/paiements", key: "payments", icon: Wallet },
  ],
  provider: [
    { href: "/prestataire", key: "dashboard", icon: LayoutDashboard, exact: true },
    { href: "/prestataire/invitations", key: "invitations", icon: Inbox },
    { href: "/prestataire/rendez-vous", key: "bookings", icon: CalendarDays },
    { href: "/prestataire/interventions", key: "workOrders", icon: Wrench },
    { href: "/prestataire/calendrier", key: "calendar", icon: CalendarRange },
    { href: "/prestataire/techniciens", key: "technicians", icon: ListChecks },
    { href: "/prestataire/plans", key: "plans", icon: CalendarClock },
    { href: "/prestataire/paiements", key: "payments", icon: Receipt },
    { href: "/prestataire/avis", key: "reviews", icon: Star },
    { href: "/prestataire/profil", key: "profile", icon: BadgeCheck },
    { href: "/prestataire/equipe", key: "team", icon: Users },
    { href: "/prestataire/abonnement", key: "subscription", icon: Wallet },
  ],
  technician: [
    { href: "/technicien", key: "myJobs", icon: Wrench, exact: true },
    { href: "/technicien/calendrier", key: "calendar", icon: CalendarRange },
  ],
  admin: [
    { href: "/admin", key: "dashboard", icon: LayoutDashboard, exact: true },
    { href: "/admin/prestataires", key: "providers", icon: ShieldCheck },
    { href: "/admin/routage", key: "routing", icon: Route },
    { href: "/admin/litiges", key: "disputes", icon: Scale },
    { href: "/admin/avis", key: "reviewModeration", icon: Star },
    { href: "/admin/abonnements", key: "subscriptions", icon: ClipboardCheck },
    { href: "/admin/referentiels", key: "reference", icon: Tags },
    { href: "/admin/audit", key: "audit", icon: ScrollText },
    { href: "/admin/support", key: "support", icon: LifeBuoy },
  ],
};

function NavLinks({ workspace, onNavigate }: { workspace: Workspace; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV[workspace].map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-soft text-brand-ink" : "text-ink-soft hover:bg-subtle hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-[18px] shrink-0" />
              {t(`nav.${item.key}`)}
            </Link>
          </li>
        );
      })}
      <li className="mt-2 border-t border-line pt-2">
        <Link
          href="/compte"
          onClick={onNavigate}
          aria-current={pathname === "/compte" ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
            pathname === "/compte" ? "bg-brand-soft text-brand-ink" : "text-ink-soft hover:bg-subtle",
          )}
        >
          <Settings aria-hidden className="size-[18px]" />
          {t("nav.account")}
        </Link>
      </li>
    </ul>
  );
}

export function SidebarNav({ workspace }: { workspace: Workspace }) {
  return (
    <nav aria-label={t("nav.main")} className="px-3 py-4">
      <NavLinks workspace={workspace} />
    </nav>
  );
}

export function MobileNav({ workspace, orgName }: { workspace: Workspace; orgName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the menu after navigation (state reset on prop change, without an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="inline-flex size-10 items-center justify-center rounded-lg text-ink hover:bg-subtle lg:hidden"
        aria-label={t("nav.openMenu")}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden className="size-6" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.main")}>
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label={t("common.close")} onClick={() => setOpen(false)} />
          <div id="mobile-nav" className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-y-auto bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="truncate text-sm font-semibold">{orgName}</span>
              <button type="button" autoFocus className="rounded-md p-1.5 hover:bg-subtle" aria-label={t("common.close")} onClick={() => setOpen(false)}>
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <nav aria-label={t("nav.main")} className="px-3 py-3">
              <NavLinks workspace={workspace} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function OrgSwitcher({ current, memberships }: { current: string; memberships: { orgId: string; orgName: string; roleLabel: string }[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (memberships.length < 2) return null;
  return (
    <div className="flex flex-col">
      <label htmlFor="org-switcher" className="sr-only">
        {t("nav.switchOrganization")}
      </label>
      <select
        id="org-switcher"
        value={current}
        disabled={pending}
        className="h-9 max-w-[14rem] rounded-lg border border-line-strong bg-surface px-2 text-sm"
        onChange={async (e) => {
          setPending(true);
          setError(null);
          try {
            const { home } = await api<{ home: string }>("/api/v1/me/active-organization", { body: { organizationId: e.target.value } });
            router.push(home);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : t("errors.generic"));
          } finally {
            setPending(false);
          }
        }}
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName} — {m.roleLabel}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function SignOutButton({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut().catch(() => undefined);
        router.push("/connexion");
        router.refresh();
      }}
      className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink-soft hover:bg-subtle"
    >
      <LogOut aria-hidden className="size-4" />
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{t("nav.signOut")}</span>
    </button>
  );
}

export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 0 ? t("nav.notificationsUnread", { count: unread }) : t("nav.notifications");
  return (
    <Link href="/notifications" className="relative inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-subtle" aria-label={label} title={label}>
      <Bell aria-hidden className="size-5" />
      {unread > 0 ? (
        <span aria-hidden className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
