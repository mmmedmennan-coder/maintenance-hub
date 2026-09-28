"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { ActionButton } from "@/components/ui/dialog";

export function MarkAllRead() {
  return (
    <ActionButton variant="secondary" onRun={() => api("/api/v1/notifications/read", { body: { ids: "all" } })}>
      {t("notifications.markAllRead")}
    </ActionButton>
  );
}

export function NotificationLink({ id, href, unread, children }: { id: string; href: string; unread: boolean; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      className="block px-4 py-3 hover:bg-subtle"
      onClick={async (e) => {
        e.preventDefault();
        if (unread) await api("/api/v1/notifications/read", { body: { ids: [id] } }).catch(() => undefined);
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}
