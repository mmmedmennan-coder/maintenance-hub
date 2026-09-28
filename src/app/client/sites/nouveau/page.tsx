import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listServiceAreas } from "@/server/modules/reference";
import { SiteForm } from "@/features/asset-forms";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.sites.new") };

export default async function NewSitePage() {
  const actor = await guard({ orgTypes: ["CUSTOMER"], roles: ["customer_owner", "customer_manager"] });
  const areas = await withActor(actor, (tx) => listServiceAreas(tx));
  return (
    <>
      <PageHeader title={t("customer.sites.new")} description={t("customer.sites.newIntro")} back={{ href: "/client/sites", label: t("customer.sites.title") }} />
      <Card className="max-w-2xl">
        <CardBody>
          <SiteForm cities={areas.flatMap((a) => a.cities)} />
        </CardBody>
      </Card>
    </>
  );
}
