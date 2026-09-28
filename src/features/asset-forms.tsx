"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { equipmentSchema, siteSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type SiteValues = z.input<typeof siteSchema>;

export function SiteForm({ site, cities }: { site?: SiteValues & { id: string; version: number }; cities: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<SiteValues>({ resolver: zodResolver(siteSchema), defaultValues: site ?? { city: "Rabat" } });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        setSaved(false);
        try {
          if (site) {
            await api(`/api/v1/sites/${site.id}`, { method: "PATCH", body: { ...values, version: site.version } });
            setSaved(true);
            router.refresh();
          } else {
            const created = await api<{ id: string }>("/api/v1/sites", { body: values });
            router.push(`/client/sites/${created.id}`);
          }
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <Field label={t("customer.sites.name")} error={errors.name?.message} required>
        <Input {...form.register("name")} placeholder={t("customer.sites.namePlaceholder")} />
      </Field>
      <Field label={t("customer.sites.address")} error={errors.addressLine?.message} required>
        <Input autoComplete="street-address" {...form.register("addressLine")} />
      </Field>
      <Field label={t("customer.sites.city")} hint={t("customer.sites.cityHint")} error={errors.city?.message} required>
        <Input list="service-cities" autoComplete="address-level2" {...form.register("city")} />
      </Field>
      <datalist id="service-cities">
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Field label={t("customer.sites.accessNotes")} hint={t("customer.sites.accessNotesHint")} error={errors.accessNotes?.message}>
        <Textarea rows={3} {...form.register("accessNotes")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("customer.sites.contactName")} error={errors.contactName?.message}>
          <Input autoComplete="name" {...form.register("contactName")} />
        </Field>
        <Field label={t("customer.sites.contactPhone")} error={errors.contactPhone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register("contactPhone")} />
        </Field>
      </div>
      <FormError error={error} />
      {saved ? <Alert tone="success" live>{t("common.saved")}</Alert> : null}
      <Button type="submit" loading={isSubmitting}>
        {site ? t("common.save") : t("customer.sites.create")}
      </Button>
    </form>
  );
}

type EquipmentValues = z.input<typeof equipmentSchema>;

export function EquipmentForm({
  equipment,
  sites,
  categories,
  defaultSiteId,
}: {
  equipment?: EquipmentValues & { id: string; version: number };
  sites: { id: string; name: string }[];
  categories: { id: string; labelFr: string }[];
  defaultSiteId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<EquipmentValues>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: equipment ?? { siteId: defaultSiteId ?? sites[0]?.id, categoryId: categories[0]?.id },
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        setSaved(false);
        try {
          if (equipment) {
            const { siteId: _siteId, ...rest } = values;
            await api(`/api/v1/equipment/${equipment.id}`, { method: "PATCH", body: { ...rest, version: equipment.version } });
            setSaved(true);
            router.refresh();
          } else {
            const created = await api<{ id: string }>("/api/v1/equipment", { body: values });
            router.push(`/client/equipements/${created.id}`);
          }
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("customer.equipment.site")} error={errors.siteId?.message} required>
          <Select disabled={!!equipment} {...form.register("siteId")}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("customer.equipment.category")} error={errors.categoryId?.message} required>
          <Select {...form.register("categoryId")}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelFr}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("customer.equipment.label")} hint={t("customer.equipment.labelHint")} error={errors.label?.message} required>
        <Input {...form.register("label")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("customer.equipment.brand")} error={errors.brand?.message}>
          <Input {...form.register("brand")} />
        </Field>
        <Field label={t("customer.equipment.model")} error={errors.model?.message}>
          <Input {...form.register("model")} />
        </Field>
        <Field label={t("customer.equipment.serial")} hint={t("customer.equipment.serialHint")} error={errors.serialNumber?.message}>
          <Input {...form.register("serialNumber")} />
        </Field>
        <Field label={t("customer.equipment.installedYear")} error={errors.installedYear?.message as string | undefined}>
          <Input inputMode="numeric" {...form.register("installedYear")} />
        </Field>
      </div>
      <Field label={t("customer.equipment.notes")} error={errors.notes?.message}>
        <Textarea rows={3} {...form.register("notes")} />
      </Field>
      <FormError error={error} />
      {saved ? <Alert tone="success" live>{t("common.saved")}</Alert> : null}
      <Button type="submit" loading={isSubmitting}>
        {equipment ? t("common.save") : t("customer.equipment.create")}
      </Button>
    </form>
  );
}
