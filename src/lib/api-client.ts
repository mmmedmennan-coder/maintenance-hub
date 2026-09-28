import { t } from "./i18n";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; idempotencyKey?: string };

/**
 * Calls the /api/v1 backend. Resolves only when the server confirmed the operation;
 * network failures and server errors reject with an ApiError the UI displays as-is.
 */
export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK", t("errors.network"));
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: { fields?: Record<string, string[]> } } } | null;
  if (!response.ok || !payload || payload.error) {
    throw new ApiError(
      payload?.error?.code ?? "INTERNAL",
      payload?.error?.message ?? t("errors.generic"),
      response.status,
      payload?.error?.details?.fields,
    );
  }
  return payload.data as T;
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
