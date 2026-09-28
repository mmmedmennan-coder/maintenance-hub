/**
 * Demo-only clock for the development seed. The seed replays realistic histories (a visit
 * three weeks ago, a quote approved yesterday…) through the real domain services, which read
 * the current time. Setting the clock shifts `new Date()` / `Date.now()` for this process
 * only; dates built from explicit values are untouched. Never imported by the application.
 */
const RealDate = Date;
let offsetMs = 0;

class DemoClockDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as [string | number]));
  }
  static now() {
    return RealDate.now() + offsetMs;
  }
}

(globalThis as { Date: DateConstructor }).Date = DemoClockDate as unknown as DateConstructor;

/** Makes "now" equal to `instant` until the next call (or `resetClock`). */
export function setClock(instant: Date) {
  offsetMs = instant.getTime() - RealDate.now();
}

export function resetClock() {
  offsetMs = 0;
}

export function realNow() {
  return new RealDate(RealDate.now());
}
