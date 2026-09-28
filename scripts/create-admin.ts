/**
 * Creates (or promotes) the initial platform administrator. There is no public sign-up path
 * to this role; the database only accepts platform_admin memberships from the owner role.
 *
 *   npm run admin:create -- --email admin@example.com --name "Admin" [--password '...']
 *
 * Without --password, ADMIN_PASSWORD is read from the environment. Minimum 12 characters.
 */
import { loadEnv } from "./lib/load-env";
import { ownerDb } from "./lib/owner-db";
import { ensureMembership, ensureOrganization, ensureUser } from "@/server/fixtures/identity";
import { ensureReferenceData } from "@/server/fixtures/reference-data";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = loadEnv();
  const email = arg("email");
  const name = arg("name") ?? "Administrateur";
  const password = arg("password") ?? process.env.ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email is required");
  if (!password || password.length < 12) throw new Error("A password of at least 12 characters is required (--password or ADMIN_PASSWORD)");
  const db = ownerDb();
  try {
    await ensureReferenceData(db);
    const user = await ensureUser(db, { email, name, password, verified: true });
    const org = await ensureOrganization(db, { slug: "plateforme", name: "Équipe plateforme", type: "PLATFORM" });
    await ensureMembership(db, org.id, user.id, "platform_admin");
    await db.auditEvent.create({
      data: { actorUserId: null, action: "admin.created_by_setup_command", targetType: "user", targetId: user.id },
    });
    console.log(`[admin] ${file}: ${email} is a platform administrator.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[admin] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
