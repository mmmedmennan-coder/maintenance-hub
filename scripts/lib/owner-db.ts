import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireEnv } from "./load-env";

/** Owner/migration connection for setup scripts only (never used by the running app). */
export function ownerDb() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv("MIGRATION_DATABASE_URL"), max: 4 }) });
}
