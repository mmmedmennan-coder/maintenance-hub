"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { minorToInput } from "@/lib/money";
import { categorySchema, providerCheckSchema, serviceAreaSchema, subscriptionPeriodSchema, subscriptionPlanSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, useAction } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { HoursEditor, hoursToState, stateToHours } from "./provider-profile-form";

// --- Provider review ------------------------------------------------------------------------------

type ReviewDecision = "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE";

export function ProviderReviewActions({ profileId, status }: { profileId: string; status: string }) {
  const decisions: ReviewDecision[] =
    status === "SUBMITTED" ? ["APPROVE", "REJECT"] : status === "REJECTED" ? ["APPROVE"] : status === "APPROVED" ? ["SUSPEND"] : status === "SUSPENDED" ? ["REINSTATE"] : [];
  if (decisions.length === 0) return <p className="text-sm text-muted">{t("admin.providers.noDecision")}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {decisions.map((d) => (
        <ActionDialog
          key={d}
          triggerLabel={t(`admin.providers.decision.${d}`)}
          triggerVariant={d === "APPROVE" || d === "REINSTATE" ? "primary" : "danger"}
          title={t(`admin.providers.decision.${d}`)}
          description={t(`admin.providers.decisionBody.${d}`)}
          confirmLabel={t(`admin.providers.decision.${d}`)}
          confirmVariant={d === "APPROVE" || d === "REINSTATE" ? "primary" : "danger"}
          reason={{ label: t("admin.reason"), required: true, hint: t("admin.providers.reasonHint") }}
          onConfirm={(reason) => api(`/api/v1/admin/providers/${profileId}/review`, { body: { decision: d, reason } })}
        />
      ))}
    </div>
  );
}

type CheckValues = z.input<typeof providerCheckSchema>;
const CHECK_TYPES = ["BUSINESS_IDENTITY", "TECHNICAL_EXPERIENCE", "REFERENCES", "INSURANCE", "QUALIFICATION"] as const;
const CHECK_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "EXPIRED"] as const;

