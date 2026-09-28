"use client";

import { Car, Hammer, MapPin, PackageSearch } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, useAction } from "@/components/ui/dialog";
import { Field, FormError, Select, Textarea } from "@/components/ui/field";

type Action = "START_TRAVEL" | "ARRIVE" | "START_WORK" | "WAIT_FOR_PARTS";

const FROM: Record<Action, string[]> = {
  START_TRAVEL: ["SCHEDULED"],
  ARRIVE: ["SCHEDULED", "EN_ROUTE"],
  START_WORK: ["ON_SITE", "DIAGNOSED", "AWAITING_PARTS"],
  WAIT_FOR_PARTS: ["DIAGNOSED", "IN_PROGRESS"],
};
const ICONS = { START_TRAVEL: Car, ARRIVE: MapPin, START_WORK: Hammer, WAIT_FOR_PARTS: PackageSearch } as const;

/**
 * Status buttons for the assigned technician (or dispatcher). Work that needs an approved
 * scope (start work, wait for parts) is only offered when a repair quote was approved or the
 * booking is a maintenance visit whose scope the customer already accepted.
 */
export function WorkActionButtons({ workOrderId, status, lockVersion, hasScope }: { workOrderId: string; status: string; lockVersion: number; hasScope: boolean }) {
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const { run, pending, error, setError } = useAction();
  const available = (Object.keys(FROM) as Action[]).filter((a) => FROM[a].includes(status) && (hasScope || (a !== "START_WORK" && a !== "WAIT_FOR_PARTS")));
  if (available.length === 0) return null;
  const submit = async () => {
    if (!pendingAction) return;
    const ok = await run(() => api(`/api/v1/work-orders/${workOrderId}/events`, { body: { action: pendingAction, note: note.trim() || null, expectedLockVersion: lockVersion } }));
    if (ok !== undefined) {
      setPendingAction(null);
      setNote("");
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {available.map((a) => {
          const Icon = ICONS[a];
          return (
            <Button
              key={a}
              variant={a === available[0] ? "primary" : "secondary"}
              size="lg"
              icon={<Icon aria-hidden className="size-5" />}
              onClick={() => {
                setError(null);
                setPendingAction(a);
              }}
            >
              {t(`work.actions.${a}`)}
            </Button>
          );
        })}
      </div>
      {!hasScope && ["ON_SITE", "DIAGNOSED"].includes(status) ? <p className="text-sm text-muted">{t("work.scopeNeeded")}</p> : null}
      <Dialog
        open={pendingAction !== null}
        onClose={() => !pending && setPendingAction(null)}
        title={pendingAction ? t(`work.actions.${pendingAction}`) : ""}
        description={pendingAction ? t(`work.confirm.${pendingAction}`) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingAction(null)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={pending}>
              {t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("work.note")} hint={t("work.noteHint")}>
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormError error={error} />
        </div>
      </Dialog>
    </div>
  );
}

/** Adds a note to the job. Visibility choices depend on the author's side. */
export function NoteForm({ workOrderId, side }: { workOrderId: string; side: "CUSTOMER" | "PROVIDER" }) {
  const options = side === "CUSTOMER" ? ["SHARED", "CUSTOMER_PRIVATE"] : ["SHARED", "PROVIDER_INTERNAL"];
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState(options[0]!);
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        if (!body.trim()) return setLocalError(t("notes.required"));
        const ok = await run(() => api(`/api/v1/work-orders/${workOrderId}/notes`, { body: { body, visibility } }));
        if (ok !== undefined) setBody("");
      }}
    >
      <Field label={t("notes.add")} error={localError}>
        <Textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("notes.visibility")} className="min-w-56">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {t(`enums.noteVisibility.${o}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" loading={pending}>
          {t("notes.submit")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
