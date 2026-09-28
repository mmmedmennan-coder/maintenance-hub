import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { formatDateTime, formatWindow } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { auditAdminView } from "@/server/modules/admin";
import { eligibleProvidersForRequest } from "@/server/modules/providers";
import { type PreferredWindow, getRequestForCustomer } from "@/server/modules/requests";
import { StatusBadge } from "@/components/domain/status-badge";
import { InviteProviders } from "@/features/request-actions";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.routing.detailTitle") };

export default async function AdminRoutingDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withActor(actor, async (tx) => {
    const detail = await getRequestForCustomer(tx, actor, id);
    await auditAdminView(tx, actor, "service_request", id);
    const eligible = detail.request.status === "OPEN" ? await eligibleProvidersForRequest(tx, detail.request.equipmentCategoryId, detail.request.serviceAreaId) : [];
    const customer = await tx.organization.findUnique({ where: { id: detail.request.customerOrgId }, select: { name: true } });
    return { ...detail, eligible, customerName: customer?.name ?? "—" };
  }).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { request, providers } = data;
  const invited = new Set(request.invitations.map((i) => i.providerOrgId));
  const active = request.invitations.filter((i) => ["INVITED", "OFFERED"].includes(i.status));
  return (
    <>
      <PageHeader
        title={`${request.reference} · ${request.title}`}
        back={{ href: "/admin/routage", label: t("admin.routing.title") }}
        meta={
          <>
            <StatusBadge domain="request" status={request.status} />
            <Badge tone={request.kind === "BREAKDOWN" ? "danger" : "neutral"}>{te("enums.requestKind", request.kind)}</Badge>
          </>
        }
      />
      <Alert tone="info" className="mb-6">{t("admin.routing.rule")}</Alert>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={t("admin.routing.pickTitle")} description={t("admin.routing.pickIntro")} />
          <CardBody>
            {request.status === "OPEN" ? (
              <InviteProviders
                requestId={request.id}
                endpoint="admin"
                remaining={3 - active.length}
                providers={data.eligible
                  .filter((p) => !invited.has(p.providerOrgId))
                  .map((p) => ({ providerOrgId: p.providerOrgId, displayName: p.displayName, summary: p.summary, city: p.city, isDemo: p.isDemo, checks: p.checks.map((c) => c.type), slug: p.slug }))}
              />
            ) : (
              <p className="text-sm text-muted">{t("admin.routing.notOpen")}</p>
            )}
            {request.invitations.length ? (
              <ul className="mt-6 divide-y divide-line border-t border-line text-sm">
                {request.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {providers.get(i.providerOrgId)?.displayName ?? "—"}
                      <span className="block text-xs text-muted">{formatDateTime(i.createdAt)}{i.declineReason ? ` · ${i.declineReason}` : ""}</span>
                    </span>
                    <StatusBadge domain="invitation" status={i.status} />
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("customer.requestDetail.summary")} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("booking.customer"), value: data.customerName },
                { label: t("booking.category"), value: request.equipmentCategory.labelFr },
                { label: t("booking.equipment"), value: [request.equipment.label, request.equipment.brand, request.equipment.model].filter(Boolean).join(" · ") },
                { label: t("booking.site"), value: `${request.site.name} — ${request.site.city}` },
                { label: t("admin.routing.area"), value: request.serviceArea?.name ?? t("customer.sites.outsideArea") },
                { label: t("booking.symptoms"), value: request.symptoms },
                { label: t("providerInvitations.windows"), value: (request.preferredWindows as PreferredWindow[]).map((w) => formatWindow(w.start, w.end)).join("\n") },
                { label: t("admin.routing.submitted"), value: formatDateTime(request.submittedAt) },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
