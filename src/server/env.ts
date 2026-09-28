import "server-only";
import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().min(1).default("Maintenance Hub"),
    APP_URL: z.url(),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
    AUTH_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
    WORKER_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//).optional(),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./storage/private"),
    FILE_SIGNING_SECRET: z.string().min(32, "FILE_SIGNING_SECRET must be at least 32 characters"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().min(3).default("Maintenance Hub <no-reply@maintenance-hub.test>"),
    BOOKING_CONFIRMATION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    AUTH_SIGNIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(5),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60000).default(2000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const appUrl = new URL(env.APP_URL);
    const localRun = LOCAL_HOSTS.has(appUrl.hostname);
    // A production build may be started locally for acceptance testing (localhost only).
    if (!localRun && appUrl.protocol !== "https:") {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "Production requires an https APP_URL" });
    }
    if (!localRun && LOCAL_HOSTS.has(env.SMTP_HOST)) {
      ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "Production must not use local e-mail capture" });
    }
    if (env.STORAGE_DRIVER === "s3" && (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3 storage requires bucket and credentials" });
    }
    if (!localRun && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "Production requires private object storage (s3)" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated configuration. Parsed lazily so `next build` does not need runtime secrets. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
