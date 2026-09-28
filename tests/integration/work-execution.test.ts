import { beforeAll, describe, expect, it } from "vitest";
import { workerDb } from "@/server/db/clients";
import { withActor } from "@/server/db/context";
import { idempotent } from "@/server/lib/infra";
import { authorizeDownload, finalizeUpload, initUpload } from "@/server/modules/documents";
import { adminDisputeAction } from "@/server/modules/feedback";
import { paymentSummary, recordPayment, updatePayment } from "@/server/modules/payments";
import { decideRepairQuote, issueRepairQuote, performWorkAction, respondToReport, saveRepairQuoteDraft, submitReport } from "@/server/modules/work";
import { JPEG_8x8 as PNG } from "../fixtures";
import { confirmedBooking } from "./flows";
import { drainOutbox, expectCode, inDays, makeAdmin, makeCustomer, makeProvider, shiftBookingToSoon } from "./helpers";


const quoteInput = (unitPrice: number, revisionReason: string | null = null) => ({
  title: undefined,
  scopeSummary: "Remplacement du ventilateur du condenseur et contrôle de charge.",
  estimatedDurationMin: 120,
  timingNote: "Pièce disponible sous 48 h",
  exclusions: "Recharge de gaz non incluse.",
  warrantyTerms: "Pièce garantie 6 mois.",
  validDays: 7,
  revisionReason,
  lines: [
    { kind: "PART" as const, description: "Ventilateur condenseur 230 V", quantity: 1000, unitPrice, taxRate: 2000 },
    { kind: "LABOR" as const, description: "Main-d'œuvre", quantity: 1500, unitPrice: 20_000, taxRate: 2000 },
  ],
});

