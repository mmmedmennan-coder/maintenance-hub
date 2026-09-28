import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listSites } from "@/server/modules/assets";
import { listEquipmentCategories } from "@/server/modules/reference";
import { EquipmentForm } from "@/features/asset-forms";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.equipment.new") };

export default async function NewEquipmentPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"], roles: ["customer_owner", "customer_manager"] });
  const { site } = await searchParams;
  const [sites, categories] = await withActor(actor, (tx) => Promise.all([listSites(tx, actor), listEquipmentCategories(tx)]));
  return (
    <>
      <PageHeader title={t("customer.equipment.new")} description={t("customer.equipment.newIntro")} back={{ href: "/client/equipements", label: t("customer.equipment.title") }} />
      {sites.length === 0 ? (
        <EmptyState title={t("customer.equipment.noSite")} action={<ButtonLink href="/client/sites/nouveau">{t("customer.sites.new")}</ButtonLink>} />
      ) : (
        <Card className="max-w-2xl">
          <CardBody>
            <EquipmentForm sites={sites} categories={categories} defaultSiteId={sites.find((s) => s.id === site)?.id} />
          </CardBody>
        </Card>
      )}
    </>
  );
}
