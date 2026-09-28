import { Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listProviderReviews } from "@/server/modules/feedback";
import { StatusBadge } from "@/components/domain/status-badge";
import { ReviewResponseButton } from "@/features/review-actions";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("review.providerTitle") };

export default async function ProviderReviewsPage() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const reviews = await withActor(actor, (tx) => listProviderReviews(tx, actor));
  const published = reviews.filter((r) => r.status === "PUBLISHED");
  const avg = published.length ? (published.reduce((s, r) => s + r.rating, 0) / published.length).toFixed(1).replace(".", ",") : null;
  return (
    <>
      <PageHeader title={t("review.providerTitle")} description={t("review.providerIntro")} meta={avg ? <span className="text-sm font-semibold">{t("provider.rating", { avg, count: published.length })}</span> : null} />
      {reviews.length === 0 ? (
        <EmptyState icon={Star} title={t("provider.noReviews")}>{t("review.providerEmpty")}</EmptyState>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{t("review.ratingValue", { n: r.rating })}</span>
                  <StatusBadge domain="review" status={r.status} />
                  <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                  <Link href={`/prestataire/rendez-vous/${r.bookingId}`} className="text-xs font-semibold text-brand hover:underline">
                    {t("review.openBooking")}
                  </Link>
                </p>
                {r.comment ? <p className="whitespace-pre-line text-sm">{r.comment}</p> : null}
                {r.status === "REJECTED" && r.moderationNote ? <p className="text-xs text-muted">{t("review.moderationNote", { note: r.moderationNote })}</p> : null}
                {r.response ? (
                  <div className="rounded-lg bg-subtle p-3 text-sm">
                    <p className="text-xs font-semibold text-muted">{r.response.hidden ? t("review.responseHidden") : t("review.yourResponse")}</p>
                    <p className="whitespace-pre-line">{r.response.body}</p>
                  </div>
                ) : r.status === "PUBLISHED" && can.providerManage(actor) ? (
                  <ReviewResponseButton reviewId={r.id} />
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
