import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listAuditEvents } from "@/server/modules/admin";
import { PageHeader, Pagination, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.audit.title") };

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ type?: string; cible?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const sp = await searchParams;
  const targetType = sp.type && /^[a-z_]{2,40}$/.test(sp.type) ? sp.type : undefined;
  const targetId = sp.cible && /^[A-Za-z0-9-]{1,64}$/.test(sp.cible) ? sp.cible : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => listAuditEvents(tx, actor, { targetType, targetId, page }));
  const qs = `${targetType ? `type=${targetType}&` : ""}${targetId ? `cible=${targetId}&` : ""}`;
  return (
    <>
      <PageHeader title={t("admin.audit.title")} description={t("admin.audit.intro")} />
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t("admin.audit.targetType")}
          <input name="type" defaultValue={targetType ?? ""} className="h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal" placeholder="booking" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t("admin.audit.targetId")}
          <input name="cible" defaultValue={targetId ?? ""} className="h-10 w-80 max-w-full rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <button type="submit" className="h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-subtle">
          {t("common.filter")}
        </button>
      </form>
      <Table caption={t("admin.audit.title")} head={<tr><Th>{t("common.date")}</Th><Th>{t("admin.audit.actor")}</Th><Th>{t("admin.audit.action")}</Th><Th>{t("admin.audit.target")}</Th><Th>{t("admin.reason")}</Th></tr>}>
        {data.items.map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap text-sm">{formatDateTime(e.createdAt)}</Td>
            <Td className="text-sm">{e.actorName}{e.actorRole ? <span className="block text-xs text-muted">{e.actorRole}</span> : null}</Td>
            <Td className="font-mono text-xs">{e.action}</Td>
            <Td className="font-mono text-xs">{e.targetType}{e.targetId ? <span className="block text-muted">{e.targetId}</span> : null}</Td>
            <Td className="max-w-xs text-sm">{e.reason ?? "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/admin/audit?${qs}page=${n}`} />
    </>
  );
}
