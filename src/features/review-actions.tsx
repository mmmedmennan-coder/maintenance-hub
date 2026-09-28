"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ActionDialog, useAction } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/field";

/** One review per completed booking, written by the customer; published only after moderation. */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        if (rating < 1) return setLocalError(t("review.ratingRequired"));
        await run(() => api(`/api/v1/bookings/${bookingId}/review`, { body: { rating, comment: comment.trim() || null } }));
      }}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-ink">{t("review.rating")}</legend>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label={t("review.rating")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded p-1 focus-within:ring-2 focus-within:ring-brand">
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <Star aria-hidden className={cn("size-7", n <= rating ? "fill-warn text-warn" : "text-line-strong")} />
              <span className="sr-only">{t("review.stars", { n })}</span>
            </label>
          ))}
        </div>
        {localError ? (
          <p role="alert" className="mt-1 text-sm font-medium text-danger">
            {localError}
          </p>
        ) : null}
      </fieldset>
      <Field label={t("review.comment")} hint={t("review.commentHint")}>
        <Textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <FormError error={error} />
      <Button type="submit" loading={pending}>
        {t("review.submit")}
      </Button>
    </form>
  );
}

export function ReviewResponseButton({ reviewId }: { reviewId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("review.respond")}
      triggerSize="sm"
      title={t("review.respondTitle")}
      description={t("review.respondBody")}
      confirmLabel={t("common.send")}
      reason={{ label: t("review.response"), required: true }}
      onConfirm={(body) => api(`/api/v1/reviews/${reviewId}/response`, { body: { body } })}
    />
  );
}
