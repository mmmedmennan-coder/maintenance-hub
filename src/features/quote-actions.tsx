"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleX, Plus, Send, Trash } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { computeLine, formatMoney, parseMoneyInput, parseQuantityInput, parseRateInput, sumLines } from "@/lib/money";
import { repairQuoteSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, Dialog, useAction, useIdempotencyKey } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type Values = z.input<typeof repairQuoteSchema>;
const LINE_KINDS = ["PART", "LABOR", "TRAVEL", "OTHER"] as const;

function liveTotals(lines: Values["lines"] | undefined) {
  const computed = (lines ?? []).map((l) => {
    const q = parseQuantityInput(l?.quantity as string);
    const p = parseMoneyInput(l?.unitPrice as string);
    const r = parseRateInput(l?.taxRate as string);
    return q !== null && p !== null && r !== null ? computeLine(q, p, r) : null;
  });
  return { lines: computed, totals: sumLines(computed.filter((c): c is NonNullable<typeof c> => c !== null)), incomplete: computed.some((c) => c === null) };
}

/**
 * Repair quote editor (technician or dispatcher). Saving stores an editable draft; issuing
 * freezes that exact version (hash) and sends it to the customer for approval. Totals shown
 * here use the same rounding as the server, which recomputes them authoritatively.
 */