/** Records one platform check. Each badge states exactly what was checked; nothing is implied. */
export function ProviderCheckForm({ profileId }: { profileId: string }) {
  const [saved, setSaved] = useState(false);
  const { run, error } = useAction();
  const form = useForm<CheckValues>({ resolver: zodResolver(providerCheckSchema, undefined, { raw: true }), defaultValues: { type: "BUSINESS_IDENTITY", status: "VERIFIED", publicNote: "", internalNote: "", expiresAt: null } });
  const { errors, isSubmitting } = form.formState;
  const type = form.watch("type");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setSaved(false);
        const ok = await run(() => api(`/api/v1/admin/providers/${profileId}/checks`, { body: values }));
        if (ok !== undefined) setSaved(true);
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.checks.type")} error={errors.type?.message} hint={te("enums.checkMeaning", type)}>
          <Select {...form.register("type")}>
            {CHECK_TYPES.map((c) => (
              <option key={c} value={c}>
                {te("enums.checkType", c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.checks.status")} error={errors.status?.message}>
          <Select {...form.register("status")}>
            {CHECK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te("status.check", s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("admin.checks.publicNote")} hint={t("admin.checks.publicNoteHint")} error={errors.publicNote?.message}>
        <Input {...form.register("publicNote")} />
      </Field>
      <Field label={t("admin.checks.internalNote")} hint={t("admin.checks.internalNoteHint")} error={errors.internalNote?.message}>
        <Textarea rows={2} {...form.register("internalNote")} />
      </Field>
      <Field label={t("admin.checks.expiresAt")} error={errors.expiresAt?.message}>
        <Input type="date" {...form.register("expiresAt", { setValueAs: (v) => (v ? v : null) })} className="sm:max-w-xs" />
      </Field>
      <FormError error={error} />
      {saved ? (
        <Alert tone="success" live>
          {t("common.saved")}
        </Alert>
      ) : null}
      <Button type="submit" loading={isSubmitting}>
        {t("admin.checks.record")}
      </Button>
    </form>
  );
}

// --- Disputes, reviews, support -------------------------------------------------------------------

export function DisputeAdminActions({ disputeId, status }: { disputeId: string; status: string }) {
  const call = (action: "UNDER_REVIEW" | "COMMENT" | "RESOLVE", body: string) => api(`/api/v1/admin/disputes/${disputeId}`, { body: { action, body } });
  if (!["OPEN", "UNDER_REVIEW"].includes(status)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "OPEN" ? (
        <ActionDialog
          triggerLabel={t("admin.disputes.startReview")}
          title={t("admin.disputes.startReview")}
          confirmLabel={t("common.confirm")}
          reason={{ label: t("admin.disputes.messageToParties"), required: true }}
          onConfirm={(body) => call("UNDER_REVIEW", body)}
        />
      ) : null}
      <ActionDialog
        triggerLabel={t("admin.disputes.resolve")}
        triggerVariant="primary"
        title={t("admin.disputes.resolve")}
        description={t("admin.disputes.resolveBody")}
        confirmLabel={t("admin.disputes.resolve")}
        reason={{ label: t("admin.disputes.resolution"), required: true }}
        onConfirm={(body) => call("RESOLVE", body)}
      />
    </div>
  );
}

export function ReviewModerationButtons({ reviewId }: { reviewId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton size="sm" onRun={() => api(`/api/v1/admin/reviews/${reviewId}`, { body: { decision: "PUBLISH", note: null } })}>
        {t("admin.reviews.publish")}
      </ActionButton>
      <ActionDialog
        triggerLabel={t("admin.reviews.reject")}
        triggerSize="sm"
        title={t("admin.reviews.reject")}
        description={t("admin.reviews.rejectBody")}
        confirmLabel={t("admin.reviews.reject")}
        confirmVariant="danger"
        reason={{ label: t("admin.reason"), required: true }}
        onConfirm={(note) => api(`/api/v1/admin/reviews/${reviewId}`, { body: { decision: "REJECT", note } })}
      />
    </div>
  );
}

export function HideResponseButton({ reviewId }: { reviewId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("admin.reviews.hideResponse")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("admin.reviews.hideResponse")}
      confirmLabel={t("admin.reviews.hideResponse")}
      confirmVariant="danger"
      reason={{ label: t("admin.reason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/admin/reviews/${reviewId}/hide-response`, { body: { reason } })}
    />
  );
}

export function SupportHandledButton({ id }: { id: string }) {
  return (
    <ActionButton size="sm" variant="secondary" onRun={() => api(`/api/v1/admin/support/${id}`, { method: "POST", body: {} })}>
      {t("admin.support.markHandled")}
    </ActionButton>
  );
}

// --- Subscriptions ---------------------------------------------------------------------------------

type PeriodValues = z.input<typeof subscriptionPeriodSchema>;

/** Records a manually collected pilot period (no payment is processed by the platform). */
export function SubscriptionPeriodForm({ providerOrgId, defaults }: { providerOrgId: string; defaults: { periodStart: string; periodEnd: string; amount: number } }) {
  const { run, error } = useAction();
  const form = useForm<PeriodValues>({
    resolver: zodResolver(subscriptionPeriodSchema, undefined, { raw: true }),
    defaultValues: { periodStart: defaults.periodStart, periodEnd: defaults.periodEnd, amount: minorToInput(defaults.amount), reference: "", reason: "" },
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((values) => run(() => api(`/api/v1/admin/subscriptions/${providerOrgId}/periods`, { body: values })))}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t("admin.subscriptions.periodStart")} error={errors.periodStart?.message}>
          <Input type="date" {...form.register("periodStart")} />
        </Field>
        <Field label={t("admin.subscriptions.periodEnd")} error={errors.periodEnd?.message}>
          <Input type="date" {...form.register("periodEnd")} />
        </Field>
        <Field label={t("admin.subscriptions.amount")} error={errors.amount?.message}>
          <Input inputMode="decimal" {...form.register("amount")} />
        </Field>
        <Field label={t("admin.subscriptions.reference")} error={errors.reference?.message}>
          <Input {...form.register("reference")} />
        </Field>
      </div>
      <Field label={t("admin.reason")} error={errors.reason?.message} required>
        <Input {...form.register("reason")} placeholder={t("admin.subscriptions.reasonPlaceholder")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" size="sm" loading={isSubmitting}>
        {t("admin.subscriptions.record")}
      </Button>
    </form>
  );
}

export function SubscriptionCorrectionButton({ providerOrgId, paidUntil }: { providerOrgId: string; paidUntil: string | null }) {
  const [value, setValue] = useState(paidUntil ?? "");
  return (
    <ActionDialog
      triggerLabel={t("admin.subscriptions.correct")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("admin.subscriptions.correct")}
      description={t("admin.subscriptions.correctBody")}
      confirmLabel={t("common.save")}
      reason={{ label: t("admin.reason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/admin/subscriptions/${providerOrgId}/correction`, { body: { paidUntil: value || null, reason } })}
    >
      <Field label={t("admin.subscriptions.paidUntil")} hint={t("admin.subscriptions.emptyMeansNone")}>
        <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

type PlanValues = z.input<typeof subscriptionPlanSchema>;

export function PlanEditForm({ plan }: { plan: { id: string; name: string; priceMinor: number; maxStaff: number; taxNote: string; active: boolean } }) {
  const [saved, setSaved] = useState(false);
  const { run, error } = useAction();
  const form = useForm<PlanValues>({
    resolver: zodResolver(subscriptionPlanSchema, undefined, { raw: true }),
    defaultValues: { name: plan.name, price: minorToInput(plan.priceMinor), maxStaff: plan.maxStaff, taxNote: plan.taxNote, active: plan.active, reason: "" },
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={form.handleSubmit(async (values) => {
        setSaved(false);
        const ok = await run(() => api(`/api/v1/admin/plans/${plan.id}`, { method: "PATCH", body: values }));
        if (ok !== undefined) setSaved(true);
      })}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("admin.subscriptions.planName")} error={errors.name?.message}>
          <Input {...form.register("name")} />
        </Field>
        <Field label={t("admin.subscriptions.planPrice")} error={errors.price?.message}>
          <Input inputMode="decimal" {...form.register("price")} />
        </Field>
        <Field label={t("admin.subscriptions.planStaff")} error={errors.maxStaff?.message}>
          <Input type="number" min={1} {...form.register("maxStaff")} />
        </Field>
      </div>
      <Field label={t("subscription.taxNote")} error={errors.taxNote?.message}>
        <Input {...form.register("taxNote")} />
      </Field>
      <Checkbox label={t("admin.active")} {...form.register("active")} />
      <Field label={t("admin.reason")} error={errors.reason?.message} required>
        <Input {...form.register("reason")} />
      </Field>
      <FormError error={error} />
      {saved ? (
        <Alert tone="success" live>
          {t("common.saved")}
        </Alert>
      ) : null}
      <Button type="submit" size="sm" loading={isSubmitting}>
        {t("common.save")}
      </Button>
    </form>
  );
}

// --- Reference data ---------------------------------------------------------------------------------

type CategoryValues = z.input<typeof categorySchema>;

export function CategoryForm({ category }: { category?: { id: string; labelFr: string; code: string; active: boolean; sortOrder: number } }) {
  const [saved, setSaved] = useState(false);
  const { run, error } = useAction();
  const form = useForm<CategoryValues>({ resolver: zodResolver(categorySchema, undefined, { raw: true }), defaultValues: category ?? { labelFr: "", code: "", active: true, sortOrder: 100 } });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={form.handleSubmit(async (values) => {
        setSaved(false);
        const ok = await run(() => (category ? api(`/api/v1/admin/categories/${category.id}`, { method: "PATCH", body: values }) : api("/api/v1/admin/categories", { body: values })));
        if (ok !== undefined) {
          setSaved(true);
          if (!category) form.reset();
        }
      })}
    >
      <Field label={t("admin.reference.label")} error={errors.labelFr?.message} className="min-w-52 flex-1">
        <Input {...form.register("labelFr")} />
      </Field>
      <Field label={t("admin.reference.code")} error={errors.code?.message} className="w-44">
        <Input {...form.register("code")} />
      </Field>
      <Field label={t("admin.reference.order")} error={errors.sortOrder?.message} className="w-24">
        <Input type="number" {...form.register("sortOrder")} />
      </Field>
      <Checkbox label={t("admin.active")} {...form.register("active")} />
      <Button type="submit" size="sm" variant={category ? "secondary" : "primary"} loading={isSubmitting}>
        {category ? t("common.save") : t("common.add")}
      </Button>
      {saved ? <span className="text-sm text-success">{t("common.savedTitle")}</span> : null}
      <FormError error={error} />
    </form>
  );
}

type AreaValues = z.input<typeof serviceAreaSchema>;

export function ServiceAreaForm({ area }: { area?: { id: string; name: string; code: string; cities: string[]; routingHours: Record<string, [number, number]>; active: boolean } }) {
  const [saved, setSaved] = useState(false);
  const [cities, setCities] = useState((area?.cities ?? []).join(", "));
  const [hours, setHours] = useState(() => hoursToState(area?.routingHours ?? {}));
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, error } = useAction();
  const form = useForm<Omit<AreaValues, "cities" | "routingHours">>({ defaultValues: { name: area?.name ?? "", code: area?.code ?? "", active: area?.active ?? true } });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setSaved(false);
        setLocalError(null);
        const { hours: routingHours, invalidDay } = stateToHours(hours);
        if (invalidDay) return setLocalError(t("hours.invalid", { day: te("enums.weekday", invalidDay) }));
        const body = { ...values, cities: cities.split(",").map((c) => c.trim()).filter(Boolean), routingHours };
        const parsed = serviceAreaSchema.safeParse(body);
        if (!parsed.success) return setLocalError(parsed.error.issues[0]?.message ?? t("errors.generic"));
        const ok = await run(() => (area ? api(`/api/v1/admin/service-areas/${area.id}`, { method: "PATCH", body }) : api("/api/v1/admin/service-areas", { body })));
        if (ok !== undefined) setSaved(true);
      })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.reference.areaName")}>
          <Input {...form.register("name")} />
        </Field>
        <Field label={t("admin.reference.code")}>
          <Input {...form.register("code")} />
        </Field>
      </div>
      <Field label={t("admin.reference.cities")} hint={t("admin.reference.citiesHint")}>
        <Input value={cities} onChange={(e) => setCities(e.target.value)} />
      </Field>
      <HoursEditor legend={t("admin.reference.routingHours")} value={hours} onChange={setHours} />
      <Checkbox label={t("admin.active")} {...form.register("active")} />
      <FormError error={localError ?? error} />
      {saved ? (
        <Alert tone="success" live>
          {t("common.saved")}
        </Alert>
      ) : null}
      <Button type="submit" size="sm" loading={form.formState.isSubmitting}>
        {area ? t("common.save") : t("common.add")}
      </Button>
    </form>
  );
}
