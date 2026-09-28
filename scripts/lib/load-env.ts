import { config } from "dotenv";
import path from "node:path";

/**
 * Loads environment variables for CLI scripts.
 * ENV_FILE selects an alternative file (for example `.env.test`).
 * Variables already present in the process environment always win.
 */
export function loadEnv(): string {
  const file = process.env.ENV_FILE ?? ".env";
  config({ path: path.resolve(process.cwd(), file), quiet: true });
  return file;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}