export function QuoteEditor({
  workOrderId,
  repairQuoteId,
  initial,
  draftVersionId,
  revision,
  onDone,
}: {
  workOrderId: string;
  repairQuoteId: string | null;
  initial?: Partial<Values>;
  draftVersionId?: string | null;
  revision?: boolean;
  onDone?: () => void;
}) {
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftVersionId ?? null);
  // After the first save the quote exists: later saves update its draft instead of starting another quote.
  const [quoteId, setQuoteId] = useState<string | null>(repairQuoteId);
  const [message, setMessage] = useState<string | null>(null);
  const { run, error } = useAction();
  const issueKey = useIdempotencyKey();
  const form = useForm<Values>({
    resolver: zodResolver(repairQuoteSchema),
    defaultValues: {
      title: initial?.title,
      scopeSummary: initial?.scopeSummary ?? "",
      estimatedDurationMin: initial?.estimatedDurationMin ?? null,
      timingNote: initial?.timingNote ?? "",
      exclusions: initial?.exclusions ?? "",
      warrantyTerms: initial?.warrantyTerms ?? "",
      validDays: initial?.validDays ?? 7,
      revisionReason: initial?.revisionReason ?? "",
      lines: initial?.lines?.length ? initial.lines : [{ kind: "LABOR", description: "", quantity: "1", unitPrice: "", taxRate: "20" }],
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const watched = useWatch({ control: form.control, name: "lines" });
  const live = liveTotals(watched);
  const { errors, isSubmitting } = form.formState;

  const save = async (values: Values, issue: boolean) => {
    setMessage(null);
    const path = quoteId ? `/api/v1/repair-quotes/${quoteId}/versions` : `/api/v1/work-orders/${workOrderId}/repair-quotes`;
    const saved = await run(() => api<{ versionId: string; repairQuoteId: string }>(path, { body: values }), { refresh: !issue });
    if (!saved) return;
    setSavedDraftId(saved.versionId);
    setQuoteId(saved.repairQuoteId);
    if (!issue) {
      setMessage(t("quote.editor.draftSaved"));
      return;
    }
    const issued = await run(() => api(`/api/v1/repair-quote-versions/${saved.versionId}/issue`, { method: "POST", body: {}, idempotencyKey: issueKey.key() }));
    if (issued !== undefined) {
      issueKey.renew();
      onDone?.();
    }
  };

  return (
    <form noValidate className="space-y-5" onSubmit={form.handleSubmit((v) => save(v, false))}>
      {revision ? (
        <Field label={t("quote.editor.revisionReason")} error={errors.revisionReason?.message} required hint={t("quote.editor.revisionHint")}>
          <Input {...form.register("revisionReason")} />
        </Field>
      ) : null}
      <Field label={t("quote.editor.scope")} error={errors.scopeSummary?.message} required hint={t("quote.editor.scopeHint")}>
        <Textarea rows={4} maxLength={2000} {...form.register("scopeSummary")} />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t("quote.editor.lines")}</legend>
        {errors.lines?.message || errors.lines?.root?.message ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.lines?.message ?? errors.lines?.root?.message}
          </p>
        ) : null}
        <ol className="space-y-3">
          {lines.fields.map((field, i) => {
            const lineErrors = errors.lines?.[i];
            const amounts = live.lines[i];
            return (
              <li key={field.id} className="rounded-lg border border-line bg-canvas p-3">
                <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                  <Field label={t("quote.editor.kind")} error={lineErrors?.kind?.message}>
                    <Select {...form.register(`lines.${i}.kind`)}>
                      {LINE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`enums.lineKind.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("quote.editor.description")} error={lineErrors?.description?.message} required>
                    <Input {...form.register(`lines.${i}.description`)} />
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label={t("quote.editor.quantity")} error={lineErrors?.quantity?.message} required>
                    <Input inputMode="decimal" {...form.register(`lines.${i}.quantity`)} />
                  </Field>
                  <Field label={t("quote.editor.unitPrice")} error={lineErrors?.unitPrice?.message} required>
                    <Input inputMode="decimal" placeholder="0,00" {...form.register(`lines.${i}.unitPrice`)} />
                  </Field>
                  <Field label={t("quote.editor.taxRate")} error={lineErrors?.taxRate?.message} required>
                    <Input inputMode="decimal" {...form.register(`lines.${i}.taxRate`)} />
                  </Field>
                  <div className="flex flex-col justify-end gap-1">
                    <span className="text-xs font-semibold text-muted">{t("quote.editor.lineTotal")}</span>
                    <output className="text-sm font-semibold tabular-nums text-ink">{amounts ? formatMoney(amounts.totalMinor) : "—"}</output>
                  </div>
                </div>
                {lines.fields.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-2" icon={<Trash aria-hidden className="size-4" />} onClick={() => lines.remove(i)}>
                    {t("quote.editor.removeLine")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
        {lines.fields.length < 40 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => lines.append({ kind: "PART", description: "", quantity: "1", unitPrice: "", taxRate: "20" })}
          >
            {t("quote.editor.addLine")}
          </Button>
        ) : null}
      </fieldset>

      <dl className="grid gap-1 rounded-lg bg-subtle p-3 text-sm sm:max-w-sm" aria-live="polite">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t("quote.subtotal")}</dt>
          <dd className="tabular-nums">{formatMoney(live.totals.subtotalMinor)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{t("quote.tax")}</dt>
          <dd className="tabular-nums">{formatMoney(live.totals.taxMinor)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
          <dt>{t("quote.total")}</dt>
          <dd className="tabular-nums">{formatMoney(live.totals.totalMinor)}</dd>
        </div>
        {live.incomplete ? <p className="text-xs text-muted">{t("quote.editor.incompleteLines")}</p> : null}
      </dl>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("quote.editor.duration")} error={errors.estimatedDurationMin?.message} hint={t("quote.editor.durationHint")}>
          <Input type="number" inputMode="numeric" min={15} step={15} {...form.register("estimatedDurationMin", { setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)) })} />
        </Field>
        <Field label={t("quote.editor.validDays")} error={errors.validDays?.message}>
          <Input type="number" inputMode="numeric" min={1} max={60} {...form.register("validDays")} />
        </Field>
        <Field label={t("quote.editor.timing")} error={errors.timingNote?.message} hint={t("quote.editor.timingHint")}>
          <Input {...form.register("timingNote")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quote.exclusions")} error={errors.exclusions?.message}>
          <Textarea rows={2} {...form.register("exclusions")} />
        </Field>
        <Field label={t("quote.warranty")} error={errors.warrantyTerms?.message}>
          <Textarea rows={2} {...form.register("warrantyTerms")} />
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
          {t("quote.editor.saveDraft")}
        </Button>
        <Button type="button" loading={isSubmitting} icon={<Send aria-hidden className="size-4" />} onClick={form.handleSubmit((v) => save(v, true))}>
          {t("quote.editor.issue")}
        </Button>
      </div>
      {savedDraftId ? <p className="text-xs text-muted">{t("quote.editor.draftNote")}</p> : null}
    </form>
  );
}

export function IssueQuoteButton({ versionId }: { versionId: string }) {
  return (
    <ActionButton size="sm" icon={<Send aria-hidden className="size-4" />} onRun={(key) => api(`/api/v1/repair-quote-versions/${versionId}/issue`, { method: "POST", body: {}, idempotencyKey: key })}>
      {t("quote.editor.issue")}
    </ActionButton>
  );
}

export function WithdrawQuoteButton({ versionId, draft }: { versionId: string; draft: boolean }) {
  return (
    <ActionDialog
      triggerLabel={draft ? t("quote.discardDraft") : t("quote.withdraw")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={draft ? t("quote.discardDraft") : t("quote.withdrawTitle")}
      description={draft ? t("quote.discardBody") : t("quote.withdrawBody")}
      confirmLabel={draft ? t("quote.discardDraft") : t("quote.withdraw")}
      confirmVariant="danger"
      onConfirm={() => api(`/api/v1/repair-quote-versions/${versionId}/withdraw`, { method: "POST", body: {} })}
    />
  );
}

/**
 * Customer decision on one exact version. The request carries the snapshot hash of what is
 * displayed; if the provider revised the quote meanwhile the server answers VERSION_CONFLICT
 * and nothing is approved.
 */
export function QuoteDecisionPanel({ versionId, snapshotHash, totalMinor, currency }: { versionId: string; snapshotHash: string; totalMinor: number; currency: string }) {
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [reason, setReason] = useState("");
  const { run, pending, error, setError } = useAction();
  const idem = useIdempotencyKey();
  const submit = async () => {
    if (!mode) return;
    const ok = await run(() =>
      api(`/api/v1/repair-quote-versions/${versionId}/decision`, {
        body: { decision: mode, expectedSnapshotHash: snapshotHash, reason: reason.trim() || null },
        idempotencyKey: idem.key(),
      }),
    );
    if (ok !== undefined) {
      idem.renew();
      setMode(null);
      setReason("");
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        icon={<CircleCheck aria-hidden className="size-4" />}
        onClick={() => {
          setError(null);
          setMode("APPROVED");
        }}
      >
        {t("quote.decision.approve")}
      </Button>
      <Button
        variant="secondary"
        icon={<CircleX aria-hidden className="size-4" />}
        onClick={() => {
          setError(null);
          setMode("REJECTED");
        }}
      >
        {t("quote.decision.reject")}
      </Button>
      <Dialog
        open={mode !== null}
        onClose={() => !pending && setMode(null)}
        title={mode === "APPROVED" ? t("quote.decision.approveTitle") : t("quote.decision.rejectTitle")}
        description={mode === "APPROVED" ? t("quote.decision.approveBody", { amount: formatMoney(totalMinor, currency) }) : t("quote.decision.rejectBody")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button variant={mode === "APPROVED" ? "primary" : "danger"} onClick={submit} loading={pending}>
              {mode === "APPROVED" ? t("quote.decision.approveConfirm", { amount: formatMoney(totalMinor, currency) }) : t("quote.decision.reject")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={mode === "APPROVED" ? t("quote.decision.comment") : t("quote.decision.reason")}>
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError error={error} />
        </div>
      </Dialog>
    </div>
  );
}
