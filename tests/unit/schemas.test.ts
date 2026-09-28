import { describe, expect, it } from "vitest";
import { offerDraftSchema, paymentSchema, quoteDecisionSchema, repairQuoteSchema, reportSchema, serviceHoursSchema, siteSchema, staffInviteSchema } from "@/lib/schemas";

describe("input contracts shared by forms and the API", () => {
  it("service hours accept closed days (partial week)", () => {
    expect(serviceHoursSchema.safeParse({ "1": [480, 1080] }).success).toBe(true);
    expect(serviceHoursSchema.safeParse({ "1": [1080, 480] }).success).toBe(false);
    expect(serviceHoursSchema.safeParse({ "8": [480, 1080] }).success).toBe(false);
  });
  it("offer drafts convert money and reject inverted windows", () => {
    const base = { kind: "DIAGNOSTIC", scope: "Diagnostic complet du circuit.", calloutFee: "", serviceFee: "250", taxRate: "20", taxNote: "", windowDate: "2026-10-01", windowStart: "09:00", windowEnd: "12:00", estimatedDurationMin: "60", exclusions: "", cancellationTerms: "Sans frais 24 h avant.", warrantyTerms: "", validDays: "7" };
    const parsed = offerDraftSchema.parse(base);
    expect(parsed.calloutFee).toBeNull();
    expect(parsed.serviceFee).toBe(25000);
    expect(parsed.taxRate).toBe(2000);
    expect(offerDraftSchema.safeParse({ ...base, windowStart: "13:00" }).success).toBe(false);
  });
  it("repair quotes need at least one valid line", () => {
    const quote = { scopeSummary: "Remplacement du ventilateur.", validDays: 7, lines: [{ kind: "PART", description: "Ventilateur", quantity: "1", unitPrice: "420", taxRate: "20" }] };
    expect(repairQuoteSchema.parse(quote).lines[0]).toMatchObject({ quantity: 1000, unitPrice: 42000, taxRate: 2000 });
    expect(repairQuoteSchema.safeParse({ ...quote, lines: [] }).success).toBe(false);
  });
  it("quote decisions must carry the displayed snapshot hash", () => {
    expect(quoteDecisionSchema.safeParse({ decision: "APPROVED", expectedSnapshotHash: "a".repeat(64) }).success).toBe(true);
    expect(quoteDecisionSchema.safeParse({ decision: "APPROVED", expectedSnapshotHash: "short" }).success).toBe(false);
  });
  it("payments must be positive and reports need findings", () => {
    expect(paymentSchema.safeParse({ amount: "0", method: "CASH", paidOn: "2026-09-01" }).success).toBe(false);
    expect(paymentSchema.parse({ amount: "450,50", method: "CASH", paidOn: "2026-09-01" }).amount).toBe(45050);
    expect(reportSchema.safeParse({ findings: "court", workPerformed: "Nettoyage" }).success).toBe(false);
  });
  it("normalises e-mails and optional text", () => {
    expect(staffInviteSchema.parse({ email: " Tech@Example.TEST ", role: "technician" }).email).toBe("tech@example.test");
    expect(staffInviteSchema.safeParse({ email: "a@b.test", role: "platform_admin" }).success).toBe(false);
    expect(siteSchema.parse({ name: "Site A", addressLine: "1 rue X", city: "Rabat", accessNotes: "", contactName: "", contactPhone: "" }).accessNotes).toBeNull();
  });
});
