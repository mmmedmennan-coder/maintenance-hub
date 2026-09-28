import { describe, expect, it } from "vitest";
import { computeLine, computeOfferTotals, divRoundHalfUp, formatMoney, formatRate, minorToInput, parseMoneyInput, parseQuantityInput, parseRateInput, sumLines } from "@/lib/money";

describe("money parsing", () => {
  it("parses French and plain inputs into centimes", () => {
    expect(parseMoneyInput("1 234,50")).toBe(123450);
    expect(parseMoneyInput("1234.5")).toBe(123450);
    expect(parseMoneyInput("350")).toBe(35000);
    expect(parseMoneyInput("0,05")).toBe(5);
    expect(parseMoneyInput(420)).toBe(42000);
  });
  it("rejects invalid amounts instead of guessing", () => {
    for (const bad of ["", "abc", "1,234,5", "-5", "12.345", "1e3", null, undefined]) expect(parseMoneyInput(bad as string)).toBeNull();
  });
  it("round-trips minor units to an editable string", () => {
    expect(minorToInput(123405)).toBe("1234,05");
    expect(parseMoneyInput(minorToInput(99))).toBe(99);
  });
  it("parses quantities (thousandths) and rates (basis points)", () => {
    expect(parseQuantityInput("1,5")).toBe(1500);
    expect(parseQuantityInput("2")).toBe(2000);
    expect(parseQuantityInput("0")).toBeNull();
    expect(parseRateInput("20")).toBe(2000);
    expect(parseRateInput("7,5 %")).toBe(750);
    expect(parseRateInput("101")).toBeNull();
    expect(formatRate(2000)).toMatch(/^20\s?%$/);
  });
  it("formats MAD amounts", () => {
    expect(formatMoney(123450)).toMatch(/1.?234,50/);
    expect(formatMoney(123450)).toContain("MAD");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("line and total arithmetic (half-up per line, exact sums)", () => {
  it("rounds half up with exact integer arithmetic", () => {
    expect(divRoundHalfUp(BigInt(5), BigInt(10))).toBe(1);
    expect(divRoundHalfUp(BigInt(4), BigInt(10))).toBe(0);
    expect(divRoundHalfUp(BigInt(15), BigInt(10))).toBe(2);
  });
  it("computes a line: subtotal rounded first, then tax", () => {
    // 1.5 × 250.00 = 375.00 ; 20 % = 75.00
    expect(computeLine(1500, 25000, 2000)).toEqual({ subtotalMinor: 37500, taxMinor: 7500, totalMinor: 45000 });
    // 0.333 × 10.01 = 3.33333 → 3.33 ; 20 % of 3.33 = 0.666 → 0.67
    expect(computeLine(333, 1001, 2000)).toEqual({ subtotalMinor: 333, taxMinor: 67, totalMinor: 400 });
  });
  it("sums rounded lines exactly", () => {
    const lines = [computeLine(1000, 42000, 2000), computeLine(1500, 25000, 2000)];
    expect(sumLines(lines)).toEqual({ subtotalMinor: 79500, taxMinor: 15900, totalMinor: 95400 });
  });
  it("prices offers as call-out + service fee at the issuer's rate", () => {
    expect(computeOfferTotals(10000, 25000, 2000)).toEqual({ subtotalMinor: 35000, taxMinor: 7000, totalMinor: 42000 });
    expect(computeOfferTotals(null, 60000, 0)).toEqual({ subtotalMinor: 60000, taxMinor: 0, totalMinor: 60000 });
  });
  it("refuses negative or fractional inputs", () => {
    expect(() => computeLine(-1, 100, 2000)).toThrow();
    expect(() => computeLine(1000, 10.5, 2000)).toThrow();
  });
});
