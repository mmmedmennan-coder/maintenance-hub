import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getBookingDetail } from "@/server/modules/bookings";
import { BookingView } from "@/components/domain/booking-view";

export const metadata: Metadata = { title: t("technician.jobTitle") };

/** Assigned technician's job view (RLS only returns bookings assigned to this technician). */
export default async function TechnicianJobPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["technician"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await withActor(actor, (tx) => getBookingDetail(tx, actor, id)).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return <BookingView detail={detail} payments={null} technicians={null} perspective="technician" actor={actor} back={{ href: "/technicien", label: t("technician.title") }} />;
}
