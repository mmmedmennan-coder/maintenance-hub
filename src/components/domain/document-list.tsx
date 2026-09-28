import { FileText, ImageIcon } from "lucide-react";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { DeleteDocumentButton } from "@/features/document-actions";
import { StatusBadge } from "./status-badge";

export type DocItem = {
  id: string;
  originalName: string;
  kind: string;
  visibility: string;
  status: string;
  mimeType: string | null;
  createdAt: Date;
  canDelete?: boolean;
};

/** Private files: thumbnails and links go through the authorized download endpoint. */
export function DocumentList({ docs, emptyLabel }: { docs: DocItem[]; emptyLabel?: string }) {
  if (docs.length === 0) return <p className="text-sm text-muted">{emptyLabel ?? t("documents.empty")}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {docs.map((d) => {
        const isImage = d.mimeType?.startsWith("image/") && d.status === "READY";
        return (
          <li key={d.id} className="flex gap-3 rounded-lg border border-line bg-surface p-2.5">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, authorized, same-origin image
              <img src={`/api/v1/documents/${d.id}/download?inline=1`} alt={d.originalName} className="size-16 shrink-0 rounded-md border border-line object-cover" loading="lazy" />
            ) : (
              <span className="grid size-16 shrink-0 place-items-center rounded-md bg-subtle text-muted">
                {d.mimeType?.startsWith("image/") ? <ImageIcon aria-hidden className="size-6" /> : <FileText aria-hidden className="size-6" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {d.status === "READY" ? (
                <a href={`/api/v1/documents/${d.id}/download`} className="block truncate text-sm font-semibold text-brand hover:underline">
                  {d.originalName}
                </a>
              ) : (
                <span className="block truncate text-sm font-semibold text-ink">{d.originalName}</span>
              )}
              <p className="text-xs text-muted">
                {te("enums.documentKind", d.kind)} · {te("enums.documentVisibility", d.visibility)}
              </p>
              <p className="text-xs text-muted">{formatDateTime(d.createdAt)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {d.status !== "READY" ? <StatusBadge domain="document" status={d.status} /> : null}
                {d.canDelete ? <DeleteDocumentButton id={d.id} /> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
