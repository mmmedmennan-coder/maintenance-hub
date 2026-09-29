import { describe, expect, it } from "vitest";
import { availabilityDateRange, availabilitySearchDate, isAvailabilitySearchDate, offerDraftSchema, paymentSchema, quoteDecisionSchema, repairQuoteSchema, reportSchema, serviceHoursSchema, siteSchema, staffInviteSchema } from "@/lib/schemas";

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
  it("availability search dates run from today (Casablanca) to +90 days", () => {
    const { min, max } = availabilityDateRange();
    const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    expect(availabilitySearchDate.safeParse(min).success).toBe(true);
    expect(availabilitySearchDate.safeParse(max).success).toBe(true);
    expect(availabilitySearchDate.safeParse(shift(min, -1)).success).toBe(false);
    expect(availabilitySearchDate.safeParse(shift(max, 1)).success).toBe(false);
    const oct1 = new Date("2026-10-01T10:00:00Z");
    expect(isAvailabilitySearchDate("2026-11-30", oct1)).toBe(true);
    expect(isAvailabilitySearchDate("2026-11-31", oct1)).toBe(false); // impossible date, not rolled over
    expect(isAvailabilitySearchDate("2026-09-30", oct1)).toBe(false); // past
    expect(isAvailabilitySearchDate("2026-12-30", oct1)).toBe(true); // +90 days
    expect(isAvailabilitySearchDate("2026-12-31", oct1)).toBe(false);
    expect(availabilitySearchDate.safeParse("demain").success).toBe(false);
    // Just after midnight in Casablanca (UTC+1 outside Ramadan) is already the next local day.
    expect(availabilityDateRange(new Date("2026-10-14T23:30:00Z")).min).toBe("2026-10-15");
  });
});
