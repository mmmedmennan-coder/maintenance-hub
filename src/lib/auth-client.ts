import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth endpoints under /api/auth (same origin). */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
