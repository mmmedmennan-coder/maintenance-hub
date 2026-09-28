import { CalendarDays, FileDown, History, MapPin, Refrigerator } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { t, te } from "@/lib/i18n";
import { formatMoney, formatQuantity, formatRate } from "@/lib/money";
import { addDaysToDateString, durationLabel, formatDate, formatDateTime, formatWindow, localDateString, localTimeString } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { getBookingDetail } from "@/server/modules/bookings";
import type { listPayments } from "@/server/modules/payments";
import {
  CancelBookingButton,
  ConfirmBookingForm,
  DeclineBookingButton,
  NoShowButton,
  ProposeRescheduleButton,
  RespondRescheduleButtons,
  type TechnicianOption,
  WithdrawRescheduleButton,
} from "@/features/booking-actions";
import { PaymentDecision, RecordPaymentButton } from "@/features/payment-actions";
import { IssueQuoteButton, QuoteDecisionPanel, QuoteEditor, WithdrawQuoteButton } from "@/features/quote-actions";
import { AcknowledgeReport, DisputeCommentForm, ReportForm, WithdrawDisputeButton } from "@/features/report-actions";
import { ReviewForm, ReviewResponseButton } from "@/features/review-actions";
import { NoteForm, WorkActionButtons } from "@/features/work-actions";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { DocumentList } from "./document-list";
import { DocumentUploader } from "./document-uploader";
import { StatusBadge } from "./status-badge";

export type BookingDetail = Awaited<ReturnType<typeof getBookingDetail>>;
export type Perspective = "customer" | "provider" | "technician" | "admin";
type Version = NonNullable<BookingDetail["booking"]["workOrder"]>["repairQuotes"][number]["versions"][number];
type Doc = BookingDetail["documents"][number];

const WORKING_STATUSES = ["ON_SITE", "AWAITING_APPROVAL", "DIAGNOSED", "IN_PROGRESS", "AWAITING_PARTS"];
const REPORTABLE_STATUSES = ["ON_SITE", "DIAGNOSED", "IN_PROGRESS", "AWAITING_PARTS"];

function Money({ minor, currency, strong }: { minor: number; currency: string; strong?: boolean }) {
  return <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{formatMoney(minor, currency)}</span>;
}

