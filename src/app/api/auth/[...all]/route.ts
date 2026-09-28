import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

export const dynamic = "force-dynamic";

// Better Auth endpoints: sign-up, sign-in, sign-out, e-mail verification, password reset,
// session and active-organization reads. Organization mutations are disabled here and
// handled by /api/v1 domain services (see src/server/auth/auth.ts).
const handler = (request: Request) => toNextJsHandler(getAuth()).POST(request);
const getHandler = (request: Request) => toNextJsHandler(getAuth()).GET(request);

export { getHandler as GET, handler as POST };
