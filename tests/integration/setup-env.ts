import { config } from "dotenv";
import { afterAll } from "vitest";

config({ path: ".env.test", override: true, quiet: true });

afterAll(async () => {
  const { disconnectAll } = await import("@/server/db/clients");
  await disconnectAll();
});
