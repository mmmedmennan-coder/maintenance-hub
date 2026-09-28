/**
 * Identity fixtures for the setup command, the development seed and tests. Writes the
 * same rows Better Auth writes on e-mail/password sign-up (user + credential account),
 * hashing with Better Auth's own password hasher so real sign-in works.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { OrgType, PrismaClient } from "@/generated/prisma/client";

export async function ensureUser(db: PrismaClient, input: { email: string; name: string; password: string; verified?: boolean }) {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  const id = randomUUID();
  const user = await db.user.create({ data: { id, email, name: input.name, emailVerified: input.verified ?? true } });
  await db.account.create({
    data: { id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(input.password) },
  });
  return user;
}

export async function ensureOrganization(db: PrismaClient, input: { slug: string; name: string; type: OrgType; city?: string; isDemo?: boolean }) {
  const existing = await db.organization.findUnique({ where: { slug: input.slug } });
  if (existing) return existing;
  return db.organization.create({
    data: { id: randomUUID(), slug: input.slug, name: input.name, type: input.type, city: input.city ?? null, isDemo: input.isDemo ?? false },
  });
}

export async function ensureMembership(db: PrismaClient, organizationId: string, userId: string, role: string) {
  const existing = await db.member.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (existing) return existing;
  return db.member.create({ data: { id: randomUUID(), organizationId, userId, role } });
}