describe("diagnosis, repair approval, report, dispute and payments", () => {
  let customer: Awaited<ReturnType<typeof makeCustomer>>;
  let intruder: Awaited<ReturnType<typeof makeCustomer>>;
  let provider: Awaited<ReturnType<typeof makeProvider>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    customer = await makeCustomer("Restaurant");
    intruder = await makeCustomer("Intrus");
    provider = await makeProvider("Réparation");
    admin = await makeAdmin();
  });

  it("changed scope needs a new approval; history and totals stay exact; report + dispute + payments are separate", async () => {
    const date = inDays(2);
    const job = await confirmedBooking(customer, provider, date, "09:00");
    await shiftBookingToSoon(job.bookingId);
    const tech = provider.technicians[0]!.actor;
    const wo = () => withActor(tech, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: job.workOrderId } }));

    await withActor(tech, async (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "START_TRAVEL", note: null, expectedLockVersion: (await wo()).lockVersion }));
    await withActor(tech, async (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "ARRIVE", note: null, expectedLockVersion: (await wo()).lockVersion }));
    // No approved scope yet: work cannot start (service check AND database trigger).
    await expectCode(
      withActor(tech, async (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "START_WORK", note: null, expectedLockVersion: (await wo()).lockVersion })),
      "INVALID_TRANSITION",
    );
    await expectCode(withActor(tech, (tx) => tx.workOrder.update({ where: { id: job.workOrderId }, data: { status: "IN_PROGRESS" } })), "INVALID_TRANSITION");

    // Quote v1 issued → customer approves with the exact snapshot hash.
    const draft1 = await withActor(tech, (tx) => saveRepairQuoteDraft(tx, tech, job.workOrderId, null, quoteInput(45_000)));
    expect(draft1.subtotalMinor).toBe(45_000 + 30_000);
    expect(draft1.taxMinor).toBe(15_000);
    // Customers cannot see drafts.
    expect(await withActor(customer.owner, (tx) => tx.repairQuoteVersion.count({ where: { id: draft1.versionId } }))).toBe(0);
    const issued1 = await withActor(tech, (tx) => issueRepairQuote(tx, tech, draft1.versionId));
    // Technician cannot approve customer costs.
    await expectCode(
      withActor(tech, (tx) => decideRepairQuote(tx, tech, draft1.versionId, { decision: "APPROVED", expectedSnapshotHash: issued1.snapshotHash, reason: null })),
      "FORBIDDEN",
    );
    // Read-only customer member cannot approve either.
    await expectCode(
      withActor(customer.viewer, (tx) => decideRepairQuote(tx, customer.viewer, draft1.versionId, { decision: "APPROVED", expectedSnapshotHash: issued1.snapshotHash, reason: null })),
      "FORBIDDEN",
    );
    // Provider revises before the decision → v1 superseded; approving the stale version fails.
    const draft2 = await withActor(tech, (tx) => saveRepairQuoteDraft(tx, tech, job.workOrderId, draft1.repairQuoteId, quoteInput(50_000, "Prix fournisseur mis à jour")));
    const issued2 = await withActor(tech, (tx) => issueRepairQuote(tx, tech, draft2.versionId));
    await expectCode(
      withActor(customer.owner, (tx) => decideRepairQuote(tx, customer.owner, draft1.versionId, { decision: "APPROVED", expectedSnapshotHash: issued1.snapshotHash, reason: null })),
      "INVALID_TRANSITION",
    );
    // A stale hash (screen showing old content) is a version conflict.
    await expectCode(
      withActor(customer.owner, (tx) => decideRepairQuote(tx, customer.owner, draft2.versionId, { decision: "APPROVED", expectedSnapshotHash: issued1.snapshotHash, reason: null })),
      "VERSION_CONFLICT",
    );
    const approve = () =>
      withActor(customer.owner, (tx) =>
        idempotent(tx, customer.owner, "quote.decide", `approve-${draft2.versionId}`, { d: "APPROVED" }, () =>
          decideRepairQuote(tx, customer.owner, draft2.versionId, { decision: "APPROVED", expectedSnapshotHash: issued2.snapshotHash, reason: null }),
        ),
      );
    const a1 = await approve();
    const a2 = await approve();
    expect(a2.replayed).toBe(true);
    expect(a2.body.approvalId).toBe(a1.body.approvalId);
    const approvals = await withActor(customer.owner, (tx) => tx.approval.findMany({ where: { workOrderId: job.workOrderId } }));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.amountMinor).toBe(50_000 + 30_000 + 16_000);
    expect(approvals[0]!.snapshotHash).toBe(issued2.snapshotHash);

    // Work may now start; a change order needs its own approval and does not erase v2.
    await withActor(tech, async (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "START_WORK", note: null, expectedLockVersion: (await wo()).lockVersion }));
    const change = await withActor(tech, (tx) =>
      saveRepairQuoteDraft(tx, tech, job.workOrderId, null, { ...quoteInput(10_000), lines: [{ kind: "PART", description: "Joint de porte", quantity: 1000, unitPrice: 10_000, taxRate: 2000 }] }),
    );
    const changeIssued = await withActor(tech, (tx) => issueRepairQuote(tx, tech, change.versionId));
    expect((await wo()).status).toBe("AWAITING_APPROVAL");
    await withActor(customer.owner, (tx) =>
      decideRepairQuote(tx, customer.owner, change.versionId, { decision: "REJECTED", expectedSnapshotHash: changeIssued.snapshotHash, reason: "Pas nécessaire pour l'instant" }),
    );
    const v2 = await withActor(customer.owner, (tx) => tx.repairQuoteVersion.findUniqueOrThrow({ where: { id: draft2.versionId } }));
    expect(v2.status).toBe("APPROVED");
    // Approved versions are immutable (database guard).
    await expectCode(withActor(tech, (tx) => tx.repairQuoteVersion.update({ where: { id: draft2.versionId }, data: { totalMinor: 1 } })), "VERSION_CONFLICT");

    // Photo upload: content is sniffed; a fake image is rejected and stays FAILED.
    const up = await withActor(tech, (tx) => initUpload(tx, tech, { kind: "PHOTO", fileName: "ventilateur.jpg", sizeBytes: PNG.length, workOrderId: job.workOrderId, shareWithProviders: false }));
    const fin = await withActor(tech, (tx) => finalizeUpload(tx, tech, up.documentId, PNG));
    expect(fin.ok).toBe(true);
    const bad = await withActor(tech, (tx) => initUpload(tx, tech, { kind: "PHOTO", fileName: "photo.png", sizeBytes: 20, workOrderId: job.workOrderId, shareWithProviders: false }));
    const badResult = await withActor(tech, (tx) => finalizeUpload(tx, tech, bad.documentId, Buffer.from("<script>alert(1)</script>")));
    expect(badResult.ok).toBe(false);
    expect((await withActor(tech, (tx) => tx.document.findUniqueOrThrow({ where: { id: bad.documentId } }))).status).toBe("FAILED");

    // Report.
    await withActor(tech, (tx) =>
      submitReport(tx, tech, job.workOrderId, {
        findings: "Ventilateur du condenseur bloqué, surchauffe du groupe.",
        workPerformed: "Remplacement du ventilateur, nettoyage du condenseur, contrôle des températures.",
        partsUsed: "Ventilateur 230 V",
        recommendations: "Nettoyage du condenseur tous les 6 mois.",
        nextServiceDate: inDays(180),
        photoDocumentIds: [up.documentId],
      }),
    );
    await drainOutbox();
    const afterReport = await withActor(customer.owner, async (tx) => ({
      wo: await tx.workOrder.findUniqueOrThrow({ where: { id: job.workOrderId } }),
      booking: await tx.booking.findUniqueOrThrow({ where: { id: job.bookingId } }),
      request: await tx.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } }),
      pdfs: await tx.document.findMany({ where: { workOrderId: job.workOrderId, kind: { in: ["REPORT_PDF", "QUOTE_PDF"] } } }),
    }));
    expect(afterReport.wo.status).toBe("REPORT_SUBMITTED");
    expect(afterReport.wo.acknowledgment).toBe("PENDING");
    expect(afterReport.booking.status).toBe("COMPLETED");
    expect(afterReport.request.status).toBe("CLOSED");
    expect(afterReport.pdfs.filter((d) => d.kind === "REPORT_PDF")).toHaveLength(1);
    expect(afterReport.pdfs.filter((d) => d.kind === "QUOTE_PDF").length).toBeGreaterThanOrEqual(2);
    // Re-processing does not create duplicate PDFs.
    const { generateReportPdf } = await import("@/server/worker/handlers");
    const report = await withActor(customer.owner, (tx) => tx.serviceReport.findUniqueOrThrow({ where: { workOrderId: job.workOrderId } }));
    await generateReportPdf(workerDb(), report.id);
    expect(await withActor(customer.owner, (tx) => tx.document.count({ where: { reportId: report.id, kind: "REPORT_PDF" } }))).toBe(1);
    // Private attachment access after processing: parties yes, another customer no.
    const pdfId = afterReport.pdfs.find((d) => d.kind === "REPORT_PDF")!.id;
    await expect(withActor(customer.owner, (tx) => authorizeDownload(tx, pdfId))).resolves.toBeTruthy();
    await expect(withActor(provider.manager, (tx) => authorizeDownload(tx, pdfId))).resolves.toBeTruthy();
    await expectCode(withActor(intruder.owner, (tx) => authorizeDownload(tx, pdfId)), "NOT_FOUND");
    await expectCode(withActor(intruder.owner, (tx) => authorizeDownload(tx, up.documentId)), "NOT_FOUND");
    // Unassigned technician cannot fetch the job's photo.
    await expectCode(withActor(provider.technicians[1]!.actor, (tx) => authorizeDownload(tx, up.documentId)), "NOT_FOUND");

    // Dispute: history preserved, work status and payments untouched.
    const disputed = await withActor(customer.owner, (tx) =>
      respondToReport(tx, customer.owner, job.workOrderId, { decision: "DISPUTE", reason: "Le froid n'est toujours pas stable le soir." }),
    );
    expect(disputed.acknowledgment).toBe("DISPUTED");
    await withActor(admin, (tx) => adminDisputeAction(tx, admin, disputed.disputeId!, { action: "UNDER_REVIEW", body: "Nous contactons les deux parties." }));
    await withActor(admin, (tx) => adminDisputeAction(tx, admin, disputed.disputeId!, { action: "RESOLVE", body: "Le prestataire repasse gratuitement vérifier la sonde." }));
    const disputeState = await withActor(customer.owner, async (tx) => ({
      dispute: await tx.dispute.findUniqueOrThrow({ where: { id: disputed.disputeId! }, include: { events: true } }),
      wo: await tx.workOrder.findUniqueOrThrow({ where: { id: job.workOrderId } }),
      report: await tx.serviceReport.count({ where: { workOrderId: job.workOrderId } }),
    }));
    expect(disputeState.dispute.status).toBe("RESOLVED");
    expect(disputeState.dispute.events.map((e) => e.type)).toEqual(["OPENED", "STATUS_CHANGED", "RESOLVED"]);
    expect(disputeState.wo.status).toBe("REPORT_SUBMITTED");
    expect(disputeState.wo.acknowledgment).toBe("DISPUTED");
    expect(disputeState.report).toBe(1);
    // After resolution the customer may acknowledge; the job is still not "paid".
    await withActor(customer.owner, (tx) => respondToReport(tx, customer.owner, job.workOrderId, { decision: "ACKNOWLEDGE", reason: null }));

    // Payments: reported ≠ confirmed; partial payments; reversal restores the balance.
    const agreed = 35_000 + 7_000 + 96_000; // offer (callout+diag, 20 % tax) + approved v2 total
    let summary = await withActor(customer.owner, (tx) => paymentSummary(tx, job.bookingId));
    expect(summary.agreedTotalMinor).toBe(agreed);
    expect(summary.outstandingMinor).toBe(agreed);
    const pay = (amount: number, key: string) =>
      withActor(customer.owner, (tx) =>
        idempotent(tx, customer.owner, "payment.record", key, { amount }, () =>
          recordPayment(tx, customer.owner, job.bookingId, { amount, method: "BANK_TRANSFER", paidOn: inDays(0), externalReference: "VIR-1", note: null, evidenceDocumentId: null }),
        ),
      );
    const p1 = await pay(50_000, "pay-key-000001");
    const p1Again = await pay(50_000, "pay-key-000001");
    expect(p1Again.body.paymentId).toBe(p1.body.paymentId);
    await expectCode(pay(60_000, "pay-key-000001"), "IDEMPOTENCY_KEY_REUSED");
    summary = await withActor(customer.owner, (tx) => paymentSummary(tx, job.bookingId));
    expect(summary.reportedPendingMinor).toBe(50_000);
    expect(summary.confirmedMinor).toBe(0);
    expect(summary.outstandingMinor).toBe(agreed);
    // The payer cannot confirm its own report — neither via the service nor directly in SQL.
    await expectCode(withActor(customer.owner, (tx) => updatePayment(tx, customer.owner, p1.body.paymentId, { action: "CONFIRM", reason: null })), "NOT_FOUND");
    const direct = await withActor(customer.owner, (tx) => tx.paymentRecord.updateMany({ where: { id: p1.body.paymentId }, data: { status: "CONFIRMED" } }));
    expect(direct.count).toBe(0);
    await withActor(provider.manager, (tx) => updatePayment(tx, provider.manager, p1.body.paymentId, { action: "CONFIRM", reason: null }));
    const p2 = await withActor(provider.manager, (tx) =>
      recordPayment(tx, provider.manager, job.bookingId, { amount: 30_000, method: "CASH", paidOn: inDays(0), externalReference: null, note: "Espèces sur site", evidenceDocumentId: null }),
    );
    summary = await withActor(customer.owner, (tx) => paymentSummary(tx, job.bookingId));
    expect(summary.confirmedMinor).toBe(80_000);
    expect(summary.outstandingMinor).toBe(agreed - 80_000);
    await withActor(provider.manager, (tx) => updatePayment(tx, provider.manager, p2.paymentId, { action: "REVERSE", reason: "Billet refusé par la banque" }));
    summary = await withActor(customer.owner, (tx) => paymentSummary(tx, job.bookingId));
    expect(summary.confirmedMinor).toBe(50_000);
    expect(summary.reversedMinor).toBe(30_000);
    const history = await withActor(customer.owner, (tx) => tx.paymentEvent.findMany({ where: { bookingId: job.bookingId }, orderBy: { createdAt: "asc" } }));
    expect(history.map((h) => h.type)).toEqual(["REPORTED", "CONFIRMED", "RECORDED_BY_PAYEE", "REVERSED"]);
    // Technicians have no access to finance.
    expect(await withActor(tech, (tx) => tx.paymentRecord.count({ where: { bookingId: job.bookingId } }))).toBe(0);
  });

  it("diagnostic-only job completes when the customer declines the repair", async () => {
    const date = inDays(3);
    const job = await confirmedBooking(customer, provider, date, "15:00", "DIAGNOSTIC", 1);
    await shiftBookingToSoon(job.bookingId, 90);
    const tech = provider.technicians[1]!.actor;
    const lock = async () => (await withActor(tech, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: job.workOrderId } }))).lockVersion;
    await withActor(tech, async (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "ARRIVE", note: null, expectedLockVersion: await lock() }));
    const draft = await withActor(tech, (tx) => saveRepairQuoteDraft(tx, tech, job.workOrderId, null, quoteInput(90_000)));
    const issued = await withActor(tech, (tx) => issueRepairQuote(tx, tech, draft.versionId));
    // Report is blocked while a quote awaits the decision.
    await expectCode(
      withActor(tech, (tx) => submitReport(tx, tech, job.workOrderId, { findings: "Compresseur en fin de vie.", workPerformed: "Diagnostic uniquement.", partsUsed: null, recommendations: null, nextServiceDate: null, photoDocumentIds: [] })),
      "INVALID_TRANSITION",
    );
    await withActor(customer.owner, (tx) => decideRepairQuote(tx, customer.owner, draft.versionId, { decision: "REJECTED", expectedSnapshotHash: issued.snapshotHash, reason: "Remplacement de l'équipement prévu" }));
    await withActor(tech, (tx) =>
      submitReport(tx, tech, job.workOrderId, { findings: "Compresseur en fin de vie.", workPerformed: "Diagnostic uniquement.", partsUsed: null, recommendations: "Remplacer l'équipement.", nextServiceDate: null, photoDocumentIds: [] }),
    );
    const state = await withActor(customer.owner, async (tx) => ({
      report: await tx.serviceReport.findUniqueOrThrow({ where: { workOrderId: job.workOrderId } }),
      booking: await tx.booking.findUniqueOrThrow({ where: { id: job.bookingId } }),
      summary: await paymentSummary(tx, job.bookingId),
    }));
    expect(state.report.repairDeclined).toBe(true);
    expect(state.booking.status).toBe("COMPLETED");
    expect(state.summary.agreedTotalMinor).toBe(42_000);
    expect(state.summary.approvedRepairsMinor).toBe(0);
  });
});
