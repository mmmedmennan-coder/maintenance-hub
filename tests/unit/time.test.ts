import { describe, expect, it } from "vitest";
import { addDaysToDateString, addMonthsToDateString, formatCalendarDate, isoWeekday, localDateString, localTimeString, localToUtc, tzOffsetMinutes } from "@/lib/time";

describe("Africa/Casablanca time handling (stored in UTC)", () => {
  it("uses UTC+1 outside Ramadan", () => {
    expect(tzOffsetMinutes(new Date("2026-09-28T12:00:00Z"))).toBe(60);
    expect(localToUtc("2026-09-28", "10:00").toISOString()).toBe("2026-09-28T09:00:00.000Z");
  });
  it("uses UTC+0 during Ramadan (clock change handled by the time-zone database)", () => {
    expect(tzOffsetMinutes(new Date("2026-03-01T12:00:00Z"))).toBe(0);
    expect(localToUtc("2026-03-01", "10:00").toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });
  it("round-trips local date and time strings", () => {
    const instant = localToUtc("2026-12-31", "23:30");
    expect(localDateString(instant)).toBe("2026-12-31");
    expect(localTimeString(instant)).toBe("23:30");
  });
  it("computes ISO weekdays in local time", () => {
    // 2026-09-27 23:30 UTC is Monday 00:30 in Casablanca.
    expect(isoWeekday(new Date("2026-09-27T23:30:00Z"))).toBe(1);
  });
  it("does calendar arithmetic on date strings", () => {
    expect(addDaysToDateString("2026-02-28", 1)).toBe("2026-03-01");
    expect(addMonthsToDateString("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateString("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("formats date-only values without a time-zone shift", () => {
    expect(formatCalendarDate("2026-10-01")).toBe("1 octobre 2026");
  });
});
