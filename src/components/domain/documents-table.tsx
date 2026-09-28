import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import type { listVisibleDocuments } from "@/server/modules/dashboards";
import { Table, Td, Th } from "@/components/ui/layout";

function sizeLabel(bytes: number | null) {
  if (!bytes) return "—";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/** Private documents table; every link goes through the authorized download endpoint. */
export function DocumentsTable({ items, workspace }: { items: Awaited<ReturnType<typeof listVisibleDocuments>>["items"]; workspace: "client" | "prestataire" }) {
  return (
    <Table
      caption={t("documents.title")}
      head={
        <tr>
          <Th>{t("documents.name")}</Th>
          <Th>{t("documents.kind")}</Th>
          <Th>{t("documents.visibility")}</Th>
          <Th>{t("documents.linkedTo")}</Th>
          <Th>{t("common.date")}</Th>
        </tr>
      }
    >
      {items.map((d) => (
        <tr key={d.id}>
          <Td>
            <a href={`/api/v1/documents/${d.id}/download`} className="font-semibold text-brand hover:underline">
              {d.originalName}
            </a>
            <span className="block text-xs text-muted">{sizeLabel(d.sizeBytes)}</span>
          </Td>
          <Td>{te("enums.documentKind", d.kind)}</Td>
          <Td className="text-sm">{te("enums.documentVisibility", d.visibility)}</Td>
          <Td className="text-sm">
            {d.requestId && workspace === "client" ? <Link href={`/client/demandes/${d.requestId}`} className="hover:text-brand">{t("documents.toRequest")}</Link> : null}
            {d.equipmentId && workspace === "client" ? <Link href={`/client/equipements/${d.equipmentId}`} className="hover:text-brand">{t("documents.toEquipment")}</Link> : null}
            {d.workOrder ? (
              <Link href={`/${workspace}/rendez-vous/${d.workOrder.bookingId}`} className="hover:text-brand">
                {t("documents.toWorkOrder", { ref: d.workOrder.reference })}
              </Link>
            ) : null}
            {!d.requestId && !d.equipmentId && !d.workOrderId ? "—" : null}
          </Td>
          <Td className="whitespace-nowrap text-sm">{formatDateTime(d.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}
