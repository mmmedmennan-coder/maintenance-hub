import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasMessage } from "@/lib/i18n";

/** Every literal key passed to t("…") in the source must exist in src/messages/fr.json. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

export function missingKeys(): string[] {
  const missing = new Set<string>();
  for (const file of sourceFiles(path.resolve("src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
      if (!hasMessage(match[1]!)) missing.add(`${match[1]}  (${path.relative(process.cwd(), file)})`);
    }
  }
  return [...missing].sort();
}

describe("i18n", () => {
  it("has a French string for every literal key used in the interface", () => {
    expect(missingKeys()).toEqual([]);
  });
});
