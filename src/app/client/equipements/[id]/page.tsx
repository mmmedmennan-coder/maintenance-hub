import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatCalendarDate, formatDate } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getEquipment, getEquipmentHistory, listSites } from "@/server/modules/assets";
import { listEquipmentCategories } from "@/server/modules/reference";
import { DocumentList } from "@/components/domain/document-list";
import { DocumentUploader } from "@/components/domain/document-uploader";
import { StatusBadge } from "@/components/domain/status-badge";
import { ArchiveToggle } from "@/features/archive-toggle";
import { EquipmentForm } from "@/features/asset-forms";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.equipment.detail") };

export default async function EquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const { id } = await params;
  const data = await withActor(actor, async (tx) => {
    const equipment = await getEquipment(tx, actor, id);
    const [history, sites, categories, docs] = await Promise.all([
      getEquipmentHistory(tx, actor, id),
      listSites(tx, actor, { includeArchived: true }),
      listEquipmentCategories(tx),
      tx.document.findMany({ where: { equipmentId: id, status: { in: ["READY", "FAILED", "PENDING"] } }, orderBy: { createdAt: "desc" } }),
    ]);
    return { equipment, history, sites, categories, docs };
  }).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { equipment: e, history } = data;
  const writer = can.customerWrite(actor);
  const active = !e.archivedAt;
  return (
    <>
      <PageHeader
        title={e.label}
        description={`${e.category.labelFr} · ${e.site.name} (${e.site.city})`}
        back={{ href: "/client/equipements", label: t("customer.equipment.title") }}
        meta={e.archivedAt ? <Badge>{t("customer.assets.archived")}</Badge> : null}
        actions={
          writer ? (
            <>
              {active ? <ButtonLink href={`/client/demandes/nouvelle?equipement=${e.id}`} icon={<Plus aria-hidden className="size-4" />}>{t("customer.requests.newForEquipment")}</ButtonLink> : null}
              <ArchiveToggle kind="equipment" id={e.id} archived={!active} />
            </>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("customer.equipment.historyTitle")} description={t("customer.equipment.historyIntro")} />
            <CardBody>
              {history.workOrders.length === 0 ? (
                <p className="text-sm text-muted">{t("customer.equipment.noService")}</p>
              ) : (
                <ol className="relative space-y-5 border-l-2 border-line pl-5">
                  {history.workOrders.map((w) => (
                    <li key={w.id} className="relative">
                      <span aria-hidden className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-surface bg-brand" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/client/rendez-vous/${w.bookingId}`} className="font-semibold text-ink hover:text-brand hover:underline">{w.reference}</Link>
                        <StatusBadge domain="workOrder" status={w.status} />
                        {w.acknowledgment ? <StatusBadge domain="ack" status={w.acknowledgment} /> : null}
                      </div>
                      <p className="text-sm text-muted">
                        {formatDate(w.booking.scheduledStart)} · {w.providerName} · {w.booking.technicianName ?? "—"}
                      </p>
                      {w.report ? (
                        <div className="mt-1 text-sm text-ink-soft">
                          <p><strong>{t("customer.equipment.findings")} :</strong> {w.report.findings}</p>
                          <p><strong>{t("customer.equipment.work")} :</strong> {w.report.workPerformed}</p>
                          {w.report.nextServiceDate ? <p className="text-muted">{t("customer.equipment.nextService", { date: formatCalendarDate(w.report.nextServiceDate) })}</p> : null}
                        </div>
                      ) : null}
                      {w.repairQuotes.flatMap((q) => q.versions).length ? (
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {w.repairQuotes.flatMap((q) => q.versions.map((v) => (
                            <li key={v.id}><Badge tone={v.status === "APPROVED" ? "success" : "neutral"}>{q.title} v{v.versionNo} · {te("status.quote", v.status)} · {formatMoney(v.totalMinor, v.currency)}</Badge></li>
                          )))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("customer.equipment.requestsTitle")} />
            <CardBody>
              {history.requests.length === 0 ? <p className="text-sm text-muted">{t("customer.requests.empty")}</p> : (
                <ul className="divide-y divide-line">
                  {history.requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/client/demandes/${r.id}`} className="text-sm font-medium hover:text-brand">{r.reference} · {r.title}</Link>
                      <StatusBadge domain="request" status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("customer.equipment.documentsTitle")} description={t("customer.equipment.documentsIntro")} />
            <CardBody className="space-y-4">
              <DocumentList docs={data.docs.map((d) => ({ ...d, canDelete: writer && d.ownerOrgId === actor.orgId }))} />
              {writer && active ? <DocumentUploader target={{ equipmentId: e.id }} kind="ATTACHMENT" label={t("customer.equipment.addDocument")} /> : null}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={writer && active ? t("customer.equipment.edit") : t("customer.equipment.detail")} />
            <CardBody>
              {writer && active ? (
                <EquipmentForm
                  sites={data.sites}
                  categories={data.categories}
                  equipment={{ id: e.id, version: e.version, siteId: e.siteId, categoryId: e.categoryId, label: e.label, brand: e.brand, model: e.model, serialNumber: e.serialNumber, installedYear: e.installedYear, notes: e.notes }}
                />
              ) : (
                <DescriptionList
                  columns={1}
                  items={[
                    { label: t("customer.equipment.brand"), value: e.brand },
                    { label: t("customer.equipment.model"), value: e.model },
                    { label: t("customer.equipment.serial"), value: e.serialNumber },
                    { label: t("customer.equipment.installedYear"), value: e.installedYear },
                    { label: t("customer.equipment.notes"), value: e.notes },
                  ]}
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("nav.plans")} />
            <CardBody>
              {history.plans.length === 0 ? <p className="text-sm text-muted">{t("customer.plans.noneForEquipment")}</p> : (
                <ul className="space-y-2">
                  {history.plans.map((p) => (
                    <li key={p.id} className="text-sm">
                      <p className="font-medium">{p.title} <StatusBadge domain="plan" status={p.status} /></p>
                      <p className="text-muted">{p.providerName} · {t("customer.plans.every", { n: p.intervalMonths })}{p.nextDueDate ? ` · ${t("customer.plans.nextDue", { date: formatCalendarDate(p.nextDueDate) })}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
