import { Star } from "lucide-react";
import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listReviewsForModeration } from "@/server/modules/feedback";
import { FilterTabs } from "@/components/domain/booking-list";
import { StatusBadge } from "@/components/domain/status-badge";
import { HideResponseButton, ReviewModerationButtons } from "@/features/admin-actions";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.reviews.title") };
const TABS = ["PENDING_MODERATION", "PUBLISHED", "REJECTED"] as const;

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const sp = await searchParams;
  const status = TABS.find((s) => s === sp.statut) ?? "PENDING_MODERATION";
  const reviews = await withActor(actor, (tx) => listReviewsForModeration(tx, actor, status));
  return (
    <>
      <PageHeader title={t("admin.reviews.title")} description={t("admin.reviews.intro")} />
      <FilterTabs label={t("admin.reviews.filterLabel")} tabs={[...TABS]} current={status} hrefFor={(s) => `/admin/avis?statut=${s}`} labelFor={(s) => te("status.review", s)} />
      {reviews.length === 0 ? (
        <EmptyState icon={Star} title={t("admin.reviews.empty")} />
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{r.providerName}</span>
                  <span>{t("review.ratingValue", { n: r.rating })}</span>
                  <StatusBadge domain="review" status={r.status} />
                  {r.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
                  <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                </p>
                {r.comment ? <p className="whitespace-pre-line text-sm">{r.comment}</p> : <p className="text-sm text-muted">{t("admin.reviews.noComment")}</p>}
                {r.moderationNote ? <p className="text-xs text-muted">{t("review.moderationNote", { note: r.moderationNote })}</p> : null}
                {r.response ? (
                  <div className="rounded-lg bg-subtle p-3 text-sm">
                    <p className="text-xs font-semibold text-muted">{r.response.hidden ? t("review.responseHidden") : t("review.providerResponse")}</p>
                    <p className="whitespace-pre-line">{r.response.body}</p>
                    {!r.response.hidden ? <HideResponseButton reviewId={r.id} /> : null}
                  </div>
                ) : null}
                {r.status === "PENDING_MODERATION" ? <ReviewModerationButtons reviewId={r.id} /> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
