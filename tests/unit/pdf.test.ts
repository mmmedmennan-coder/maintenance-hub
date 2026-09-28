import { describe, expect, it } from "vitest";
import { renderQuotePdf, renderReportPdf } from "@/server/pdf/render";

describe("server-generated PDFs", () => {
  it("renders a service report with French text and the snapshot hash", async () => {
    const pdf = await renderReportPdf({
      appName: "Maintenance Hub",
      workOrderReference: "INT-000001",
      bookingReference: "RDV-000001",
      customerName: "Supérette (test)",
      providerName: "Froid (test)",
      siteName: "Agdal",
      siteCity: "Rabat",
      equipment: "Chambre froide",
      technicianName: "Ahmed",
      scheduledStart: new Date("2026-09-28T09:00:00Z"),
      submittedAt: new Date("2026-09-28T11:00:00Z"),
      submittedByName: "Ahmed",
      findings: "Évaporateur encrassé — température à +3 °C après intervention.",
      workPerformed: "Nettoyage.",
      partsUsed: null,
      recommendations: null,
      nextServiceDate: null,
      repairDeclined: false,
      approvedScopes: [],
      photos: [],
      snapshotHash: "a".repeat(64),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
  it("renders a repair quote", async () => {
    const pdf = await renderQuotePdf({
      appName: "Maintenance Hub",
      title: "Devis de réparation",
      versionNo: 2,
      workOrderReference: "INT-000001",
      customerName: "Client",
      providerName: "Prestataire",
      equipment: "Vitrine",
      issuedAt: new Date("2026-09-28T10:00:00Z"),
      validUntil: new Date("2026-10-05T10:00:00Z"),
      scopeSummary: "Remplacement du moteur.",
      estimatedDuration: "2 h",
      timingNote: null,
      lines: [{ kind: "PART", description: "Moteur", quantityMilli: 1000, unitPriceMinor: 42000, taxRateBp: 2000, totalMinor: 50400 }],
      subtotalMinor: 42000,
      taxMinor: 8400,
      totalMinor: 50400,
      currency: "MAD",
      exclusions: null,
      warrantyTerms: null,
      snapshotHash: "b".repeat(64),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
