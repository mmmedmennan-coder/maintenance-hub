import "server-only";

/**
 * Small fixed-window limiter for public, unauthenticated endpoints (support form).
 * In-memory: adequate for a single web instance in the pilot. Authentication endpoints use
 * Better Auth's database-backed limiter; authenticated uploads/invitations are limited
 * from database counts. Replace with a shared store before running several web instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function hitRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
