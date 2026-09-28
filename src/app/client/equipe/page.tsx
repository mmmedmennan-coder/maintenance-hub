import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { listMembers } from "@/server/modules/organizations";
import { TeamView } from "@/components/domain/team-view";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("team.title") };

export default async function CustomerTeamPage() {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const data = await listMembers(actor);
  return (
    <>
      <PageHeader title={t("team.title")} description={t("team.customerIntro")} />
      <TeamView actor={actor} data={data} />
    </>
  );
}
