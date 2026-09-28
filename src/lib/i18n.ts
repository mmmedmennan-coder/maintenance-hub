import fr from "@/messages/fr.json";

/**
 * Interface strings live in src/messages/<locale>.json. French is the only shipped locale;
 * adding Arabic means adding ar.json and switching LOCALE/DIR (layout already uses `dir`).
 * No language selector is shown until a second locale is complete.
 */
export const LOCALE = "fr" as const;
export const HTML_LANG = "fr";
export const DIR: "ltr" | "rtl" = "ltr";
export const INTL_LOCALE = "fr-MA";

type Dict = { [key: string]: string | Dict };
const messages: Dict = fr as Dict;

export type Vars = Record<string, string | number | null | undefined>;

export function hasMessage(key: string): boolean {
  return typeof lookup(key) === "string";
}

function lookup(key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Dict)[part];
  }
  return node;
}

export function t(key: string, vars?: Vars): string {
  const value = lookup(key);
  if (typeof value !== "string") {
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Translates an enum value under a namespace, e.g. te("status.booking", "CONFIRMED"). */
export function te(namespace: string, value: string | null | undefined): string {
  if (!value) return "";
  const key = `${namespace}.${value}`;
  return hasMessage(key) ? t(key) : value;
}
