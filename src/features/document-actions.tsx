"use client";

import { Trash } from "lucide-react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { ActionDialog } from "@/components/ui/dialog";

export function DeleteDocumentButton({ id }: { id: string }) {
  return (
    <ActionDialog
      triggerLabel={t("common.delete")}
      triggerVariant="ghost"
      triggerSize="sm"
      triggerIcon={<Trash aria-hidden className="size-3.5" />}
      title={t("documents.deleteTitle")}
      description={t("documents.deleteBody")}
      confirmLabel={t("common.delete")}
      confirmVariant="danger"
      onConfirm={() => api(`/api/v1/documents/${id}`, { method: "DELETE" })}
    />
  );
}
