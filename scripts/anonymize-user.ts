/**
 * Anonymizes a user account on request (right to erasure) while keeping the audit trail and
 * the business records other parties rely on (bookings, reports, payments, approvals).
 *
 *   npm run user:anonymize -- --email person@example.com            (dry run: shows counts)
 *   npm run user:anonymize -- --email person@example.com --confirm  (applies the changes)
 *
 * What changes (one transaction, owner connection, audited):
 *   - user: name → "Utilisateur supprimé", e-mail → deleted+<id>@invalid.local, image removed,
 *     e-mail marked unverified; sessions, credentials and pending verifications are deleted;
 *   - memberships are removed (the organizations keep their records);
 *   - author-name snapshots in timelines, notes and dispute messages are replaced;
 *   - support messages sent by the user are anonymized.
 * What is kept: identifiers linking historical records, service reports (work records signed by
 * the submitter's name at the time), approvals and payment records. See docs/DEPLOYMENT.md.
 */
import { loadEnv } from "./lib/load-env";
import { ownerDb } from "./lib/owner-db";

const LABEL = "Utilisateur supprimé";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = loadEnv();
  const email = arg("email")?.trim().toLowerCase();
  const confirm = process.argv.includes("--confirm");
  if (!email) throw new Error("--email is required");
  const db = ownerDb();
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No user with e-mail ${email}`);
    const counts = {
      memberships: await db.member.count({ where: { userId: user.id } }),
      sessions: await db.session.count({ where: { userId: user.id } }),
      jobEvents: await db.jobEvent.count({ where: { actorUserId: user.id } }),
      notes: await db.workOrderNote.count({ where: { authorUserId: user.id } }),
      disputeMessages: await db.disputeEvent.count({ where: { actorUserId: user.id } }),
      supportMessages: await db.supportMessage.count({ where: { userId: user.id } }),
    };
    console.log(`[anonymize] ${file}: ${email}`, counts);
    // Warn when the person is the last owner of an organization (nobody could manage it afterwards).
    for (const m of await db.member.findMany({ where: { userId: user.id, role: { in: ["customer_owner", "provider_owner"] } }, include: { organization: true } })) {
      const owners = await db.member.count({ where: { organizationId: m.organizationId, role: m.role } });
      if (owners === 1) console.warn(`[anonymize] warning: last owner of "${m.organization.name}" — transfer ownership first if the organization stays active.`);
    }
    if (!confirm) {
      console.log("[anonymize] dry run — add --confirm to apply.");
      return;
    }
    await db.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.account.deleteMany({ where: { userId: user.id } });
      await tx.verification.deleteMany({ where: { identifier: email } });
      await tx.member.deleteMany({ where: { userId: user.id } });
      await tx.invitation.deleteMany({ where: { email, status: "pending" } });
      await tx.jobEvent.updateMany({ where: { actorUserId: user.id }, data: { actorName: LABEL } });
      await tx.workOrderNote.updateMany({ where: { authorUserId: user.id }, data: { authorName: LABEL } });
      await tx.disputeEvent.updateMany({ where: { actorUserId: user.id }, data: { actorName: LABEL } });
      await tx.supportMessage.updateMany({ where: { userId: user.id }, data: { name: LABEL, email: `deleted+${user.id}@invalid.local` } });
      await tx.technicianProfile.updateMany({ where: { userId: user.id }, data: { userId: null, active: false, phone: null } });
      await tx.user.update({
        where: { id: user.id },
        data: { name: LABEL, email: `deleted+${user.id}@invalid.local`, image: null, emailVerified: false },
      });
      await tx.auditEvent.create({ data: { actorUserId: null, action: "user.anonymized", targetType: "user", targetId: user.id } });
    });
    console.log("[anonymize] done.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[anonymize] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
