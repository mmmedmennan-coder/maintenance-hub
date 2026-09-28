import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listEquipmentCategories, listServiceAreas } from "@/server/modules/reference";
import { CategoryForm, ServiceAreaForm } from "@/features/admin-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.reference.title") };

export default async function AdminReferencePage() {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const [categories, areas] = await withActor(actor, (tx) => Promise.all([listEquipmentCategories(tx, { includeInactive: true }), listServiceAreas(tx, { includeInactive: true })]));
  return (
    <>
      <PageHeader title={t("admin.reference.title")} description={t("admin.reference.intro")} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.reference.categories")} description={t("admin.reference.categoriesIntro")} />
          <CardBody className="space-y-4">
            <ul className="space-y-3">
              {categories.map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-3">
                  <CategoryForm category={{ id: c.id, labelFr: c.labelFr, code: c.code, active: c.active, sortOrder: c.sortOrder }} />
                </li>
              ))}
            </ul>
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">{t("admin.reference.newCategory")}</p>
              <CategoryForm />
            </div>
          </CardBody>
        </Card>
        <div className="space-y-6">
          {areas.map((a) => (
            <Card key={a.id}>
              <CardHeader title={a.name} description={a.code} actions={a.active ? <Badge tone="success">{t("admin.active")}</Badge> : <Badge>{t("admin.inactive")}</Badge>} />
              <CardBody>
                <ServiceAreaForm area={{ id: a.id, name: a.name, code: a.code, cities: a.cities, routingHours: a.routingHours as Record<string, [number, number]>, active: a.active }} />
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardHeader title={t("admin.reference.newArea")} />
            <CardBody>
              <ServiceAreaForm />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
