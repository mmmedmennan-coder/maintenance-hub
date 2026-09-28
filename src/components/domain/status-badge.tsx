import { CalendarCheck, CircleCheck, CircleDot, CircleMinus, CircleX, Clock, type LucideIcon } from "lucide-react";
import { te } from "@/lib/i18n";
import { Badge, type Tone } from "@/components/ui/feedback";

type Domain =
  | "request"
  | "invitation"
  | "offer"
  | "offerVersion"
  | "booking"
  | "workOrder"
  | "ack"
  | "quote"
  | "payment"
  | "plan"
  | "review"
  | "dispute"
  | "provider"
  | "check"
  | "document"
  | "reschedule"
  | "subscription";

const TONES: Record<Domain, Record<string, Tone>> = {
  request: { DRAFT: "neutral", OPEN: "info", BOOKING: "warn", CLOSED: "success", CANCELLED: "neutral" },
  invitation: { INVITED: "warn", DECLINED: "danger", OFFERED: "info", REVOKED: "neutral", CLOSED: "neutral" },
  offer: { OPEN: "info", WITHDRAWN: "neutral", SELECTED: "brand", CLOSED: "neutral" },
  offerVersion: { DRAFT: "neutral", ISSUED: "info", SUPERSEDED: "neutral", WITHDRAWN: "neutral", SELECTED: "brand", NOT_SELECTED: "neutral", RELEASED: "neutral", EXPIRED: "danger" },
  booking: { PENDING_CONFIRMATION: "warn", CONFIRMED: "brand", DECLINED: "danger", EXPIRED: "danger", CANCELLED: "neutral", NO_SHOW: "danger", COMPLETED: "success" },
  workOrder: {
    SCHEDULED: "brand",
    EN_ROUTE: "info",
    ON_SITE: "info",
    AWAITING_APPROVAL: "warn",
    DIAGNOSED: "info",
    AWAITING_PARTS: "warn",
    IN_PROGRESS: "info",
    REPORT_SUBMITTED: "success",
    CANCELLED: "neutral",
  },
  ack: { PENDING: "warn", ACKNOWLEDGED: "success", DISPUTED: "danger" },
  quote: { DRAFT: "neutral", ISSUED: "warn", SUPERSEDED: "neutral", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" },
  payment: { REPORTED: "warn", CONFIRMED: "success", REJECTED: "danger", REVERSED: "neutral" },
  plan: { PROPOSED: "warn", ACTIVE: "success", PAUSED: "neutral", ENDED: "neutral", DECLINED: "neutral" },
  review: { PENDING_MODERATION: "warn", PUBLISHED: "success", REJECTED: "neutral" },
  dispute: { OPEN: "danger", UNDER_REVIEW: "warn", RESOLVED: "success", WITHDRAWN: "neutral" },
  provider: { DRAFT: "neutral", SUBMITTED: "warn", APPROVED: "success", REJECTED: "danger", SUSPENDED: "danger" },
  check: { PENDING: "warn", VERIFIED: "success", REJECTED: "danger", EXPIRED: "neutral" },
  document: { PENDING: "warn", READY: "success", FAILED: "danger", DELETED: "neutral" },
  reschedule: { PENDING: "warn", ACCEPTED: "success", REJECTED: "danger", WITHDRAWN: "neutral" },
  subscription: { ACTIVE: "success", INACTIVE: "danger", NONE: "neutral" },
};

const ICONS: Record<Tone, LucideIcon> = {
  neutral: CircleMinus,
  brand: CalendarCheck,
  warn: Clock,
  danger: CircleX,
  success: CircleCheck,
  info: CircleDot,
};

export function StatusBadge({ domain, status, className }: { domain: Domain; status: string | null | undefined; className?: string }) {
  if (!status) return null;
  const tone = TONES[domain][status] ?? "neutral";
  return (
    <Badge tone={tone} icon={ICONS[tone]} className={className}>
      {te(`status.${domain}`, status)}
    </Badge>
  );
}

export function DemoBadge() {
  return <Badge tone="neutral">{te("app", "demoBadge")}</Badge>;
}
