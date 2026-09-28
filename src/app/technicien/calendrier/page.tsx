import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { getCalendar } from "@/server/modules/technicians";
import { WeekCalendar, weekStart } from "@/components/domain/week-calendar";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("calendar.title") };

export default async function TechnicianCalendarPage({ searchParams }: { searchParams: Promise<{ semaine?: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["technician"] });
  const week = weekStart((await searchParams).semaine);
  const data = await withActor(actor, (tx) => getCalendar(tx, actor, week));
  return (
    <>
      <PageHeader title={t("calendar.title")} description={t("calendar.technicianIntro")} />
      <WeekCalendar data={data} week={week} basePath="/technicien/calendrier" bookingBase="/technicien/interventions" />
    </>
  );
}
