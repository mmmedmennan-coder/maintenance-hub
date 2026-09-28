"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { ActionDialog } from "@/components/ui/dialog";

export function ArchiveToggle({ kind, id, archived }: { kind: "sites" | "equipment"; id: string; archived: boolean }) {
  return (
    <ActionDialog
      triggerLabel={archived ? t("customer.assets.restore") : t("customer.assets.archive")}
      triggerVariant="ghost"
      triggerIcon={archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
      title={archived ? t("customer.assets.restoreTitle") : t("customer.assets.archiveTitle")}
      description={archived ? t("customer.assets.restoreBody") : t(`customer.assets.archiveBody.${kind}`)}
      confirmLabel={archived ? t("customer.assets.restore") : t("customer.assets.archive")}
      onConfirm={() => api(`/api/v1/${kind}/${id}/archive`, { body: { archived: !archived } })}
    />
  );
}
