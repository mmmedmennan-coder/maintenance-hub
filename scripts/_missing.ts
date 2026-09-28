import fs from "node:fs";
import path from "node:path";
import { hasMessage } from "@/lib/i18n";
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : files(f);
    return /\.(ts|tsx)$/.test(e.name) ? [f] : [];
  });
}
const out = new Set<string>();
for (const f of files("src")) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) if (!hasMessage(m[1]!)) out.add(m[1]!);
console.log([...out].sort().join("\n"));
