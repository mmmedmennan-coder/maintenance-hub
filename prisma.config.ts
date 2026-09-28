import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (generate, and optionally `prisma migrate deploy`) uses the
// migration/owner connection. The application runtime never uses this role.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --tsconfig tsconfig.worker.json scripts/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
