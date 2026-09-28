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
const out = new Map<string, { params: Set<string>; files: Set<string> }>();
for (const f of files("src")) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"(\s*,\s*\{([^}]*)\})?/g)) {
    const key = m[1]!;
    if (hasMessage(key)) continue;
    const e = out.get(key) ?? { params: new Set(), files: new Set() };
    for (const p of (m[3] ?? "").matchAll(/([a-zA-Z]+)\s*(:|,|$)/g)) e.params.add(p[1]!);
    e.files.add(path.basename(path.dirname(f)) + "/" + path.basename(f));
    out.set(key, e);
  }
}
const ns = process.argv[2];
for (const [k, v] of [...out].sort()) if (!ns || k.startsWith(ns + ".")) console.log(`${k}${v.params.size ? " {" + [...v.params].join(",") + "}" : ""}  [${[...v.files].join(" ")}]`);
