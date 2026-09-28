import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { auditAdminView } from "@/server/modules/admin";
import { getBookingDetail } from "@/server/modules/bookings";
import { listPayments } from "@/server/modules/payments";
import { BookingView } from "@/components/domain/booking-view";
import { StatusBadge } from "@/components/domain/status-badge";
import { DisputeAdminActions } from "@/features/admin-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: t("admin.disputes.detailTitle") };

/** Dispute review: the full job record (read-only for the platform) plus mediation actions. */
export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withActor(actor, async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { id } });
    if (!dispute) throw new DomainError("NOT_FOUND", "Litige introuvable.");
    await auditAdminView(tx, actor, "dispute", id);
    const detail = await getBookingDetail(tx, actor, dispute.bookingId);
    const payments = await listPayments(tx, actor, dispute.bookingId);
    return { dispute, detail, payments };
  }).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <BookingView
      detail={data.detail}
      payments={data.payments}
      technicians={null}
      perspective="admin"
      actor={actor}
      back={{ href: "/admin/litiges", label: t("admin.disputes.title") }}
      adminSlot={
        <Card className="mb-6 border-danger-line">
          <CardHeader title={t("admin.disputes.mediation")} description={t("admin.disputes.mediationIntro")} actions={<StatusBadge domain="dispute" status={data.dispute.status} />} />
          <CardBody className="space-y-3">
            <p className="whitespace-pre-line text-sm">{data.dispute.reason}</p>
            <DisputeAdminActions disputeId={data.dispute.id} status={data.dispute.status} />
          </CardBody>
        </Card>
      }
    />
  );
}
