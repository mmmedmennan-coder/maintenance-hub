import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { formatDateTime, localDateString, minutesToLabel } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listMembers } from "@/server/modules/organizations";
import { listEquipmentCategories } from "@/server/modules/reference";
import { listTechnicians } from "@/server/modules/technicians";
import { AvailabilityForm, DeleteResourceButton, TechnicianForm, TimeOffForm } from "@/features/technician-forms";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("technicians.title") };

export default async function TechniciansPage() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const [{ technicians, categories }, members] = await Promise.all([
    withActor(actor, async (tx) => ({ technicians: await listTechnicians(tx, actor), categories: await listEquipmentCategories(tx) })),
    listMembers(actor),
  ]);
  const manager = can.providerManage(actor);
  const techMembers = members.members.filter((m) => m.role === "technician").map((m) => ({ userId: m.userId, name: m.name }));
  const cats = categories.map((c) => ({ id: c.id, labelFr: c.labelFr }));
  const today = localDateString(new Date());
  return (
    <>
      <PageHeader title={t("technicians.title")} description={t("technicians.intro")} />
      <div className="space-y-6">
        {technicians.map((tech) => (
          <Card key={tech.id} id={`tech-${tech.id}`}>
            <CardHeader
              title={tech.displayName}
              description={tech.skills.map((s) => s.equipmentCategory.labelFr).join(" · ") || t("technicians.noSkills")}
              actions={
                <>
                  {tech.active ? <Badge tone="success">{t("technicians.activeBadge")}</Badge> : <Badge>{t("technicians.inactiveBadge")}</Badge>}
                  {tech.userId ? <Badge tone="info">{t("technicians.hasAccount")}</Badge> : null}
                </>
              }
            />
            <CardBody className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("technicians.windows")}</h3>
                {tech.windows.length === 0 ? <p className="text-sm text-warn">{t("technicians.noWindows")}</p> : null}
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {tech.windows.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                      <span>
                        {te("enums.weekday", String(w.weekday))} · {minutesToLabel(w.startMinute)}–{minutesToLabel(w.endMinute)}
                      </span>
                      {manager ? <DeleteResourceButton path={`/api/v1/provider/availability/${w.id}`} label={t("common.remove")} /> : null}
                    </li>
                  ))}
                </ul>
                {manager ? <AvailabilityForm technicianId={tech.id} /> : null}
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("technicians.timeOff")}</h3>
                {tech.timeOff.length === 0 ? <p className="text-sm text-muted">{t("technicians.noTimeOff")}</p> : null}
                <ul className="space-y-1 text-sm">
                  {tech.timeOff.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {formatDateTime(o.startsAt)} → {formatDateTime(o.endsAt)}
                        {o.reason ? <span className="block text-xs text-muted">{o.reason}</span> : null}
                      </span>
                      {manager ? <DeleteResourceButton path={`/api/v1/provider/time-off/${o.id}`} label={t("common.remove")} /> : null}
                    </li>
                  ))}
                </ul>
                {manager ? <TimeOffForm technicianId={tech.id} today={today} /> : null}
              </section>
              {manager ? (
                <details className="lg:col-span-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand">{t("technicians.edit")}</summary>
                  <div className="mt-3">
                    <TechnicianForm
                      categories={cats}
                      members={techMembers}
                      technician={{ id: tech.id, displayName: tech.displayName, phone: tech.phone, userId: tech.userId, skillIds: tech.skills.map((s) => s.equipmentCategoryId), active: tech.active }}
                    />
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>
        ))}
        {manager ? (
          <Card>
            <CardHeader title={t("technicians.new")} description={t("technicians.newIntro")} />
            <CardBody>
              <TechnicianForm categories={cats} members={techMembers} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
