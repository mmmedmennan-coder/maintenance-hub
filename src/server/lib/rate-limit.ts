import "server-only";
import { createHmac } from "node:crypto";
import { type Tx, withPublic } from "@/server/db/context";
import { getEnv } from "@/server/env";

/**
 * Fixed-window limiter for public, unauthenticated endpoints (support form), stored in PostgreSQL
 * so it holds across several web instances and restarts. The counter is incremented by the trusted
 * function `app.hit_public_rate_limit` (the runtime role has no direct access to the table).
 * Keys contain an HMAC of the client address: raw IP addresses are never stored.
 *
 * Authentication endpoints use Better Auth's database-backed limiter; authenticated uploads and
 * invitations are limited from database counts.
 */
export function publicRateLimitKey(scope: string, clientAddress: string): string {
  const digest = createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(clientAddress).digest("base64url");
  return `${scope}:${digest.slice(0, 32)}`;
}

/** Counts one hit and returns true when the caller is over the limit. */
export async function hitPublicRateLimit(tx: Tx, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ limited: boolean }[]>`SELECT app.hit_public_rate_limit(${key}::text, ${max}::int, ${windowSeconds}::int) AS limited`;
  return rows[0]?.limited ?? true;
}

/**
 * Runs the hit in its own committed transaction, so a request that is then refused (or fails for
 * another reason) is still counted.
 */
export function isPublicRateLimited(scope: string, request: Request, max: number, windowSeconds: number): Promise<boolean> {
  const key = publicRateLimitKey(scope, clientIp(request));
  return withPublic((tx) => hitPublicRateLimit(tx, key, max, windowSeconds));
}

/**
 * Client address as reported by the reverse proxy. In production the proxy must overwrite
 * `X-Forwarded-For` (see docs/DEPLOYMENT.md), otherwise a client could vary it to evade the limit.
 */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