function QuoteVersionView({ v, docs, actions }: { v: Version; docs: Doc[]; actions?: ReactNode }) {
  const pdf = docs.find((d) => d.kind === "QUOTE_PDF" && d.repairQuoteVersionId === v.id && d.status === "READY");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{t("quote.version", { n: v.versionNo })}</span>
        <StatusBadge domain="quote" status={v.status} />
        {v.issuedAt ? <span className="text-xs text-muted">{t("quote.issuedOn", { date: formatDateTime(v.issuedAt) })}</span> : null}
        {v.validUntil && v.status === "ISSUED" ? <span className="text-xs text-muted">{t("quote.validUntil", { date: formatDate(v.validUntil) })}</span> : null}
      </div>
      {v.revisionReason ? (
        <p className="text-sm">
          <span className="font-semibold">{t("quote.revisionReason")} : </span>
          {v.revisionReason}
        </p>
      ) : null}
      <p className="whitespace-pre-line text-sm text-ink-soft">{v.scopeSummary}</p>
      <div className="overflow-x-auto rounded-lg border border-line" role="region" aria-label={t("quote.linesLabel", { n: v.versionNo })} tabIndex={0}>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-subtle text-left text-xs uppercase text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">{t("quote.editor.description")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("quote.editor.quantity")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("quote.editor.unitPrice")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("quote.editor.taxRate")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("quote.editor.lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {v.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted">{te("enums.lineKind", l.kind)}</span>
                  <span className="block">{l.description}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(l.quantityMilli)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.unitPriceMinor, v.currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRate(l.taxRateBp)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.totalMinor, v.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr>
              <td colSpan={4} className="px-3 pt-2 text-right text-muted">{t("quote.subtotal")}</td>
              <td className="px-3 pt-2 text-right"><Money minor={v.subtotalMinor} currency={v.currency} /></td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 text-right text-muted">{t("quote.tax")}</td>
              <td className="px-3 text-right"><Money minor={v.taxMinor} currency={v.currency} /></td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 pb-2 text-right font-semibold">{t("quote.total")}</td>
              <td className="px-3 pb-2 text-right"><Money minor={v.totalMinor} currency={v.currency} strong /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <DescriptionList
        items={[
          { label: t("quote.duration"), value: v.estimatedDurationMin ? durationLabel(v.estimatedDurationMin) : null },
          { label: t("quote.timing"), value: v.timingNote },
          { label: t("quote.exclusions"), value: v.exclusions },
          { label: t("quote.warranty"), value: v.warrantyTerms },
        ].filter((i) => i.value)}
      />
      {v.approval ? (
        <p className={`rounded-lg p-3 text-sm ${v.approval.decision === "APPROVED" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
          {t(v.approval.decision === "APPROVED" ? "quote.approvedLine" : "quote.rejectedLine", {
            date: formatDateTime(v.approval.decidedAt),
            amount: formatMoney(v.approval.amountMinor, v.approval.currency),
          })}
          {v.approval.reason ? ` — ${v.approval.reason}` : ""}
          <span className="mt-1 block font-mono text-[11px] opacity-80">{t("quote.hash", { hash: v.approval.snapshotHash.slice(0, 16) })}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {pdf ? (
          <a href={`/api/v1/documents/${pdf.id}/download`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            <FileDown aria-hidden className="size-4" /> {t("quote.pdf")}
          </a>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

function editorInitial(v: Version) {
  const toInput = (minor: number) => `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`;
  return {
    scopeSummary: v.scopeSummary,
    estimatedDurationMin: v.estimatedDurationMin,
    timingNote: v.timingNote ?? "",
    exclusions: v.exclusions ?? "",
    warrantyTerms: v.warrantyTerms ?? "",
    validDays: 7,
    lines: v.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: String(l.quantityMilli / 1000).replace(".", ","),
      unitPrice: toInput(l.unitPriceMinor),
      taxRate: String(l.taxRateBp / 100).replace(".", ","),
    })),
  };
}

/**
 * Shared booking / work-order view. What each party sees is decided by row-level security in
 * the database; this component only decides which actions to offer for the viewer's role.
 */
export function BookingView({
  detail,
  perspective,
  actor,
  payments,
  technicians,
  back,
  adminSlot,
}: {
  detail: BookingDetail;
  perspective: Perspective;
  actor: Actor;
  payments: Awaited<ReturnType<typeof listPayments>> | null;
  technicians: (TechnicianOption & { skillIds?: string[] })[] | null;
  back: { href: string; label: string };
  adminSlot?: ReactNode;
}) {
  const { booking, request, site, equipment, documents, plan } = detail;
  const wo = booking.workOrder;
  const customerWriter = perspective === "customer" && can.customerWrite(actor);
  const providerManager = perspective === "provider" && can.providerManage(actor);
  const worker = providerManager || perspective === "technician";
  const partyWriter = customerWriter || providerManager;
  const mySide = perspective === "customer" ? "CUSTOMER" : "PROVIDER";
  const now = Date.now();
  const today = localDateString(new Date());
  const pendingProposal = booking.reschedules.find((r) => r.status === "PENDING");
  const quotes = wo?.repairQuotes ?? [];
  const allVersions = quotes.flatMap((q) => q.versions);
  const hasScope = !!wo && (wo.maintenanceScopeAuthorized || allVersions.some((v) => v.status === "APPROVED"));
  const pendingQuote = allVersions.some((v) => v.status === "ISSUED");
  const counterpart = perspective === "customer" ? detail.providerName : detail.customerName;
  const start = booking.scheduledStart ?? booking.windowStart;
  const durationMin = booking.scheduledStart && booking.scheduledEnd ? Math.round((booking.scheduledEnd.getTime() - booking.scheduledStart.getTime()) / 60_000) : Math.max(15, booking.estimatedDurationMin ?? 60);
  const slotDefaults = {
    date: start ? localDateString(start) : addDaysToDateString(today, 1),
    start: start ? localTimeString(start) : "09:00",
    durationMin,
  };
  const categoryId = request?.equipmentCategoryId;
  const techOptions = technicians?.map((tech) => ({ ...tech, skilled: tech.skilled || (!!categoryId && !!tech.skillIds?.includes(categoryId)) })) ?? null;
  const reportPdf = documents.find((d) => d.kind === "REPORT_PDF" && d.status === "READY");
  const reportPhotos = wo?.report ? documents.filter((d) => d.reportId === wo.report!.id && d.kind === "PHOTO") : [];
  const fileDocs = documents.filter((d) => !["REPORT_PDF", "QUOTE_PDF"].includes(d.kind) && !(wo?.report && d.reportId === wo.report.id));
  const openDisputes = wo?.disputes.filter((d) => d.status === "OPEN" || d.status === "UNDER_REVIEW") ?? [];
  const cancellable = ["PENDING_CONFIRMATION", "CONFIRMED"].includes(booking.status) && (!wo || ["SCHEDULED", "EN_ROUTE"].includes(wo.status));
  const noShowPossible = booking.status === "CONFIRMED" && !!booking.scheduledStart && booking.scheduledStart.getTime() <= now && (!wo || ["SCHEDULED", "EN_ROUTE"].includes(wo.status));
  const reschedulable = booking.status === "CONFIRMED" && wo?.status === "SCHEDULED" && !pendingProposal;
  const endedAlert: Record<string, string | null> = {
    DECLINED: booking.declineReason,
    EXPIRED: null,
    CANCELLED: booking.cancelReason,
    NO_SHOW: booking.noShowNote,
  };

  return (
    <>
      <PageHeader
        title={`${booking.reference}${request ? ` · ${request.title}` : ""}`}
        back={back}
        meta={
          <>
            <StatusBadge domain="booking" status={booking.status} />
            {wo ? <StatusBadge domain="workOrder" status={wo.status} /> : null}
            {wo?.acknowledgment ? <StatusBadge domain="ack" status={wo.acknowledgment} /> : null}
            <Badge>{te("enums.offerKind", booking.kind)}</Badge>
          </>
        }
      />

      {booking.status === "PENDING_CONFIRMATION" && !providerManager ? (
        <Alert tone="warn" title={t("booking.pending.title")} className="mb-6">
          {t("booking.pending.body", { name: counterpart, date: formatDateTime(booking.confirmationDeadline) })}
        </Alert>
      ) : null}

      {booking.status in endedAlert ? (
        <Alert tone="warn" title={te("status.booking", booking.status)} className="mb-6">
          {endedAlert[booking.status] ? `${t("booking.reason")} : ${endedAlert[booking.status]}. ` : ""}
          {booking.status === "NO_SHOW" && booking.noShowSide ? `${t("booking.absentSide", { side: te("enums.partySide", booking.noShowSide) })} ` : ""}
          {booking.status === "CANCELLED" && booking.cancelledBySide ? `${t("booking.cancelledBy", { side: te("enums.partySide", booking.cancelledBySide) })} ` : ""}
          {perspective === "customer" && request ? (
            <Link href={`/client/demandes/${request.id}`} className="font-semibold underline">
              {t("booking.backToRequest")}
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {booking.status === "PENDING_CONFIRMATION" && providerManager && techOptions ? (
        <Card className="mb-6 border-warn-line">
          <CardHeader
            title={t("booking.confirm.title")}
            description={t("booking.confirm.intro", { date: formatDateTime(booking.confirmationDeadline), window: formatWindow(booking.windowStart, booking.windowEnd) })}
          />
          <CardBody className="space-y-4">
            <ConfirmBookingForm bookingId={booking.id} lockVersion={booking.lockVersion} technicians={techOptions} defaults={slotDefaults} />
            <div className="border-t border-line pt-4">
              <DeclineBookingButton bookingId={booking.id} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {pendingProposal ? (
        <Alert tone="info" title={t("booking.reschedule.pendingTitle")} className="mb-6">
          <p>
            {t("booking.reschedule.pendingBody", {
              side: te("enums.partySide", pendingProposal.proposedBySide),
              window: formatWindow(pendingProposal.startsAt, pendingProposal.endsAt),
            })}
            {pendingProposal.technicianName ? ` · ${t("booking.technician")} : ${pendingProposal.technicianName}` : ""}
          </p>
          <p className="mt-1">
            {t("booking.reason")} : {pendingProposal.reason}
          </p>
          <div className="mt-3">
            {partyWriter && pendingProposal.proposedBySide !== mySide ? <RespondRescheduleButtons proposalId={pendingProposal.id} technicianId={pendingProposal.technicianId ?? booking.technicianId} /> : null}
            {partyWriter && pendingProposal.proposedBySide === mySide ? <WithdrawRescheduleButton proposalId={pendingProposal.id} /> : null}
          </div>
        </Alert>
      ) : null}

      {adminSlot}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          {wo && ["CONFIRMED", "COMPLETED"].includes(booking.status) ? (
            <Card>
              <CardHeader title={t("work.title")} description={t(`work.statusHelp.${wo.status}`)} actions={<StatusBadge domain="workOrder" status={wo.status} />} />
              {worker && !["REPORT_SUBMITTED", "CANCELLED"].includes(wo.status) ? (
                <CardBody>
                  <WorkActionButtons workOrderId={wo.id} status={wo.status} lockVersion={wo.lockVersion} hasScope={hasScope} />
                  {wo.maintenanceScopeAuthorized ? <p className="mt-2 text-xs text-muted">{t("work.maintenanceScope")}</p> : null}
                </CardBody>
              ) : null}
            </Card>
          ) : null}

          {wo && (quotes.length > 0 || (worker && WORKING_STATUSES.includes(wo.status))) ? (
            <Card id="devis">
              <CardHeader title={t("quote.title")} description={perspective === "customer" ? t("quote.customerIntro") : t("quote.providerIntro")} />
              <CardBody className="space-y-6">
                {quotes.map((q) => {
                  const draft = q.versions.find((v) => v.status === "DRAFT");
                  const visible = q.versions.filter((v) => v.status !== "DRAFT");
                  const latest = visible[0];
                  const older = visible.slice(1);
                  const revisable = worker && WORKING_STATUSES.includes(wo.status) && !draft && latest && ["ISSUED", "REJECTED", "WITHDRAWN"].includes(latest.status);
                  return (
                    <section key={q.id} className="space-y-3 rounded-lg border border-line p-4">
                      <h3 className="font-semibold text-ink">{q.title}</h3>
                      {latest ? (
                        <QuoteVersionView
                          v={latest}
                          docs={documents}
                          actions={
                            <>
                              {latest.status === "ISSUED" && customerWriter && latest.snapshotHash ? (
                                <QuoteDecisionPanel versionId={latest.id} snapshotHash={latest.snapshotHash} totalMinor={latest.totalMinor} currency={latest.currency} />
                              ) : null}
                              {latest.status === "ISSUED" && perspective === "customer" && !customerWriter ? <p className="text-sm text-muted">{t("quote.viewerNote")}</p> : null}
                              {latest.status === "ISSUED" && worker ? <WithdrawQuoteButton versionId={latest.id} draft={false} /> : null}
                            </>
                          }
                        />
                      ) : null}
                      {draft && worker ? (
                        <details className="rounded-lg border border-dashed border-line-strong p-3" open={!latest}>
                          <summary className="cursor-pointer text-sm font-semibold text-brand">{t("quote.draftSummary", { n: draft.versionNo, total: formatMoney(draft.totalMinor, draft.currency) })}</summary>
                          <div className="mt-3 space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <IssueQuoteButton versionId={draft.id} />
                              <WithdrawQuoteButton versionId={draft.id} draft />
                            </div>
                            <QuoteEditor workOrderId={wo.id} repairQuoteId={q.id} draftVersionId={draft.id} revision={draft.versionNo > 1} initial={{ ...editorInitial(draft), revisionReason: draft.revisionReason ?? "" }} />
                          </div>
                        </details>
                      ) : null}
                      {revisable && latest ? (
                        <details className="rounded-lg border border-dashed border-line-strong p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-brand">{t("quote.revise")}</summary>
                          <div className="mt-3">
                            <QuoteEditor workOrderId={wo.id} repairQuoteId={q.id} revision initial={editorInitial(latest)} />
                          </div>
                        </details>
                      ) : null}
                      {older.length ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-muted">{t("quote.history", { n: older.length })}</summary>
                          <div className="mt-3 space-y-4 border-l-2 border-line pl-4">
                            {older.map((v) => (
                              <QuoteVersionView key={v.id} v={v} docs={documents} />
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </section>
                  );
                })}
                {quotes.length === 0 ? <p className="text-sm text-muted">{t("quote.none")}</p> : null}
                {worker && WORKING_STATUSES.includes(wo.status) ? (
                  <details className="rounded-lg border border-line bg-canvas p-3" open={quotes.length === 0 && wo.status === "ON_SITE"}>
                    <summary className="cursor-pointer text-sm font-semibold text-brand">{quotes.length === 0 ? t("quote.new") : t("quote.newChangeOrder")}</summary>
                    <div className="mt-3">
                      <QuoteEditor workOrderId={wo.id} repairQuoteId={null} />
                    </div>
                  </details>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {wo?.report ? (
            <Card id="rapport">
              <CardHeader
                title={t("report.title")}
                description={t("report.submittedBy", { name: wo.report.submittedByName, date: formatDateTime(wo.report.submittedAt) })}
                actions={
                  reportPdf ? (
                    <a href={`/api/v1/reports/${wo.report.id}/pdf`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                      <FileDown aria-hidden className="size-4" /> {t("report.pdf")}
                    </a>
                  ) : (
                    <span className="text-xs text-muted">{t("report.pdfPending")}</span>
                  )
                }
              />
              <CardBody className="space-y-4">
                {wo.report.repairDeclined ? <Alert tone="warn">{t("report.repairDeclined")}</Alert> : null}
                <DescriptionList
                  columns={1}
                  items={[
                    { label: t("report.findings"), value: wo.report.findings },
                    { label: t("report.workPerformed"), value: wo.report.workPerformed },
                    { label: t("report.partsUsed"), value: wo.report.partsUsed },
                    { label: t("report.recommendations"), value: wo.report.recommendations },
                    { label: t("report.nextServiceDate"), value: wo.report.nextServiceDate ? formatDate(wo.report.nextServiceDate) : null },
                    { label: t("report.approvedQuotes"), value: String(wo.report.approvedVersionIds.length) },
                  ].filter((i) => i.value)}
                />
                {reportPhotos.length ? <DocumentList docs={reportPhotos} /> : null}
                {wo.acknowledgment === "PENDING" && customerWriter ? (
                  <div className="space-y-2 rounded-lg bg-subtle p-3">
                    <p className="text-sm">{t("report.ack.intro")}</p>
                    <AcknowledgeReport workOrderId={wo.id} canDispute />
                  </div>
                ) : null}
                {wo.acknowledgment === "DISPUTED" && customerWriter && openDisputes.length === 0 ? <AcknowledgeReport workOrderId={wo.id} canDispute={false} /> : null}
                {wo.acknowledgment === "ACKNOWLEDGED" ? <p className="text-sm text-success">{t("report.ack.done", { date: formatDateTime(wo.acknowledgedAt) })}</p> : null}
                <p className="font-mono text-[11px] text-muted">{t("report.hash", { hash: wo.report.snapshotHash.slice(0, 16) })}</p>
              </CardBody>
            </Card>
          ) : wo && worker && REPORTABLE_STATUSES.includes(wo.status) ? (
            <Card id="rapport">
              <CardHeader title={t("report.form.title")} description={t("report.form.intro")} />
              <CardBody>
                <ReportForm
                  workOrderId={wo.id}
                  pendingQuote={pendingQuote}
                  photos={documents.filter((d) => d.kind === "PHOTO" && d.status === "READY" && d.ownerOrgId === actor.orgId && !d.reportId).map((d) => ({ id: d.id, name: d.originalName }))}
                />
              </CardBody>
            </Card>
          ) : null}

          {wo?.disputes.length ? (
            <Card id="litiges">
              <CardHeader title={t("dispute.title")} description={t("dispute.intro")} />
              <CardBody className="space-y-6">
                {wo.disputes.map((d) => {
                  const open = d.status === "OPEN" || d.status === "UNDER_REVIEW";
                  return (
                    <section key={d.id} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge domain="dispute" status={d.status} />
                        <span className="text-xs text-muted">{t("dispute.openedOn", { date: formatDateTime(d.createdAt) })}</span>
                      </div>
                      <ol className="space-y-2">
                        {d.events.map((e) => (
                          <li key={e.id} className="rounded-lg border border-line p-3 text-sm">
                            <p className="text-xs text-muted">
                              {e.actorName} · {te("enums.partySide", e.actorSide)} · {formatDateTime(e.createdAt)} · {te("enums.disputeEvent", e.type)}
                            </p>
                            {e.body ? <p className="mt-1 whitespace-pre-line">{e.body}</p> : null}
                          </li>
                        ))}
                      </ol>
                      {d.resolutionSummary ? (
                        <Alert tone="success" title={t("dispute.resolution")}>
                          {d.resolutionSummary}
                        </Alert>
                      ) : null}
                      {open && (partyWriter || perspective === "admin") ? <DisputeCommentForm disputeId={d.id} /> : null}
                      {open && customerWriter ? <WithdrawDisputeButton disputeId={d.id} /> : null}
                    </section>
                  );
                })}
              </CardBody>
            </Card>
          ) : null}

          {wo ? (
            <Card id="notes">
              <CardHeader title={t("notes.title")} description={t("notes.intro")} />
              <CardBody className="space-y-4">
                {wo.notes.length === 0 ? <p className="text-sm text-muted">{t("notes.empty")}</p> : null}
                <ul className="space-y-2">
                  {wo.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-line p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-semibold text-ink">{n.authorName}</span>
                        {formatDateTime(n.createdAt)}
                        <Badge tone={n.visibility === "SHARED" ? "info" : "neutral"}>{te("enums.noteVisibility", n.visibility)}</Badge>
                      </p>
                      <p className="mt-1 whitespace-pre-line">{n.body}</p>
                    </li>
                  ))}
                </ul>
                {(customerWriter || worker) && wo.status !== "CANCELLED" ? <NoteForm workOrderId={wo.id} side={mySide} /> : null}
              </CardBody>
            </Card>
          ) : null}

          {wo ? (
            <Card id="fichiers">
              <CardHeader title={t("booking.files.title")} description={t("booking.files.intro")} />
              <CardBody className="space-y-4">
                <DocumentList
                  docs={fileDocs.map((d) => ({
                    ...d,
                    canDelete: d.ownerOrgId === actor.orgId && perspective !== "technician" && perspective !== "admin" && !d.reportId && d.kind !== "PAYMENT_EVIDENCE",
                  }))}
                  emptyLabel={t("booking.files.empty")}
                />
                {(customerWriter || worker) && wo.status !== "CANCELLED" ? <DocumentUploader target={{ workOrderId: wo.id }} kind="PHOTO" allowShare={perspective === "customer"} defaultShare /> : null}
              </CardBody>
            </Card>
          ) : null}

          <Card id="historique">
            <CardHeader title={t("booking.timeline.title")} description={t("booking.timeline.intro")} />
            <CardBody>
              <ol className="relative space-y-4 border-l-2 border-line pl-5">
                {booking.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-[27px] top-1 grid size-3 place-items-center rounded-full border-2 border-brand bg-surface" />
                    <p className="text-sm font-semibold text-ink">{te("enums.jobEvent", e.type)}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(e.occurredAt)}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                      {e.actorSide ? ` (${te("enums.partySide", e.actorSide)})` : ""}
                    </p>
                    {e.note ? <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{e.note}</p> : null}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("booking.appointment")} actions={<CalendarDays aria-hidden className="size-5 text-muted" />} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={([
                  {
                    label: booking.scheduledStart ? t("booking.scheduled") : t("booking.requestedWindow"),
                    value: booking.scheduledStart ? formatWindow(booking.scheduledStart, booking.scheduledEnd) : formatWindow(booking.windowStart, booking.windowEnd),
                  },
                  { label: t("booking.technician"), value: booking.technicianName ?? t("booking.technicianTbd") },
                  { label: perspective === "customer" ? t("booking.provider") : t("booking.customer"), value: perspective === "admin" ? `${detail.customerName} → ${detail.providerName}` : counterpart },
                  { label: t("booking.offerTotal"), value: `${formatMoney(booking.offerVersion.totalMinor, booking.offerVersion.currency)} (${t("quote.version", { n: booking.offerVersion.versionNo })})` },
                  booking.status === "PENDING_CONFIRMATION" ? { label: t("booking.deadline"), value: formatDateTime(booking.confirmationDeadline) } : null,
                  request ? { label: t("booking.request"), value: perspective === "customer" ? <Link className="text-brand hover:underline" href={`/client/demandes/${request.id}`}>{request.reference}</Link> : request.reference } : null,
                  wo ? { label: t("booking.workOrder"), value: wo.reference } : null,
                ] as ({ label: string; value: ReactNode } | null)[]).filter((i) => i !== null)}
              />
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand">{t("booking.offerTerms")}</summary>
                <div className="mt-2 space-y-2 text-sm">
                  <p className="whitespace-pre-line">{booking.offerVersion.scope}</p>
                  <DescriptionList
                    columns={1}
                    items={[
                      { label: t("quote.exclusions"), value: booking.offerVersion.exclusions },
                      { label: t("booking.cancellationTerms"), value: booking.offerVersion.cancellationTerms },
                      { label: t("quote.warranty"), value: booking.offerVersion.warrantyTerms },
                      { label: t("booking.taxNote"), value: booking.offerVersion.taxNote },
                    ].filter((i) => i.value)}
                  />
                </div>
              </details>
            </CardBody>
          </Card>

          {partyWriter && (reschedulable || cancellable || noShowPossible) ? (
            <Card>
              <CardHeader title={t("booking.actions")} />
              <CardBody className="flex flex-wrap gap-2">
                {reschedulable ? <ProposeRescheduleButton bookingId={booking.id} technicians={providerManager ? (techOptions ?? undefined) : undefined} defaults={{ ...slotDefaults, technicianId: booking.technicianId }} /> : null}
                {noShowPossible ? <NoShowButton bookingId={booking.id} absentSide={perspective === "customer" ? "PROVIDER" : "CUSTOMER"} /> : null}
                {cancellable ? <CancelBookingButton bookingId={booking.id} terms={booking.offerVersion.cancellationTerms} /> : null}
              </CardBody>
            </Card>
          ) : null}

          {site ? (
            <Card>
              <CardHeader title={t("booking.site")} actions={<MapPin aria-hidden className="size-5 text-muted" />} />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    { label: t("booking.siteName"), value: perspective === "customer" ? <Link className="text-brand hover:underline" href={`/client/sites/${site.id}`}>{site.name}</Link> : site.name },
                    { label: t("booking.address"), value: `${site.addressLine}, ${site.city}` },
                    { label: t("booking.access"), value: site.accessNotes ?? (perspective === "customer" ? null : t("booking.accessHidden")) },
                    { label: t("booking.contact"), value: site.contactName || site.contactPhone ? [site.contactName, site.contactPhone].filter(Boolean).join(" · ") : null },
                  ].filter((i) => i.value)}
                />
              </CardBody>
            </Card>
          ) : null}

          {equipment ? (
            <Card>
              <CardHeader title={t("booking.equipment")} actions={<Refrigerator aria-hidden className="size-5 text-muted" />} />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    { label: t("booking.equipmentLabel"), value: perspective === "customer" ? <Link className="text-brand hover:underline" href={`/client/equipements/${equipment.id}`}>{equipment.label}</Link> : equipment.label },
                    { label: t("booking.category"), value: request?.equipmentCategory.labelFr },
                    { label: t("booking.brandModel"), value: [equipment.brand, equipment.model].filter(Boolean).join(" ") || null },
                    { label: t("booking.serial"), value: equipment.serialNumber },
                    { label: t("booking.symptoms"), value: request?.symptoms },
                  ].filter((i) => i.value)}
                />
              </CardBody>
            </Card>
          ) : null}

          {payments ? (
            <Card id="paiements">
              <CardHeader title={t("payment.title")} description={t("payment.intro")} />
              <CardBody className="space-y-4">
                <dl className="grid gap-1 text-sm">
                  {[
                    [t("payment.offerTotal"), payments.summary.offerTotalMinor],
                    [t("payment.approvedRepairs"), payments.summary.approvedRepairsMinor],
                    [t("payment.agreedTotal"), payments.summary.agreedTotalMinor],
                    [t("payment.confirmed"), payments.summary.confirmedMinor],
                    [t("payment.reportedPending"), payments.summary.reportedPendingMinor],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between gap-4">
                      <dt className="text-muted">{label}</dt>
                      <dd className="tabular-nums">{formatMoney(value as number, payments.summary.currency)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
                    <dt>{t("payment.outstanding")}</dt>
                    <dd className="tabular-nums">{formatMoney(payments.summary.outstandingMinor, payments.summary.currency)}</dd>
                  </div>
                </dl>
                {payments.payments.length ? (
                  <ul className="divide-y divide-line">
                    {payments.payments.map((p) => (
                      <li key={p.id} className="space-y-1 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
                          <StatusBadge domain="payment" status={p.status} />
                        </div>
                        <p className="text-xs text-muted">
                          {te("enums.paymentMethod", p.method)} · {t("payment.paidOnShort", { date: formatDate(p.paidOn) })} · {te("enums.partySide", p.reportedSide)}
                          {p.externalReference ? ` · ${p.externalReference}` : ""}
                        </p>
                        {p.rejectionReason ? <p className="text-xs text-danger">{p.rejectionReason}</p> : null}
                        {p.reversalReason ? <p className="text-xs text-danger">{p.reversalReason}</p> : null}
                        {p.evidenceDocumentId ? (
                          <a className="text-xs font-semibold text-brand hover:underline" href={`/api/v1/documents/${p.evidenceDocumentId}/download`}>
                            {t("payment.viewEvidence")}
                          </a>
                        ) : null}
                        {providerManager ? <PaymentDecision paymentId={p.id} status={p.status} /> : null}
                        {perspective === "admin" && p.status === "CONFIRMED" ? <PaymentDecision paymentId={p.id} status={p.status} asAdmin /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t("payment.none")}</p>
                )}
                {partyWriter && ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(booking.status) ? (
                  <RecordPaymentButton bookingId={booking.id} workOrderId={wo?.id ?? null} side={mySide} outstandingMinor={payments.summary.outstandingMinor} today={today} />
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {booking.status === "COMPLETED" && perspective !== "technician" ? (
            <Card id="avis">
              <CardHeader title={t("review.title")} />
              <CardBody className="space-y-3">
                {booking.review ? (
                  <>
                    <p className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{t("review.ratingValue", { n: booking.review.rating })}</span>
                      <StatusBadge domain="review" status={booking.review.status} />
                    </p>
                    {booking.review.comment ? <p className="whitespace-pre-line text-sm">{booking.review.comment}</p> : null}
                    {booking.review.response && !booking.review.response.hidden ? (
                      <div className="rounded-lg bg-subtle p-3 text-sm">
                        <p className="text-xs font-semibold text-muted">{t("review.providerResponse")}</p>
                        <p className="whitespace-pre-line">{booking.review.response.body}</p>
                      </div>
                    ) : null}
                    {providerManager && !booking.review.response && booking.review.status === "PUBLISHED" ? <ReviewResponseButton reviewId={booking.review.id} /> : null}
                  </>
                ) : customerWriter ? (
                  <>
                    <p className="text-sm text-muted">{t("review.intro")}</p>
                    <ReviewForm bookingId={booking.id} />
                  </>
                ) : (
                  <p className="text-sm text-muted">{t("review.none")}</p>
                )}
              </CardBody>
            </Card>
          ) : null}

          {plan || (providerManager && booking.status === "COMPLETED") ? (
            <Card>
              <CardHeader title={t("booking.plan.title")} actions={<History aria-hidden className="size-5 text-muted" />} />
              <CardBody className="space-y-2 text-sm">
                {plan ? (
                  <>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{plan.title}</span>
                      <StatusBadge domain="plan" status={plan.status} />
                    </p>
                    <p className="text-muted">{t("booking.plan.every", { n: plan.intervalMonths, date: formatDate(plan.nextDueDate) })}</p>
                    <Link href={perspective === "customer" ? "/client/plans" : "/prestataire/plans"} className="font-semibold text-brand hover:underline">
                      {t("booking.plan.open")}
                    </Link>
                  </>
                ) : (
                  <Link href={`/prestataire/plans?equipement=${booking.equipmentId}`} className="font-semibold text-brand hover:underline">
                    {t("booking.plan.propose")}
                  </Link>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
