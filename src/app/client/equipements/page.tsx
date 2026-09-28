import { Plus, Refrigerator } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listEquipment, listSites } from "@/server/modules/assets";
import { listEquipmentCategories } from "@/server/modules/reference";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.equipment.title") };

type SP = { site?: string; category?: string; archives?: string; page?: string };

export default async function EquipmentListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
  const page = Math.max(1, Number(sp.page) || 1);
  const [sites, categories, data] = await withActor(actor, (tx) =>
    Promise.all([
      listSites(tx, actor),
      listEquipmentCategories(tx),
      listEquipment(tx, actor, { siteId: uuid(sp.site), categoryId: uuid(sp.category), includeArchived: sp.archives === "1", page }),
    ]),
  );
  const writer = can.customerWrite(actor);
  const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
  return (
    <>
      <PageHeader
        title={t("customer.equipment.title")}
        description={t("customer.equipment.intro")}
        actions={writer ? <ButtonLink href="/client/equipements/nouveau" icon={<Plus aria-hidden className="size-4" />}>{t("customer.equipment.new")}</ButtonLink> : null}
      />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="site" className="text-xs font-semibold text-muted">{t("customer.equipment.site")}</label>
          <select id="site" name="site" defaultValue={sp.site ?? ""} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm">
            <option value="">{t("common.all")}</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-xs font-semibold text-muted">{t("customer.equipment.category")}</label>
          <select id="category" name="category" defaultValue={sp.category ?? ""} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm">
            <option value="">{t("common.all")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.labelFr}</option>)}
          </select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="archives" value="1" defaultChecked={sp.archives === "1"} className="size-4 accent-[var(--color-brand)]" />
          {t("customer.assets.showArchived")}
        </label>
        <Button type="submit" size="sm" variant="secondary">{t("common.filter")}</Button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState icon={Refrigerator} title={t("customer.equipment.empty")} action={writer ? <ButtonLink href={sites.length ? "/client/equipements/nouveau" : "/client/sites/nouveau"}>{sites.length ? t("customer.equipment.new") : t("customer.sites.new")}</ButtonLink> : null}>
          {sites.length ? t("customer.equipment.emptyBody") : t("customer.equipment.noSite")}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((e) => (
            <li key={e.id} className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/client/equipements/${e.id}`} className="font-semibold text-ink hover:text-brand hover:underline">{e.label}</Link>
                {e.archivedAt ? <Badge>{t("customer.assets.archived")}</Badge> : e.openRequests ? <Badge tone="info">{t("customer.equipment.openRequests", { count: e.openRequests })}</Badge> : null}
              </div>
              <p className="text-sm text-muted">{e.category.labelFr} · {e.site.name}</p>
              <p className="mt-2 text-sm text-ink-soft">{[e.brand, e.model].filter(Boolean).join(" · ") || t("common.notProvided")}</p>
              <p className="mt-auto pt-3 text-xs text-muted">{e.lastServiceAt ? t("customer.equipment.lastService", { date: formatDate(e.lastServiceAt) }) : t("customer.equipment.noService")}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => { const p = new URLSearchParams(params); p.set("page", String(n)); return `/client/equipements?${p}`; }} />
    </>
  );
}
