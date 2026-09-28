import { LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listSupportMessages } from "@/server/modules/admin";
import { SupportHandledButton } from "@/features/admin-actions";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.support.title") };

export default async function AdminSupportPage() {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const messages = await withActor(actor, (tx) => listSupportMessages(tx, actor));
  return (
    <>
      <PageHeader title={t("admin.support.title")} description={t("admin.support.intro")} />
      {messages.length === 0 ? (
        <EmptyState icon={LifeBuoy} title={t("admin.support.empty")} />
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <CardBody className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{m.name}</span>
                  <a href={`mailto:${m.email}`} className="text-brand hover:underline">{m.email}</a>
                  {m.organizationName ? <span className="text-muted">· {m.organizationName}</span> : null}
                  <Badge>{te("enums.supportTopic", m.topic)}</Badge>
                  {m.handled ? <Badge tone="success">{t("admin.support.handled")}</Badge> : <Badge tone="warn">{t("admin.support.new")}</Badge>}
                  <span className="text-xs text-muted">{formatDateTime(m.createdAt)}</span>
                </p>
                <p className="whitespace-pre-line text-sm">{m.message}</p>
                {!m.handled ? <SupportHandledButton id={m.id} /> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
