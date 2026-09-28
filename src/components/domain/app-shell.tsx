import { Snowflake } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Actor } from "@/server/auth/roles";
import { getMemberships } from "@/server/auth/session";
import { withActor } from "@/server/db/context";
import { unreadCount } from "@/server/modules/notifications";
import { MobileNav, NotificationBell, OrgSwitcher, SidebarNav, SignOutButton, type Workspace } from "./shell-client";

export function workspaceFor(actor: Actor): Workspace {
  if (actor.orgType === "PLATFORM") return "admin";
  if (actor.orgType === "PROVIDER") return actor.role === "technician" ? "technician" : "provider";
  return actor.role === "customer_viewer" ? "customerViewer" : "customer";
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-bold text-ink">
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">
        <Snowflake aria-hidden className="size-5" />
      </span>
      <span className="leading-tight">
        {t("app.name")}
        <span className="block text-[10px] font-medium uppercase tracking-wide text-muted">{t("app.workingName")}</span>
      </span>
    </Link>
  );
}

/** Authenticated workspace frame: sidebar (desktop), drawer (mobile), organization switcher. */
export async function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const workspace = workspaceFor(actor);
  const [memberships, unread] = await Promise.all([getMemberships(actor.userId), withActor(actor, (tx) => unreadCount(tx, actor))]);
  const demo = memberships.find((m) => m.orgId === actor.orgId)?.isDemo;
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow">
        {t("app.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
          <MobileNav workspace={workspace} orgName={actor.orgName} />
          <Brand href={workspace === "admin" ? "/admin" : "/"} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden md:block">
              <OrgSwitcher
                current={actor.orgId}
                memberships={memberships.map((m) => ({ orgId: m.orgId, orgName: m.orgName, roleLabel: t(`roles.${m.role}`) }))}
              />
            </div>
            <NotificationBell unread={unread} />
            <SignOutButton compact />
          </div>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
          <div className="border-b border-line px-5 py-4">
            <p className="truncate text-sm font-semibold text-ink">{actor.orgName}</p>
            <p className="text-xs text-muted">
              {actor.userName} · {t(`roles.${actor.role}`)}
            </p>
            {demo ? <p className="mt-2 rounded-md border border-warn-line bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">{t("app.demoNotice")}</p> : null}
          </div>
          <SidebarNav workspace={workspace} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-4 md:hidden">
            <OrgSwitcher
              current={actor.orgId}
              memberships={memberships.map((m) => ({ orgId: m.orgId, orgName: m.orgName, roleLabel: t(`roles.${m.role}`) }))}
            />
          </div>
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
