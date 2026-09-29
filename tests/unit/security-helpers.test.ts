import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { safeNext } from "@/server/auth/session";
import { DomainError, mapDatabaseError, sqlState } from "@/server/errors";
import { canonicalJson, snapshotHash } from "@/server/lib/hash";
import { assertSafeKey } from "@/server/storage";

describe("snapshot hashes", () => {
  it("are independent of key order and stable for dates", () => {
    const a = { b: 1, a: { d: new Date("2026-01-01T00:00:00Z"), c: [1, 2] }, u: undefined };
    const b = { a: { c: [1, 2], d: new Date("2026-01-01T00:00:00Z") }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(snapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("change when any priced content changes", () => {
    expect(snapshotHash({ total: 100 })).not.toBe(snapshotHash({ total: 101 }));
  });
});

describe("redirect targets after sign-in", () => {
  it("accept only same-site relative paths", () => {
    expect(safeNext("/client/demandes")).toBe("/client/demandes");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/x?u=http://a", "", null]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("database error mapping", () => {
  const driver = (originalCode: string, originalMessage = "") => ({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode, originalMessage } } } });
  it("maps exclusion, transition, immutability and permission failures to stable codes", () => {
    expect(mapDatabaseError(driver("23P01"))?.code).toBe("SLOT_CONFLICT");
    expect(mapDatabaseError(driver("MH001", "booking X -> Y is not allowed"))?.code).toBe("INVALID_TRANSITION");
    expect(mapDatabaseError(driver("MH002"))?.code).toBe("VERSION_CONFLICT");
    expect(mapDatabaseError(driver("42501"))?.code).toBe("FORBIDDEN");
    expect(mapDatabaseError(driver("40001"))?.code).toBe("VERSION_CONFLICT");
  });
  it("recognises the one-active-booking unique index", () => {
    const err = mapDatabaseError(driver("23505", 'duplicate key value violates unique constraint "booking_one_active_per_request"'));
    expect(err?.code).toBe("CONFLICT");
    expect(err?.message).toContain("réservation");
  });
  it("ignores Prisma's own codes when looking for a SQLSTATE", () => {
    expect(sqlState({ code: "P2039" }).code).toBeUndefined();
    expect(mapDatabaseError(new Error("boom"))).toBeNull();
    const domain = new DomainError("NOT_FOUND", "x");
    expect(mapDatabaseError(domain)).toBe(domain);
  });
});

describe("private storage keys", () => {
  it("reject traversal and unexpected characters", () => {
    expect(() => assertSafeKey("docs/202609/abc-123")).not.toThrow();
    for (const bad of ["../etc/passwd", "docs/../../x", "docs/ABC", "/docs/x", "docs", "docs/x y"]) expect(() => assertSafeKey(bad)).toThrow();
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mh-unit-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
