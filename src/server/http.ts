import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { Actor, OrgType, Role } from "@/server/auth/roles";
import { getApiSession, requireApiActor, type SessionInfo } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import { DomainError, HTTP_STATUS, mapDatabaseError } from "@/server/errors";

const MAX_JSON_BYTES = 64 * 1024;

export type RouteContext<P> = { params: Promise<P> };

type Common<P, B, Q> = {
  params?: z.ZodType<P>;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
};

type ActorHandler<P, B, Q> = (ctx: {
  request: Request;
  actor: Actor;
  params: P;
  body: B;
  query: Q;
  idempotencyKey: string | null;
}) => Promise<unknown>;

export function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store, private" } });
}

export function errorResponse(error: unknown) {
  const mapped = mapDatabaseError(error);
  if (mapped) {
    return NextResponse.json(
      { error: { code: mapped.code, message: mapped.message, details: publicDetails(mapped) } },
      { status: HTTP_STATUS[mapped.code], headers: { "Cache-Control": "no-store, private" } },
    );
  }
  // Never leak internal/database messages to clients.
  console.error("[api] unexpected error", error instanceof Error ? `${error.name}: ${error.message}` : error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Une erreur interne est survenue. Réessayez plus tard." } },
    { status: 500, headers: { "Cache-Control": "no-store, private" } },
  );
}

function publicDetails(error: DomainError) {
  if (!error.details) return undefined;
  const { fields, ...rest } = error.details;
  // Keep field errors; drop raw database reasons outside development.
  const safe: Record<string, unknown> = {};
  if (fields) safe.fields = fields;
  if (process.env.NODE_ENV === "development") Object.assign(safe, rest);
  return Object.keys(safe).length ? safe : undefined;
}

/** Rejects cross-site cookie-authenticated mutations (CSRF): Origin must be the app origin. */
export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const expected = new URL(getEnv().APP_URL).origin;
  if (origin) {
    if (origin !== expected) throw new DomainError("FORBIDDEN", "Origine de la requête refusée.");
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new DomainError("FORBIDDEN", "Origine de la requête refusée.");
  }
  if (!site && process.env.NODE_ENV === "production") {
    throw new DomainError("FORBIDDEN", "Origine de la requête manquante.");
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (["GET", "HEAD", "DELETE"].includes(request.method)) return undefined;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_JSON_BYTES) throw new DomainError("PAYLOAD_TOO_LARGE", "Requête trop volumineuse.");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new DomainError("PAYLOAD_TOO_LARGE", "Requête trop volumineuse.");
  if (!text) return {};
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "JSON attendu.");
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "JSON invalide.");
  }
}

function parseWith<T>(schema: z.ZodType<T> | undefined, value: unknown, label: string): T {
  if (!schema) return value as T;
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || label;
      (fields[key] ??= []).push(issue.message);
    }
    throw new DomainError("VALIDATION_ERROR", "Certains champs sont invalides.", { fields });
  }
  return result.data;
}

/** Route handler for an authenticated actor with optional org-type / role restrictions. */
export function actorRoute<P = Record<string, never>, B = undefined, Q = undefined>(
  options: Common<P, B, Q> & { orgTypes?: OrgType[]; roles?: Role[] },
  handler: ActorHandler<P, B, Q>,
) {
  return async (request: Request, context: RouteContext<Record<string, string>>) => {
    try {
      assertSameOrigin(request);
      const actor = await requireApiActor(request);
      if (options.orgTypes && !options.orgTypes.includes(actor.orgType)) {
        throw new DomainError("FORBIDDEN", "Cette action n'est pas disponible pour votre organisation.");
      }
      if (options.roles && !options.roles.includes(actor.role)) {
        throw new DomainError("FORBIDDEN", "Action non autorisée pour votre rôle.");
      }
      const params = parseWith(options.params, await context.params, "params");
      const query = parseWith(options.query, Object.fromEntries(new URL(request.url).searchParams), "query");
      const body = parseWith(options.body, await readJson(request), "body");
      const idempotencyKey = request.headers.get("idempotency-key");
      const result = await handler({ request, actor, params, body, query, idempotencyKey });
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Route handler that works with or without a session (public reads, onboarding). */
export function publicRoute<P = Record<string, never>, B = undefined, Q = undefined>(
  options: Common<P, B, Q> & { requireSession?: boolean },
  handler: (ctx: { request: Request; session: SessionInfo | null; params: P; body: B; query: Q }) => Promise<unknown>,
) {
  return async (request: Request, context: RouteContext<Record<string, string>>) => {
    try {
      assertSameOrigin(request);
      const session = await getApiSession(request);
      if (options.requireSession && !session) throw new DomainError("UNAUTHENTICATED", "Connexion requise.");
      const params = parseWith(options.params, await context.params, "params");
      const query = parseWith(options.query, Object.fromEntries(new URL(request.url).searchParams), "query");
      const body = parseWith(options.body, await readJson(request), "body");
      const result = await handler({ request, session, params, body, query });
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
