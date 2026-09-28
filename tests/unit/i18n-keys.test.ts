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

/** Keys built from templates (t(`ns.${value}`)) — every value the code can produce. */
const expand = (prefix: string, values: string[], suffix = "") => values.map((v) => `${prefix}.${v}${suffix}`);
const WORK_ACTIONS = ["START_TRAVEL", "ARRIVE", "START_WORK", "WAIT_FOR_PARTS"];
const WORK_STATUSES = ["SCHEDULED", "EN_ROUTE", "ON_SITE", "AWAITING_APPROVAL", "DIAGNOSED", "AWAITING_PARTS", "IN_PROGRESS", "REPORT_SUBMITTED", "CANCELLED"];
const PROVIDER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"];
const PLAN_ACTIONS = ["CONSENT", "DECLINE", "PAUSE", "RESUME", "END"];
const DYNAMIC_KEYS = [
  ...expand("work.actions", WORK_ACTIONS),
  ...expand("work.confirm", WORK_ACTIONS),
  ...expand("work.statusHelp", WORK_STATUSES),
  ...expand("plans.actions", PLAN_ACTIONS),
  ...expand("plans.confirm", PLAN_ACTIONS),
  ...expand("providerDashboard.profile", PROVIDER_STATUSES),
  ...expand("providerProfile.statusHelp", PROVIDER_STATUSES),
  ...expand("admin.providers.decision", ["APPROVE", "REJECT", "SUSPEND", "REINSTATE"]),
  ...expand("admin.providers.decisionBody", ["APPROVE", "REJECT", "SUSPEND", "REINSTATE"]),
  ...expand("customer.assets.archiveBody", ["sites", "equipment"]),
  ...expand("customer.offers.rows", ["provider", "kind", "scope", "callout", "service", "tax", "total", "repair", "window", "duration", "exclusions", "cancellation", "warranty", "expires"]),
  ...expand("customer.requestDetail.bookingEnded", ["DECLINED", "EXPIRED", "CANCELLED", "NO_SHOW"]),
  ...expand("customer.requestDetail.routing", ["unassigned", "awaiting", "offers"]),
  ...expand("customer.wizard.kindHelp", ["DIAGNOSTIC", "MAINTENANCE", "BREAKDOWN"]),
  ...expand("customer.wizard.steps", ["equipment", "details", "windows", "review"]),
  ...expand("onboarding.type", ["CUSTOMER", "PROVIDER"], ".title"),
  ...expand("onboarding.type", ["CUSTOMER", "PROVIDER"], ".body"),
  ...expand("enums.lineKind", ["PART", "LABOR", "TRAVEL", "OTHER"]),
  ...expand("enums.noteVisibility", ["SHARED", "PROVIDER_INTERNAL", "CUSTOMER_PRIVATE"]),
  ...expand("enums.paymentMethod", ["CASH", "BANK_TRANSFER", "CHEQUE", "OTHER_EXTERNAL"]),
  ...expand("enums.disputeEvent", ["OPENED", "COMMENT", "STATUS_CHANGED", "RESOLVED", "WITHDRAWN"]),
  ...expand("enums.subscriptionEvent", ["PERIOD_RECORDED", "PLAN_ASSIGNED", "CORRECTION"]),
  ...expand("enums.occurrenceStatus", ["DRAFT_CREATED", "DISMISSED"]),
  ...expand("roles", ["customer_owner", "customer_manager", "customer_viewer", "provider_owner", "provider_dispatcher", "technician", "platform_admin"]),
  "quote.approvedLine",
  "quote.rejectedLine",
  ...expand("status.workOrder", WORK_STATUSES),
  ...expand("status.provider", PROVIDER_STATUSES),
];

describe("i18n", () => {
  it("has a French string for every literal key used in the interface", () => {
    expect(missingKeys()).toEqual([]);
  });

  it("has a French string for every key built from a template", () => {
    expect(DYNAMIC_KEYS.filter((k) => !hasMessage(k))).toEqual([]);
  });
});
