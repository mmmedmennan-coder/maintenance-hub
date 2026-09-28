import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listBookings } from "@/server/modules/bookings";
import { BOOKING_TABS, BookingList } from "@/components/domain/booking-list";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("booking.listTitle") };

export default async function CustomerBookingsPage({ searchParams }: { searchParams: Promise<{ statut?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const sp = await searchParams;
  const status = BOOKING_TABS.includes(sp.statut ?? "") ? (sp.statut ?? "") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => listBookings(tx, actor, { status, page }));
  return (
    <>
      <PageHeader title={t("booking.listTitle")} description={t("booking.customerIntro")} />
      <BookingList data={data} basePath="/client/rendez-vous" status={status} counterpart="provider" />
    </>
  );
}
