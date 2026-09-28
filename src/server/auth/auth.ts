import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { authDb } from "@/server/db/clients";
import { getEnv } from "@/server/env";
import { queueEmail } from "@/server/notifications/email-queue";
import { t } from "@/lib/i18n";

/**
 * Organization plugin: supplies the organization / member / invitation schema and the
 * session's active organization. Its generic mutation endpoints are disabled because
 * membership rules here are stricter (role sets depend on the organization type, the
 * platform-administrator role is never grantable, provider staff are capped by plan).
 * Those mutations go through src/server/modules/organizations.ts instead.
 */
const DISABLED_ORG_PATHS = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/invite-member",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/cancel-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
  "/organization/create-team",
  "/organization/update-team",
  "/organization/remove-team",
  "/organization/add-team-member",
  "/organization/remove-team-member",
  "/organization/set-active-team",
  "/organization/check-slug",
];

function buildAuth() {
  const env = getEnv();
  const production = env.NODE_ENV === "production";
  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(authDb(), { provider: "postgresql" }),
    telemetry: { enabled: false },
    disabledPaths: [...DISABLED_ORG_PATHS, "/delete-user", "/change-email"],
    advanced: {
      cookiePrefix: "mh",
      useSecureCookies: production && env.APP_URL.startsWith("https://"),
      database: { generateId: "uuid" },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await queueEmail(authDb(), {
          category: "auth.reset_password",
          to: user.email,
          subject: t("email.resetPassword.subject", { app: env.APP_NAME }),
          text: t("email.resetPassword.body", { name: user.name, url }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await queueEmail(authDb(), {
          category: "auth.verify_email",
          to: user.email,
          subject: t("email.verify.subject", { app: env.APP_NAME }),
          text: t("email.verify.body", { name: user.name, url }),
        });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/email": { window: 60, max: env.AUTH_SIGNIN_RATE_LIMIT_PER_MINUTE },
        "/sign-up/email": { window: 300, max: Math.max(5, env.AUTH_SIGNIN_RATE_LIMIT_PER_MINUTE) },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              type: { type: "string", input: false, required: false },
              city: { type: "string", input: false, required: false },
              isDemo: { type: "boolean", input: false, required: false },
            },
          },
        },
      }),
      nextCookies(),
    ],
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;
const store = globalThis as unknown as { __maintenanceHubAuth?: AuthInstance };

export function getAuth(): AuthInstance {
  return (store.__maintenanceHubAuth ??= buildAuth());
}
