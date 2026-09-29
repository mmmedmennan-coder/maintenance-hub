import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { photoForPdf } from "@/server/pdf/images";
import { renderQuotePdf, renderReportPdf } from "@/server/pdf/render";

const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const sample = (format: "png" | "webp" | "jpeg", width = 64, height = 48) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 120, b: 110, alpha: 0.5 } } })
    .toFormat(format)
    .toBuffer();

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
  it("converts PNG and WebP photos to bounded, metadata-free JPEG and refuses undecodable files", async () => {
    for (const format of ["png", "webp", "jpeg"] as const) {
      const out = await photoForPdf(await sample(format));
      expect(out?.subarray(0, 3)).toEqual(JPEG_SOI);
    }
    const large = await photoForPdf(await sample("png", 3000, 2000));
    const largeMeta = await sharp(large!).metadata();
    expect(largeMeta).toMatchObject({ width: 1200, height: 800, format: "jpeg" });
    expect(largeMeta.exif).toBeUndefined();
    const withGps = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ffffff" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "private" } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    expect((await sharp((await photoForPdf(withGps))!).metadata()).exif).toBeUndefined();
    expect(await photoForPdf(Buffer.from("ceci n'est pas une image"))).toBeNull();
    const truncated = (await sample("png", 400, 400)).subarray(0, 200);
    expect(await photoForPdf(truncated)).toBeNull();
  });
  it("embeds converted photos in the report", async () => {
    const base = {
      appName: "Maintenance Hub", workOrderReference: "INT-000002", bookingReference: "RDV-000002", customerName: "Client", providerName: "Prestataire",
      siteName: "Agdal", siteCity: "Rabat", equipment: "Vitrine", technicianName: "Ahmed", scheduledStart: new Date("2026-09-28T09:00:00Z"),
      submittedAt: new Date("2026-09-28T11:00:00Z"), submittedByName: "Ahmed", findings: "Constat.", workPerformed: "Travaux.", partsUsed: null,
      recommendations: null, nextServiceDate: null, repairDeclined: false, approvedScopes: [], snapshotHash: "c".repeat(64),
    };
    const photo = await photoForPdf(await sample("webp", 800, 600));
    const without = await renderReportPdf({ ...base, photos: [{ name: "vitrine.webp", data: null }] });
    const withPhoto = await renderReportPdf({ ...base, photos: [{ name: "vitrine.webp", data: photo }] });
    expect(withPhoto.includes(Buffer.from("/Subtype /Image"))).toBe(true);
    expect(without.includes(Buffer.from("/Subtype /Image"))).toBe(false);
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
