"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { minorToInput } from "@/lib/money";
import { paymentSchema } from "@/lib/schemas";
import { DocumentUploader } from "@/components/domain/document-uploader";
import { Button } from "@/components/ui/button";
import { ActionDialog, Dialog, useAction, useIdempotencyKey } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type Values = z.input<typeof paymentSchema>;
const METHODS = ["BANK_TRANSFER", "CASH", "CHEQUE", "OTHER_EXTERNAL"] as const;

/**
 * Records a direct payment made outside the platform. A customer entry is REPORTED until the
 * provider confirms receipt; a provider entry is a confirmed receipt. No money moves here.
 */
export function RecordPaymentButton({
  bookingId,
  workOrderId,
  side,
  outstandingMinor,
  today,
}: {
  bookingId: string;
  workOrderId: string | null;
  side: "CUSTOMER" | "PROVIDER";
  outstandingMinor: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [evidenceName, setEvidenceName] = useState<string | null>(null);
  const { run, error } = useAction();
  const idem = useIdempotencyKey();
  const form = useForm<Values>({
    resolver: zodResolver(paymentSchema, undefined, { raw: true }),
    defaultValues: {
      amount: outstandingMinor > 0 ? minorToInput(outstandingMinor) : "",
      method: "BANK_TRANSFER",
      paidOn: today,
      externalReference: "",
      note: "",
      evidenceDocumentId: null,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const ok = await run(() => api(`/api/v1/bookings/${bookingId}/payments`, { body: values, idempotencyKey: idem.key() }));
    if (ok !== undefined) {
      idem.renew();
      setEvidenceName(null);
      form.reset({ ...form.getValues(), amount: "", externalReference: "", note: "", evidenceDocumentId: null });
      setOpen(false);
    }
  });
  return (
    <>
      <Button variant={side === "PROVIDER" ? "secondary" : "primary"} icon={<Wallet aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        {side === "CUSTOMER" ? t("payment.report") : t("payment.recordReceipt")}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isSubmitting && setOpen(false)}
        title={side === "CUSTOMER" ? t("payment.reportTitle") : t("payment.recordTitle")}
        description={side === "CUSTOMER" ? t("payment.reportBody") : t("payment.recordBody")}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={isSubmitting}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("payment.amount")} error={errors.amount?.message} required hint={t("payment.amountHint")}>
              <Input inputMode="decimal" {...form.register("amount")} />
            </Field>
            <Field label={t("payment.method")} error={errors.method?.message} required>
              <Select {...form.register("method")}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`enums.paymentMethod.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("payment.paidOn")} error={errors.paidOn?.message} required>
              <Input type="date" max={today} {...form.register("paidOn")} />
            </Field>
            <Field label={t("payment.externalReference")} error={errors.externalReference?.message} hint={t("payment.externalReferenceHint")}>
              <Input {...form.register("externalReference")} />
            </Field>
          </div>
          <Field label={t("payment.note")} error={errors.note?.message}>
            <Textarea rows={2} maxLength={500} {...form.register("note")} />
          </Field>
          {workOrderId ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">{t("payment.evidence")}</p>
              {evidenceName ? <p className="text-sm text-success">{t("payment.evidenceAttached", { name: evidenceName })}</p> : null}
              <DocumentUploader
                target={{ workOrderId }}
                kind="PAYMENT_EVIDENCE"
                refreshOnSave={false}
                label={t("payment.evidenceUpload")}
                onSaved={(id, file) => {
                  form.setValue("evidenceDocumentId", id);
                  setEvidenceName(file.name);
                }}
              />
            </div>
          ) : null}
          <FormError error={error} />
        </form>
      </Dialog>
    </>
  );
}

/** Payee actions on a payment record; history is never deleted (reversal is its own record). */
export function PaymentDecision({ paymentId, status, asAdmin }: { paymentId: string; status: string; asAdmin?: boolean }) {
  const call = (action: "CONFIRM" | "REJECT" | "REVERSE", reason: string, key: string) =>
    api(`/api/v1/payments/${paymentId}`, { body: { action, reason: reason || null }, idempotencyKey: key });
  if (status === "REPORTED" && !asAdmin) {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionDialog
          triggerLabel={t("payment.confirm")}
          triggerVariant="primary"
          triggerSize="sm"
          title={t("payment.confirmTitle")}
          description={t("payment.confirmBody")}
          confirmLabel={t("payment.confirm")}
          onConfirm={(reason, key) => call("CONFIRM", reason, key)}
        />
        <ActionDialog
          triggerLabel={t("payment.reject")}
          triggerSize="sm"
          title={t("payment.rejectTitle")}
          description={t("payment.rejectBody")}
          confirmLabel={t("payment.reject")}
          confirmVariant="danger"
          reason={{ label: t("payment.reason"), required: true }}
          onConfirm={(reason, key) => call("REJECT", reason, key)}
        />
      </div>
    );
  }
  if (status === "CONFIRMED") {
    return (
      <ActionDialog
        triggerLabel={t("payment.reverse")}
        triggerVariant="ghost"
        triggerSize="sm"
        title={t("payment.reverseTitle")}
        description={t("payment.reverseBody")}
        confirmLabel={t("payment.reverse")}
        confirmVariant="danger"
        reason={{ label: t("payment.reason"), required: true }}
        onConfirm={(reason, key) => call("REVERSE", reason, key)}
      />
    );
  }
  return null;
}
