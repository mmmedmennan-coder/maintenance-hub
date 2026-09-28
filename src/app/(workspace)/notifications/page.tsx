import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listNotifications } from "@/server/modules/notifications";
import { MarkAllRead, NotificationLink } from "@/features/notifications";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("nav.notifications") };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await guard();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const data = await withActor(actor, (tx) => listNotifications(tx, actor, page));
  return (
    <>
      <PageHeader title={t("nav.notifications")} description={t("notifications.intro", { count: data.unread })} actions={data.unread ? <MarkAllRead /> : null} />
      {data.items.length === 0 ? (
        <EmptyState icon={BellOff} title={t("notifications.empty")} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {data.items.map((n) => (
            <li key={n.id} className={n.readAt ? "" : "bg-brand-soft/40"}>
              <NotificationLink id={n.id} href={n.link ?? "#"} unread={!n.readAt}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {!n.readAt ? <span className="sr-only">{t("notifications.unread")} : </span> : null}
                      {n.title}
                    </span>
                    <span className="block text-sm text-ink-soft">{n.body}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </span>
              </NotificationLink>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/notifications?page=${n}`} />
    </>
  );
}
