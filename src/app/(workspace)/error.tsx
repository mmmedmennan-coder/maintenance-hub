"use client";

import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="danger" title={t("errors.serverTitle")}>
        {t("errors.serverBody")}
      </Alert>
      <Button onClick={reset}>{t("errors.retry")}</Button>
    </div>
  );
}
