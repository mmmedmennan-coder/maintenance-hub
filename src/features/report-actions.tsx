"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, FileCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { reportSchema } from "@/lib/schemas";
import { DocumentUploader } from "@/components/domain/document-uploader";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, Dialog, useAction, useIdempotencyKey } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";

type Values = z.input<typeof reportSchema>;
type Photo = { id: string; name: string };

/**
 * Service report submission. Only photos the server confirmed as saved can be attached;
 * a photo still uploading or failed is never silently included in or dropped from the report.
 */
export function ReportForm({ workOrderId, photos, pendingQuote }: { workOrderId: string; photos: Photo[]; pendingQuote: boolean }) {
  const { run, error } = useAction();
  const idem = useIdempotencyKey();
  const [available, setAvailable] = useState<Photo[]>(photos);
  const form = useForm<Values>({
    resolver: zodResolver(reportSchema, undefined, { raw: true }),
    defaultValues: { findings: "", workPerformed: "", partsUsed: "", recommendations: "", nextServiceDate: null, photoDocumentIds: photos.map((p) => p.id) },
  });
  const selected = useWatch({ control: form.control, name: "photoDocumentIds" }) ?? [];
  const { errors, isSubmitting } = form.formState;
  if (pendingQuote) return <p className="text-sm text-muted">{t("report.form.pendingQuote")}</p>;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        const ok = await run(() => api(`/api/v1/work-orders/${workOrderId}/reports`, { body: values, idempotencyKey: idem.key() }));
        if (ok !== undefined) idem.renew();
      })}
    >
      <Field label={t("report.findings")} error={errors.findings?.message} required hint={t("report.form.findingsHint")}>
        <Textarea rows={4} maxLength={4000} {...form.register("findings")} />
      </Field>
      <Field label={t("report.workPerformed")} error={errors.workPerformed?.message} required>
        <Textarea rows={4} maxLength={4000} {...form.register("workPerformed")} />
      </Field>
      <Field label={t("report.partsUsed")} error={errors.partsUsed?.message}>
        <Textarea rows={2} maxLength={2000} {...form.register("partsUsed")} />
      </Field>
      <Field label={t("report.recommendations")} error={errors.recommendations?.message}>
        <Textarea rows={2} maxLength={2000} {...form.register("recommendations")} />
      </Field>
      <Field label={t("report.nextServiceDate")} error={errors.nextServiceDate?.message}>
        <Input type="date" {...form.register("nextServiceDate", { setValueAs: (v) => (v ? v : null) })} className="sm:max-w-xs" />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">{t("report.form.photos")}</legend>
        {available.length === 0 ? <p className="text-sm text-muted">{t("report.form.noPhotos")}</p> : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {available.map((p) => (
            <li key={p.id}>
              <label className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) => form.setValue("photoDocumentIds", e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- private authorized thumbnail */}
                <img src={`/api/v1/documents/${p.id}/download?inline=1`} alt="" className="size-10 rounded object-cover" />
                <span className="min-w-0 truncate">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <DocumentUploader
          target={{ workOrderId }}
          kind="PHOTO"
          refreshOnSave={false}
          label={t("report.form.addPhotos")}
          onSaved={(id, file) => {
            setAvailable((list) => [...list, { id, name: file.name }]);
            form.setValue("photoDocumentIds", [...selected, id]);
          }}
        />
        {errors.photoDocumentIds?.message ? <p className="text-sm font-medium text-danger">{errors.photoDocumentIds.message}</p> : null}
      </fieldset>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting} icon={<FileCheck aria-hidden className="size-4" />}>
        {t("report.form.submit")}
      </Button>
      <p className="text-xs text-muted">{t("report.form.finalNote")}</p>
    </form>
  );
}

/** Customer acknowledges the report or opens a dispute (acknowledgment is not a waiver). */
export function AcknowledgeReport({ workOrderId, canDispute }: { workOrderId: string; canDispute: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        triggerLabel={t("report.ack.acknowledge")}
        triggerVariant="primary"
        triggerIcon={<CircleCheck aria-hidden className="size-4" />}
        title={t("report.ack.title")}
        description={t("report.ack.body")}
        confirmLabel={t("report.ack.acknowledge")}
        reason={{ label: t("report.ack.comment") }}
        onConfirm={(note) => api(`/api/v1/work-orders/${workOrderId}/acknowledgment`, { body: { decision: "ACKNOWLEDGE", reason: note || null } })}
      />
      {canDispute ? (
        <>
          <Button variant="secondary" icon={<TriangleAlert aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
            {t("report.ack.dispute")}
          </Button>
          <Dialog
            open={open}
            onClose={() => !pending && setOpen(false)}
            title={t("report.ack.disputeTitle")}
            description={t("report.ack.disputeBody")}
            footer={
              <>
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  onClick={async () => {
                    setLocalError(null);
                    if (reason.trim().length < 10) return setLocalError(t("report.ack.disputeMin"));
                    const ok = await run(() => api(`/api/v1/work-orders/${workOrderId}/acknowledgment`, { body: { decision: "DISPUTE", reason: reason.trim() } }));
                    if (ok !== undefined) {
                      setOpen(false);
                      setReason("");
                    }
                  }}
                >
                  {t("report.ack.disputeConfirm")}
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <Field label={t("report.ack.disputeReason")} required error={localError}>
                <Textarea rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <FormError error={error} />
            </div>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export function DisputeCommentForm({ disputeId }: { disputeId: string }) {
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        if (body.trim().length < 3) return setLocalError(t("common.reasonRequired"));
        const ok = await run(() => api(`/api/v1/disputes/${disputeId}/comments`, { body: { body } }));
        if (ok !== undefined) setBody("");
      }}
    >
      <Field label={t("dispute.addComment")} error={localError}>
        <Textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {t("common.send")}
      </Button>
    </form>
  );
}

export function WithdrawDisputeButton({ disputeId }: { disputeId: string }) {
  return (
    <ActionButton size="sm" variant="ghost" onRun={() => api(`/api/v1/disputes/${disputeId}/withdraw`, { method: "POST", body: {} })}>
      {t("dispute.withdraw")}
    </ActionButton>
  );
}
