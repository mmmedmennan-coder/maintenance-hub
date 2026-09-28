"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { computeOfferTotals, formatMoney, parseMoneyInput, parseRateInput } from "@/lib/money";
import { offerDraftSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, useAction, useIdempotencyKey } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";

export type OfferValues = z.input<typeof offerDraftSchema>;

/**
 * Offer editor for one invitation. A diagnostic offer prices only the visit and diagnosis
 * (call-out + diagnostic fee); repairs are quoted separately after diagnosis. Saving keeps an
 * editable draft; issuing freezes the version and makes it visible to the customer.
 */
export function OfferEditor({ invitationId, offerId, initial, kind }: { invitationId: string; offerId: string | null; initial: OfferValues; kind: "DIAGNOSTIC" | "MAINTENANCE" }) {
  const [message, setMessage] = useState<string | null>(null);
  const [currentOfferId, setCurrentOfferId] = useState(offerId);
  const { run, error } = useAction();
  const issueKey = useIdempotencyKey();
  const form = useForm<OfferValues>({ resolver: zodResolver(offerDraftSchema), defaultValues: initial });
  const [callout, service, rate] = useWatch({ control: form.control, name: ["calloutFee", "serviceFee", "taxRate"] });
  const c = parseMoneyInput(callout as string);
  const s = parseMoneyInput(service as string);
  const r = parseRateInput(rate as string);
  const totals = s !== null && r !== null ? computeOfferTotals(c, s, r) : null;
  const { errors, isSubmitting } = form.formState;

  const save = async (values: OfferValues, issue: boolean) => {
    setMessage(null);
    const saved = await run(() => api<{ offerId: string; versionId: string }>(`/api/v1/provider/invitations/${invitationId}/offer`, { method: "PUT", body: values }), { refresh: !issue });
    if (!saved) return;
    setCurrentOfferId(saved.offerId);
    if (!issue) return setMessage(t("offerEditor.draftSaved"));
    const issued = await run(() => api(`/api/v1/offers/${saved.offerId}/issue`, { method: "POST", body: {}, idempotencyKey: issueKey.key() }));
    if (issued !== undefined) {
      issueKey.renew();
      setMessage(t("offerEditor.issued"));
    }
  };

  return (
    <form noValidate className="space-y-5" onSubmit={form.handleSubmit((v) => save(v, false))}>
      <Alert tone="info">{kind === "DIAGNOSTIC" ? t("offerEditor.diagnosticRule") : t("offerEditor.maintenanceRule")}</Alert>
      <Field label={t("offerEditor.scope")} error={errors.scope?.message} required hint={kind === "DIAGNOSTIC" ? t("offerEditor.scopeHintDiagnostic") : t("offerEditor.scopeHintMaintenance")}>
        <Textarea rows={4} maxLength={2000} {...form.register("scope")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("offerEditor.calloutFee")} error={errors.calloutFee?.message} hint={t("offerEditor.optionalFee")}>
          <Input inputMode="decimal" placeholder="0,00" {...form.register("calloutFee")} />
        </Field>
        <Field label={kind === "DIAGNOSTIC" ? t("offerEditor.diagnosticFee") : t("offerEditor.maintenanceFee")} error={errors.serviceFee?.message} required>
          <Input inputMode="decimal" placeholder="0,00" {...form.register("serviceFee")} />
        </Field>
        <Field label={t("offerEditor.taxRate")} error={errors.taxRate?.message} required hint={t("offerEditor.taxRateHint")}>
          <Input inputMode="decimal" {...form.register("taxRate")} />
        </Field>
      </div>
      <Field label={t("offerEditor.taxNote")} error={errors.taxNote?.message} hint={t("offerEditor.taxNoteHint")}>
        <Input {...form.register("taxNote")} />
      </Field>
      <dl className="grid gap-1 rounded-lg bg-subtle p-3 text-sm sm:max-w-sm" aria-live="polite">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t("quote.subtotal")}</dt>
          <dd className="tabular-nums">{totals ? formatMoney(totals.subtotalMinor) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t("quote.tax")}</dt>
          <dd className="tabular-nums">{totals ? formatMoney(totals.taxMinor) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
          <dt>{t("quote.total")}</dt>
          <dd className="tabular-nums">{totals ? formatMoney(totals.totalMinor) : "—"}</dd>
        </div>
      </dl>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t("offerEditor.window")}</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t("booking.confirm.date")} error={errors.windowDate?.message} required>
            <Input type="date" {...form.register("windowDate")} />
          </Field>
          <Field label={t("offerEditor.from")} error={errors.windowStart?.message} required>
            <Input type="time" step={900} {...form.register("windowStart")} />
          </Field>
          <Field label={t("offerEditor.to")} error={errors.windowEnd?.message} required>
            <Input type="time" step={900} {...form.register("windowEnd")} />
          </Field>
          <Field label={t("booking.confirm.duration")} error={errors.estimatedDurationMin?.message} required>
            <Input type="number" inputMode="numeric" min={15} step={15} {...form.register("estimatedDurationMin")} />
          </Field>
        </div>
        <p className="text-xs text-muted">{t("offerEditor.windowHint")}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("booking.cancellationTerms")} error={errors.cancellationTerms?.message} required>
          <Textarea rows={2} maxLength={1000} {...form.register("cancellationTerms")} />
        </Field>
        <Field label={t("quote.exclusions")} error={errors.exclusions?.message}>
          <Textarea rows={2} maxLength={1000} {...form.register("exclusions")} />
        </Field>
        <Field label={t("quote.warranty")} error={errors.warrantyTerms?.message}>
          <Textarea rows={2} maxLength={1000} {...form.register("warrantyTerms")} />
        </Field>
        <Field label={t("offerEditor.validDays")} error={errors.validDays?.message} required>
          <Input type="number" inputMode="numeric" min={1} max={30} {...form.register("validDays")} />
        </Field>
      </div>
      <FormError error={error} />
      {message ? (
        <Alert tone="success" live>
          {message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={isSubmitting}>
          {t("offerEditor.saveDraft")}
        </Button>
        <Button type="button" loading={isSubmitting} icon={<Send aria-hidden className="size-4" />} onClick={form.handleSubmit((v) => save(v, true))}>
          {t("offerEditor.issue")}
        </Button>
      </div>
      {currentOfferId ? <p className="text-xs text-muted">{t("offerEditor.immutableNote")}</p> : null}
    </form>
  );
}

export function WithdrawOfferButton({ offerId }: { offerId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("offerEditor.withdraw")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("offerEditor.withdrawTitle")}
      description={t("offerEditor.withdrawBody")}
      confirmLabel={t("offerEditor.withdraw")}
      confirmVariant="danger"
      reason={{ label: t("booking.reason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/offers/${offerId}/withdraw`, { body: { reason } })}
    />
  );
}

export function DiscardOfferDraftButton({ offerId }: { offerId: string }) {
  return (
    <ActionButton size="sm" variant="ghost" onRun={() => api(`/api/v1/offers/${offerId}/draft`, { method: "DELETE" })}>
      {t("offerEditor.discardDraft")}
    </ActionButton>
  );
}

export function DeclineInvitationButton({ invitationId }: { invitationId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("providerInvitations.decline")}
      triggerVariant="secondary"
      title={t("providerInvitations.declineTitle")}
      description={t("providerInvitations.declineBody")}
      confirmLabel={t("providerInvitations.decline")}
      confirmVariant="danger"
      reason={{ label: t("providerInvitations.declineReason") }}
      onConfirm={(reason) => api(`/api/v1/provider/invitations/${invitationId}/decline`, { body: { reason: reason || null } })}
    />
  );
}
