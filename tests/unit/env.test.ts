import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const base = {
  APP_URL: "https://maintenance.example.ma",
  BETTER_AUTH_URL: "https://maintenance.example.ma",
  BETTER_AUTH_SECRET: "x".repeat(40),
  DATABASE_URL: "postgresql://mh_app:pw@db:5432/maintenance_hub",
  AUTH_DATABASE_URL: "postgresql://mh_auth:pw@db:5432/maintenance_hub",
  SMTP_HOST: "smtp.example.ma",
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "private-bucket",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("configuration validation at startup", () => {
  it("accepts a complete production configuration", () => {
    expect(parseEnv({ ...base, NODE_ENV: "production" }).STORAGE_DRIVER).toBe("s3");
  });
  it("rejects short secrets and missing database URLs", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it("refuses insecure production fallbacks: http URL, captured e-mail, local file storage, S3 without credentials", () => {
    const prod = { ...base, NODE_ENV: "production" };
    expect(() => parseEnv({ ...prod, APP_URL: "http://maintenance.example.ma" })).toThrow(/https APP_URL/);
    expect(() => parseEnv({ ...prod, SMTP_HOST: "localhost" })).toThrow(/local e-mail capture/);
    expect(() => parseEnv({ ...prod, STORAGE_DRIVER: "local" })).toThrow(/private object storage/);
    expect(() => parseEnv({ ...prod, S3_SECRET_ACCESS_KEY: undefined })).toThrow(/bucket and credentials/);
  });
  it("allows a production build on localhost for acceptance testing", () => {
    const local = { ...base, NODE_ENV: "production", APP_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:3000", SMTP_HOST: "localhost", STORAGE_DRIVER: "local" };
    expect(parseEnv(local).APP_URL).toBe("http://localhost:3000");
  });
});
