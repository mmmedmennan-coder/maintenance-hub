import { INTL_LOCALE } from "./i18n";

/**
 * Money is handled as integer minor units (centimes). Rounding rule (documented in
 * docs/ARCHITECTURE.md): each line is rounded half-up to the centime — first the line
 * subtotal (quantity × unit price), then the line tax — and totals are exact sums of
 * the rounded line values. Tax rates are entered by the issuer in basis points.
 */
export const DEFAULT_CURRENCY = "MAD";

export function formatMoney(minor: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat(INTL_LOCALE, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

/** Parses "1 234,50", "1234.5" or "1234" into minor units; null when invalid. */
export function parseMoneyInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/[\s  ]/g, "").replace(",", ".");
  if (raw === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Minor units → editable decimal string ("1234,50"). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const whole = Math.floor(minor / 100);
  const frac = String(minor % 100).padStart(2, "0");
  return `${whole},${frac}`;
}

/** Parses "1,5" / "2" into thousandths (1500 / 2000); null when invalid. */
export function parseQuantityInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const value = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  return value > 0 ? value : null;
}

export function formatQuantity(milli: number): string {
  return new Intl.NumberFormat(INTL_LOCALE, { maximumFractionDigits: 3 }).format(milli / 1000);
}

export function formatRate(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  return `${new Intl.NumberFormat(INTL_LOCALE, { maximumFractionDigits: 2 }).format(bp / 100)} %`;
}

/** Parses "20" or "20,5" (percent) into basis points (2000 / 2050). */
export function parseRateInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/\s/g, "").replace(",", ".").replace("%", "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const bp = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return bp <= 10000 ? bp : null;
}

/** round(numerator / denominator) half-up for non-negative integers, exact (BigInt). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new RangeError("non-negative values only");
  const q = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  return Number(q);
}

export type LineAmounts = { subtotalMinor: number; taxMinor: number; totalMinor: number };

export function computeLine(quantityMilli: number, unitPriceMinor: number, taxRateBp: number): LineAmounts {
  if (![quantityMilli, unitPriceMinor, taxRateBp].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new RangeError("invalid line values");
  }
  const subtotalMinor = divRoundHalfUp(BigInt(quantityMilli) * BigInt(unitPriceMinor), BigInt(1000));
  const taxMinor = divRoundHalfUp(BigInt(subtotalMinor) * BigInt(taxRateBp), BigInt(10000));
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

export function sumLines(lines: LineAmounts[]): LineAmounts {
  return lines.reduce(
    (acc, l) => ({
      subtotalMinor: acc.subtotalMinor + l.subtotalMinor,
      taxMinor: acc.taxMinor + l.taxMinor,
      totalMinor: acc.totalMinor + l.totalMinor,
    }),
    { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 },
  );
}

/** Offer price = call-out fee + diagnostic/maintenance fee, taxed at the issuer's rate. */
export function computeOfferTotals(calloutFeeMinor: number | null, serviceFeeMinor: number | null, taxRateBp: number | null): LineAmounts {
  const lines: LineAmounts[] = [];
  const rate = taxRateBp ?? 0;
  if (calloutFeeMinor) lines.push(computeLine(1000, calloutFeeMinor, rate));
  if (serviceFeeMinor) lines.push(computeLine(1000, serviceFeeMinor, rate));
  return sumLines(lines);
}
