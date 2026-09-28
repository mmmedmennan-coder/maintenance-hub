import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { addDaysToDateString, localDateString, minutesToLabel } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listEquipment } from "@/server/modules/assets";
import { listServiceAreas } from "@/server/modules/reference";
import { RequestWizard } from "@/features/request-wizard";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.requests.new") };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ equipement?: string; prestataire?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"], roles: ["customer_owner", "customer_manager"] });
  const sp = await searchParams;
  const [equipment, areas] = await withActor(actor, async (tx) => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const res = await listEquipment(tx, actor, { page });
      all.push(...res.items);
      if (all.length >= res.total) break;
    }
    return [all, await listServiceAreas(tx)] as const;
  });
  const hours = (areas[0]?.routingHours ?? {}) as Record<string, [number, number]>;
  const routingHoursLabel = Object.entries(hours)
    .map(([d, [a, b]]) => `${te("enums.weekdayShort", d)} ${minutesToLabel(a)}–${minutesToLabel(b)}`)
    .join(", ");
  return (
    <>
      <PageHeader title={t("customer.requests.new")} description={t("customer.wizard.intro")} back={{ href: "/client/demandes", label: t("customer.requests.title") }} />
      {equipment.length === 0 ? (
        <EmptyState title={t("customer.equipment.empty")} action={<ButtonLink href="/client/equipements/nouveau">{t("customer.equipment.new")}</ButtonLink>}>
          {t("customer.wizard.needEquipment")}
        </EmptyState>
      ) : (
        <Card className="max-w-3xl">
          <CardBody className="p-5 sm:p-6">
            <RequestWizard
              equipment={equipment.map((e) => ({ id: e.id, label: e.label, siteName: e.site.name, category: e.category.labelFr }))}
              defaultEquipmentId={equipment.find((e) => e.id === sp.equipement)?.id}
              providerOrgId={sp.prestataire && /^[0-9a-f-]{36}$/.test(sp.prestataire) ? sp.prestataire : undefined}
              routingHoursLabel={routingHoursLabel || "—"}
              tomorrow={addDaysToDateString(localDateString(new Date()), 1)}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
