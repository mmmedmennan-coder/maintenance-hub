import { t } from "@/lib/i18n";
import { PageSkeleton } from "@/components/ui/feedback";

export default function Loading() {
  return <PageSkeleton label={t("common.loading")} />;
}
