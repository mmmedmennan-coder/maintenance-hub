import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { addDaysToDateString, localDateString } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listPlans, serviceableEquipment } from "@/server/modules/maintenance";
import { PlansView } from "@/components/domain/plans-view";
import { ProposePlanForm } from "@/features/plan-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("plans.title") };

export default async function ProviderPlansPage({ searchParams }: { searchParams: Promise<{ equipement?: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const sp = await searchParams;
  const [plans, equipment] = await withActor(actor, (tx) => Promise.all([listPlans(tx, actor), serviceableEquipment(tx, actor)]));
  return (
    <>
      <PageHeader title={t("plans.title")} description={t("plans.providerIntro")} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <PlansView plans={plans} side="PROVIDER" canAct={can.providerManage(actor)} />
        <Card>
          <CardHeader title={t("plans.proposeTitle")} description={t("plans.proposeIntro")} />
          <CardBody>
            <ProposePlanForm equipment={equipment} defaultEquipmentId={sp.equipement} minDate={addDaysToDateString(localDateString(new Date()), 1)} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
