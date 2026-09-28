export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SLOT_CONFLICT"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "ENTITLEMENT_REQUIRED"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLOT_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  ENTITLEMENT_REQUIRED: 402,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
};

export type FieldIssues = Record<string, string[]>;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: { fields?: FieldIssues; [key: string]: unknown };

  constructor(code: ErrorCode, message: string, details?: DomainError["details"]) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = "Ressource") => new DomainError("NOT_FOUND", `${what} introuvable.`);
export const forbidden = (message = "Action non autorisée pour votre rôle.") => new DomainError("FORBIDDEN", message);
export const invalidTransition = (message: string) => new DomainError("INVALID_TRANSITION", message);
export const validation = (message: string, fields?: FieldIssues) =>
  new DomainError("VALIDATION_ERROR", message, fields ? { fields } : undefined);

/** Extracts a PostgreSQL SQLSTATE (and constraint) from Prisma / driver-adapter errors. */
export function sqlState(error: unknown): { code?: string; constraint?: string; message?: string } {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as Record<string, unknown>;
    const candidates = [e.originalCode, e.code, (e.meta as Record<string, unknown> | undefined)?.code];
    for (const c of candidates) {
      // SQLSTATEs are 5 characters; Prisma's own codes (P1xxx–P6xxx) are skipped.
      if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c) && !/^P[1-9]\d{3}$/.test(c)) {
        const constraint =
          (typeof e.constraint === "string" && e.constraint) ||
          (typeof (e.meta as Record<string, unknown> | undefined)?.target === "string"
            ? String((e.meta as Record<string, unknown>).target)
            : undefined) ||
          (typeof e.originalMessage === "string" ? extractConstraint(e.originalMessage) : undefined) ||
          (typeof e.message === "string" ? extractConstraint(e.message) : undefined);
        return {
          code: c,
          constraint: constraint || undefined,
          message: typeof e.originalMessage === "string" ? e.originalMessage : (e.message as string | undefined),
        };
      }
    }
    current = e.cause ?? (e.meta as Record<string, unknown> | undefined)?.driverAdapterError;
  }
  // Prisma's own unique-constraint code.
  if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return { code: "23505", constraint: Array.isArray(target) ? target.join(",") : String(target ?? "") };
  }
  if (error && typeof error === "object" && (error as { code?: string }).code === "P2025") {
    return { code: "P2025" };
  }
  return {};
}

function extractConstraint(message: string): string | undefined {
  const match = /constraint "([^"]+)"/.exec(message) ?? /index "([^"]+)"/.exec(message);
  return match?.[1];
}

/** Maps database-level guard violations to domain errors. Returns null when unknown. */
export function mapDatabaseError(error: unknown): DomainError | null {
  if (error instanceof DomainError) return error;
  const { code, constraint, message } = sqlState(error);
  switch (code) {
    case "23P01":
      return new DomainError("SLOT_CONFLICT", "Ce créneau chevauche une autre intervention du technicien. Actualisez le calendrier et choisissez un autre créneau.");
    case "23505":
      if (constraint?.includes("booking_one_active_per_request")) {
        return new DomainError("CONFLICT", "Une réservation est déjà active pour cette demande.");
      }
      if (constraint?.includes("dispute_one_open")) {
        return new DomainError("CONFLICT", "Un litige est déjà ouvert pour cette intervention.");
      }
      return new DomainError("CONFLICT", "Cet enregistrement existe déjà.", constraint ? { constraint } : undefined);
    case "23503":
    case "23514":
      return new DomainError("VALIDATION_ERROR", "Les données ne respectent pas les règles d'intégrité.", constraint ? { constraint } : undefined);
    case "MH001":
      return new DomainError("INVALID_TRANSITION", "Cette action n'est pas possible dans l'état actuel.", { reason: message });
    case "MH002":
      return new DomainError("VERSION_CONFLICT", "Cet enregistrement émis ne peut plus être modifié.", { reason: message });
    case "MH003":
    case "42501":
      return new DomainError("FORBIDDEN", "Action non autorisée.");
    case "40001":
    case "40P01":
      return new DomainError("VERSION_CONFLICT", "Une autre modification a eu lieu en même temps. Actualisez et réessayez.");
    case "P2025":
      return new DomainError("NOT_FOUND", "Ressource introuvable.");
    default:
      return null;
  }
}
