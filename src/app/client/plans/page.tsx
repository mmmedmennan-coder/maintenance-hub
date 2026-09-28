import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listPlans } from "@/server/modules/maintenance";
import { PlansView } from "@/components/domain/plans-view";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("plans.title") };

export default async function CustomerPlansPage() {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const plans = await withActor(actor, (tx) => listPlans(tx, actor));
  return (
    <>
      <PageHeader title={t("plans.title")} description={t("plans.customerIntro")} />
      <PlansView plans={plans} side="CUSTOMER" canAct={can.customerWrite(actor)} />
    </>
  );
}
