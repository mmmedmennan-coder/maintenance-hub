"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { maintenancePlanSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionDialog, useAction } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type Action = "CONSENT" | "DECLINE" | "PAUSE" | "RESUME" | "END";

/** Plan lifecycle buttons; recurring work never starts without the customer's consent. */
export function PlanDecisionButtons({ planId, status, side }: { planId: string; status: string; side: "CUSTOMER" | "PROVIDER" }) {
  const actions: Action[] = [];
  if (status === "PROPOSED" && side === "CUSTOMER") actions.push("CONSENT", "DECLINE");
  if (status === "ACTIVE") actions.push("PAUSE");
  if (status === "PAUSED" && side === "CUSTOMER") actions.push("RESUME");
  // A customer answers a proposal with consent/decline; the provider may withdraw it (END).
  if (status === "ACTIVE" || status === "PAUSED" || (status === "PROPOSED" && side === "PROVIDER")) actions.push("END");
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <ActionDialog
          key={a}
          triggerLabel={t(`plans.actions.${a}`)}
          triggerVariant={a === "CONSENT" || a === "RESUME" ? "primary" : a === "END" || a === "DECLINE" ? "ghost" : "secondary"}
          triggerSize="sm"
          title={t(`plans.actions.${a}`)}
          description={t(`plans.confirm.${a}`)}
          confirmLabel={t(`plans.actions.${a}`)}
          confirmVariant={a === "END" || a === "DECLINE" ? "danger" : "primary"}
          reason={{ label: t("plans.note"), required: a === "END" || a === "DECLINE" }}
          onConfirm={(note) => api(`/api/v1/maintenance-plans/${planId}`, { body: { action: a, note: note || null } })}
        />
      ))}
    </div>
  );
}

type Values = z.input<typeof maintenancePlanSchema>;

export function ProposePlanForm({ equipment, defaultEquipmentId, minDate }: { equipment: { id: string; label: string; siteName: string; city: string }[]; defaultEquipmentId?: string; minDate: string }) {
  const { run, error } = useAction();
  const form = useForm<Values>({
    resolver: zodResolver(maintenancePlanSchema, undefined, { raw: true }),
    defaultValues: {
      equipmentId: equipment.some((e) => e.id === defaultEquipmentId) ? defaultEquipmentId : (equipment[0]?.id ?? ""),
      title: "",
      scope: "",
      intervalMonths: 3,
      reminderLeadDays: 14,
      firstDueDate: minDate,
    },
  });
  const { errors, isSubmitting } = form.formState;
  if (equipment.length === 0) return <p className="text-sm text-muted">{t("plans.noEquipment")}</p>;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        const ok = await run(() => api("/api/v1/maintenance-plans", { body: values }));
        if (ok !== undefined) form.reset({ ...values, title: "", scope: "" });
      })}
    >
      <Field label={t("plans.equipment")} error={errors.equipmentId?.message} required>
        <Select {...form.register("equipmentId")}>
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label} — {e.siteName}, {e.city}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("plans.titleLabel")} error={errors.title?.message} required>
        <Input {...form.register("title")} placeholder={t("plans.titlePlaceholder")} />
      </Field>
      <Field label={t("plans.scope")} error={errors.scope?.message} required hint={t("plans.scopeHint")}>
        <Textarea rows={3} {...form.register("scope")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("plans.interval")} error={errors.intervalMonths?.message} required>
          <Input type="number" inputMode="numeric" min={1} max={60} {...form.register("intervalMonths")} />
        </Field>
        <Field label={t("plans.firstDue")} error={errors.firstDueDate?.message} required>
          <Input type="date" min={minDate} {...form.register("firstDueDate")} />
        </Field>
        <Field label={t("plans.leadDays")} error={errors.reminderLeadDays?.message} hint={t("plans.leadDaysHint")}>
          <Input type="number" inputMode="numeric" min={0} max={90} {...form.register("reminderLeadDays")} />
        </Field>
      </div>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting}>
        {t("plans.propose")}
      </Button>
    </form>
  );
}
