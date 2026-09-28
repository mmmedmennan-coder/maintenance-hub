import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getBookingDetail } from "@/server/modules/bookings";
import { listPayments } from "@/server/modules/payments";
import { listTechnicians } from "@/server/modules/technicians";
import { BookingView } from "@/components/domain/booking-view";

export const metadata: Metadata = { title: t("booking.titleSingle") };

export default async function ProviderBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withActor(actor, async (tx) => {
    const detail = await getBookingDetail(tx, actor, id);
    const [payments, technicians] = await Promise.all([listPayments(tx, actor, id), listTechnicians(tx, actor)]);
    return { detail, payments, technicians };
  }).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <BookingView
      detail={data.detail}
      payments={data.payments}
      technicians={data.technicians.map((tech) => ({ id: tech.id, displayName: tech.displayName, active: tech.active, skilled: false, skillIds: tech.skills.map((s) => s.equipmentCategoryId) }))}
      perspective="provider"
      actor={actor}
      back={{ href: "/prestataire/rendez-vous", label: t("booking.listTitle") }}
    />
  );
}
