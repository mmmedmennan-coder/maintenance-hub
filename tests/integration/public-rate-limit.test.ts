import { describe, expect, it } from "vitest";
import { workerDb } from "@/server/db/clients";
import { withPublic } from "@/server/db/context";
import { hitPublicRateLimit, isPublicRateLimited, publicRateLimitKey } from "@/server/lib/rate-limit";
import { cleanupRateLimitWindows } from "@/server/worker/scheduler";
import { ownerDb, uid } from "./helpers";

const hit = (key: string, max: number, windowSeconds = 3600) => withPublic((tx) => hitPublicRateLimit(tx, key, max, windowSeconds));

describe("database-backed public rate limit", () => {
  it("counts hits per key in a fixed window and resets after the window", async () => {
    const key = `test:${uid()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(key, 3));
    expect(results).toEqual([false, false, false, true]);
    expect(await hit(`test:${uid()}`, 3)).toBe(false); // other keys are independent

    // Once the window has passed, counting starts again.
    await ownerDb().publicRateLimit.update({ where: { key }, data: { windowStart: new Date(Date.now() - 3601_000) } });
    expect(await hit(key, 3)).toBe(false);
    expect((await ownerDb().publicRateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(1);
  });

  it("counts concurrent requests exactly (shared by every web instance)", async () => {
    const key = `test:${uid()}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => hit(key, 5)));
    expect(results.filter((limited) => !limited)).toHaveLength(5);
    expect((await ownerDb().publicRateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(12);
  });

  it("stores an HMAC of the client address, and the runtime role cannot read or edit counters", async () => {
    const request = new Request("http://localhost/api/v1/support", { headers: { "x-forwarded-for": "198.51.100.23, 10.0.0.1" } });
    const key = publicRateLimitKey("support", "198.51.100.23");
    expect(key).not.toContain("198.51.100.23");
    expect(key).toMatch(/^support:[A-Za-z0-9_-]{32}$/);
    await ownerDb().publicRateLimit.deleteMany({ where: { key } });
    expect(await isPublicRateLimited("support", request, 1, 60)).toBe(false);
    expect(await isPublicRateLimited("support", request, 1, 60)).toBe(true);

    await expect(withPublic((tx) => tx.publicRateLimit.count())).rejects.toThrow();
    await expect(withPublic((tx) => tx.publicRateLimit.deleteMany({ where: { key } }))).rejects.toThrow();
    await expect(hit("", 1)).rejects.toThrow();
  });

  it("the worker deletes windows older than a day", async () => {
    const old = `test:${uid()}`;
    const recent = `test:${uid()}`;
    await ownerDb().publicRateLimit.createMany({
      data: [
        { key: old, windowStart: new Date(Date.now() - 25 * 3600_000), count: 3 },
        { key: recent, windowStart: new Date(), count: 1 },
      ],
    });
    expect(await cleanupRateLimitWindows(workerDb())).toBeGreaterThanOrEqual(1);
    expect(await ownerDb().publicRateLimit.findUnique({ where: { key: old } })).toBeNull();
    expect(await ownerDb().publicRateLimit.findUnique({ where: { key: recent } })).not.toBeNull();
  });
});
