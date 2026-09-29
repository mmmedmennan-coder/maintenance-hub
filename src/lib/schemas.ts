/**
 * Shared Zod contracts: used by React Hook Form on the client and by route handlers on
 * the server (the server always re-validates). Messages are French interface strings.
 */
import { z } from "zod";
import { parseMoneyInput, parseQuantityInput, parseRateInput } from "./money";

const req = "Champ obligatoire.";
/** Trims and lower-cases before validating (a pasted address with spaces is accepted). */
export const emailInput = (message = "Adresse e-mail invalide.") => z.string().trim().toLowerCase().max(200).pipe(z.email(message));
export const id = z.uuid({ message: "Identifiant invalide." });
const trimmed = (max: number, min = 1) =>
  z
    .string({ message: req })
    .trim()
    .min(min, min <= 1 ? req : `Au moins ${min} caractères.`)
    .max(max, `${max} caractères maximum.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ).");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM).");
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+0-9 ().-]*$/, "Numéro de téléphone invalide.")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Money typed as text ("1 234,50") → integer centimes. */
export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const parsed = parseMoneyInput(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Montant invalide (ex. 350 ou 350,50)." });
      return z.NEVER;
    }
    return parsed;
  });
export const optionalMoneyInput = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const parsed = parseMoneyInput(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Montant invalide (ex. 350 ou 350,50)." });
      return z.NEVER;
    }
    return parsed;
  });
export const rateInput = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseRateInput(v);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "Taux invalide (0 à 100 %)." });
    return z.NEVER;
  }
  return parsed;
});
export const quantityInput = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseQuantityInput(v);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "Quantité invalide (ex. 1 ou 1,5)." });
    return z.NEVER;
  }
  return parsed;
});

/** Declared-availability search: a local date from today up to 90 days ahead (Casablanca). */
export const AVAILABILITY_SEARCH_DAYS = 90;
export function availabilityDateRange(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(now);
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + AVAILABILITY_SEARCH_DAYS);
  return { min: today, max: last.toISOString().slice(0, 10) };
}
export function isAvailabilitySearchDate(d: string, now = new Date()) {
  const { min, max } = availabilityDateRange(now);
  const parsed = Date.parse(`${d}T00:00:00Z`);
  // Round trip rejects impossible dates such as 2026-11-31 (JavaScript would roll them over).
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === d && d >= min && d <= max;
}
export const availabilitySearchDate = localDate.refine((d) => isAvailabilitySearchDate(d), {
  message: `Choisissez une date entre aujourd'hui et ${AVAILABILITY_SEARCH_DAYS} jours.`,
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

// --- Onboarding & membership --------------------------------------------------

export const onboardingSchema = z.object({
  type: z.enum(["CUSTOMER", "PROVIDER"], { message: "Choisissez un type d'entreprise." }),
  name: trimmed(120, 2),
  city: trimmed(80, 2),
});

export const staffInviteSchema = z.object({
  email: emailInput(),
  role: z.enum(["customer_owner", "customer_manager", "customer_viewer", "provider_owner", "provider_dispatcher", "technician"], {
    message: "Rôle invalide.",
  }),
});

export const memberRoleSchema = z.object({ role: staffInviteSchema.shape.role });

export const activeOrganizationSchema = z.object({ organizationId: z.string().min(1).max(64) });

export const referralSchema = z.object({
  email: emailInput(),
  companyName: trimmed(120, 2),
  message: optionalText(500),
});

// --- Sites & equipment ----------------------------------------------------------

export const siteSchema = z.object({
  name: trimmed(120, 2),
  addressLine: trimmed(200, 3),
  city: trimmed(80, 2),
  accessNotes: optionalText(1000),
  contactName: optionalText(120),
  contactPhone: phone,
});
export const siteUpdateSchema = siteSchema.extend({ version: z.number().int().min(1) });

export const equipmentSchema = z.object({
  siteId: id,
  categoryId: id,
  label: trimmed(120, 2),
  brand: optionalText(80),
  model: optionalText(80),
  serialNumber: optionalText(80),
  installedYear: z
    .union([z.coerce.number().int().min(1950).max(2100), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v === "" || v === undefined ? null : v)),
  notes: optionalText(1000),
});
export const equipmentUpdateSchema = equipmentSchema.omit({ siteId: true }).extend({ version: z.number().int().min(1) });

// --- Provider profile, technicians, availability ------------------------------------

const hoursRange = z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]).refine(([a, b]) => a < b, {
  message: "L'heure de fin doit suivre l'heure de début.",
});
// Closed days are simply absent (partial record: zod v4 records with enum keys are otherwise exhaustive).
export const serviceHoursSchema = z.partialRecord(z.enum(["1", "2", "3", "4", "5", "6", "7"]), hoursRange);

export const providerProfileSchema = z.object({
  displayName: trimmed(120, 2),
  summary: trimmed(200, 10),
  description: trimmed(3000, 30),
  city: trimmed(80, 2),
  serviceHours: serviceHoursSchema,
  serviceAreaIds: z.array(id).min(1, "Choisissez au moins une zone.").max(10),
  categoryIds: z.array(id).min(1, "Choisissez au moins une catégorie.").max(20),
  version: z.number().int().min(1),
});

export const technicianSchema = z.object({
  displayName: trimmed(120, 2),
  phone,
  userId: z.string().min(1).max(64).optional().nullable(),
  skillIds: z.array(id).max(20).default([]),
  active: z.boolean().default(true),
});

export const availabilityWindowSchema = z
  .object({
    technicianId: id,
    weekday: z.coerce.number().int().min(1).max(7),
    start: localTime,
    end: localTime,
  })
  .refine((v) => v.start < v.end, { message: "L'heure de fin doit suivre l'heure de début.", path: ["end"] });

export const timeOffSchema = z
  .object({
    technicianId: id,
    startDate: localDate,
    startTime: localTime,
    endDate: localDate,
    endTime: localTime,
    reason: optionalText(200),
  })
  .refine((v) => `${v.startDate}T${v.startTime}` < `${v.endDate}T${v.endTime}`, {
    message: "La fin doit suivre le début.",
    path: ["endTime"],
  });

// --- Requests ----------------------------------------------------------------------

export const windowInput = z
  .object({ date: localDate, start: localTime, end: localTime })
  .refine((w) => w.start < w.end, { message: "L'heure de fin doit suivre l'heure de début.", path: ["end"] });

export const requestDraftSchema = z.object({
  equipmentId: id,
  kind: z.enum(["DIAGNOSTIC", "MAINTENANCE", "BREAKDOWN"], { message: "Choisissez le type d'intervention." }),
  title: trimmed(120, 5),
  symptoms: trimmed(3000, 10),
  preferredWindows: z.array(windowInput).min(1, "Indiquez au moins un créneau souhaité.").max(3, "Trois créneaux maximum."),
});
export const requestUpdateSchema = requestDraftSchema.partial().extend({ version: z.number().int().min(1) });

export const inviteProvidersSchema = z.object({
  providerOrgIds: z.array(z.string().min(1).max(64)).min(1, "Choisissez au moins un prestataire.").max(3, "Trois prestataires maximum."),
});

export const reasonSchema = z.object({ reason: trimmed(500, 3) });
export const optionalReasonSchema = z.object({ reason: optionalText(500) });

// --- Offers -------------------------------------------------------------------------

export const offerDraftSchema = z
  .object({
    kind: z.enum(["DIAGNOSTIC", "MAINTENANCE"]),
    scope: trimmed(2000, 10),
    calloutFee: optionalMoneyInput,
    serviceFee: moneyInput,
    taxRate: rateInput,
    taxNote: optionalText(200),
    windowDate: localDate,
    windowStart: localTime,
    windowEnd: localTime,
    estimatedDurationMin: z.coerce.number().int().min(15, "15 minutes minimum.").max(1440),
    exclusions: optionalText(1000),
    cancellationTerms: trimmed(1000, 5),
    warrantyTerms: optionalText(1000),
    validDays: z.coerce.number().int().min(1).max(30),
  })
  .refine((v) => v.windowStart < v.windowEnd, { message: "L'heure de fin doit suivre l'heure de début.", path: ["windowEnd"] });

export const declineInvitationSchema = z.object({ reason: optionalText(500) });

// --- Booking ------------------------------------------------------------------------

export const confirmBookingSchema = z.object({
  technicianId: id,
  date: localDate,
  start: localTime,
  durationMin: z.coerce.number().int().min(15).max(720),
  bufferBeforeMin: z.coerce.number().int().min(0).max(240).default(30),
  bufferAfterMin: z.coerce.number().int().min(0).max(240).default(30),
  expectedLockVersion: z.number().int().min(0),
});

export const rescheduleProposalSchema = z.object({
  date: localDate,
  start: localTime,
  durationMin: z.coerce.number().int().min(15).max(720),
  technicianId: id.optional().nullable(),
  reason: trimmed(500, 3),
});

export const noShowSchema = z.object({
  absentSide: z.enum(["CUSTOMER", "PROVIDER"]),
  note: trimmed(500, 3),
});

// --- Work orders ----------------------------------------------------------------------

export const workOrderActionSchema = z.object({
  action: z.enum(["START_TRAVEL", "ARRIVE", "START_WORK", "WAIT_FOR_PARTS"]),
  note: optionalText(1000),
  expectedLockVersion: z.number().int().min(0),
});

export const noteSchema = z.object({
  body: trimmed(2000, 1),
  visibility: z.enum(["SHARED", "PROVIDER_INTERNAL", "CUSTOMER_PRIVATE"]),
});

export const quoteLineSchema = z.object({
  kind: z.enum(["PART", "LABOR", "TRAVEL", "OTHER"]),
  description: trimmed(300, 2),
  quantity: quantityInput,
  unitPrice: moneyInput,
  taxRate: rateInput,
});

export const repairQuoteSchema = z.object({
  title: trimmed(120, 3).optional(),
  scopeSummary: trimmed(2000, 10),
  estimatedDurationMin: z.coerce.number().int().min(15).max(10080).optional().nullable(),
  timingNote: optionalText(500),
  exclusions: optionalText(1000),
  warrantyTerms: optionalText(1000),
  validDays: z.coerce.number().int().min(1).max(60).default(7),
  revisionReason: optionalText(500),
  lines: z.array(quoteLineSchema).min(1, "Ajoutez au moins une ligne.").max(40),
});

export const quoteDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  expectedSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: optionalText(500),
});

export const reportSchema = z.object({
  findings: trimmed(4000, 10),
  workPerformed: trimmed(4000, 5),
  partsUsed: optionalText(2000),
  recommendations: optionalText(2000),
  nextServiceDate: localDate.optional().nullable(),
  photoDocumentIds: z.array(id).max(12).default([]),
});

export const acknowledgeSchema = z.object({
  decision: z.enum(["ACKNOWLEDGE", "DISPUTE"]),
  reason: optionalText(2000),
});

// --- Documents ------------------------------------------------------------------------

export const uploadInitSchema = z.object({
  kind: z.enum(["PHOTO", "ATTACHMENT", "PAYMENT_EVIDENCE"]),
  fileName: trimmed(200, 1),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024, "10 Mo maximum."),
  requestId: id.optional(),
  workOrderId: id.optional(),
  equipmentId: id.optional(),
  shareWithProviders: z.boolean().default(false),
});

// --- Payments ---------------------------------------------------------------------------

export const paymentSchema = z.object({
  amount: moneyInput.refine((v) => v > 0, "Le montant doit être positif."),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "OTHER_EXTERNAL"]),
  paidOn: localDate,
  externalReference: optionalText(120),
  note: optionalText(500),
  evidenceDocumentId: id.optional().nullable(),
});

export const paymentActionSchema = z.object({
  action: z.enum(["CONFIRM", "REJECT", "REVERSE"]),
  reason: optionalText(500),
});

// --- Maintenance, reviews, disputes ----------------------------------------------------------

export const maintenancePlanSchema = z.object({
  equipmentId: id,
  title: trimmed(120, 3),
  scope: trimmed(2000, 10),
  intervalMonths: z.coerce.number().int().min(1).max(60),
  reminderLeadDays: z.coerce.number().int().min(0).max(90).default(14),
  firstDueDate: localDate,
});

export const planDecisionSchema = z.object({
  action: z.enum(["CONSENT", "DECLINE", "PAUSE", "RESUME", "END"]),
  note: optionalText(500),
});

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Note de 1 à 5.").max(5, "Note de 1 à 5."),
  comment: optionalText(2000),
});

export const reviewResponseSchema = z.object({ body: trimmed(2000, 3) });

export const disputeCommentSchema = z.object({ body: trimmed(2000, 3) });

// --- Admin ----------------------------------------------------------------------------------

export const providerReviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "SUSPEND", "REINSTATE"]),
  reason: trimmed(500, 3),
});

export const providerCheckSchema = z.object({
  type: z.enum(["BUSINESS_IDENTITY", "TECHNICAL_EXPERIENCE", "REFERENCES", "INSURANCE", "QUALIFICATION"]),
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED"]),
  publicNote: optionalText(300),
  internalNote: optionalText(1000),
  expiresAt: localDate.optional().nullable(),
});

export const disputeResolutionSchema = z.object({
  action: z.enum(["UNDER_REVIEW", "COMMENT", "RESOLVE"]),
  body: trimmed(2000, 3),
});

export const reviewModerationSchema = z.object({
  decision: z.enum(["PUBLISH", "REJECT"]),
  note: optionalText(500),
});

export const subscriptionPeriodSchema = z
  .object({
    periodStart: localDate,
    periodEnd: localDate,
    amount: optionalMoneyInput,
    reference: optionalText(120),
    reason: trimmed(500, 3),
  })
  .refine((v) => v.periodStart <= v.periodEnd, { message: "La fin doit suivre le début.", path: ["periodEnd"] });

export const subscriptionPlanSchema = z.object({
  name: trimmed(120, 2),
  price: moneyInput,
  maxStaff: z.coerce.number().int().min(1).max(100),
  taxNote: trimmed(200, 3),
  active: z.boolean(),
  reason: trimmed(500, 3),
});

export const categorySchema = z.object({
  labelFr: trimmed(120, 2),
  code: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/, "Code en majuscules (A-Z, 0-9, _)."),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export const serviceAreaSchema = z.object({
  name: trimmed(120, 2),
  code: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/, "Code en majuscules (A-Z, 0-9, _)."),
  cities: z.array(trimmed(80, 2)).min(1).max(30),
  routingHours: serviceHoursSchema,
  active: z.boolean().default(true),
});

export const adminInviteProviderSchema = z.object({
  providerOrgId: z.string().min(1).max(64),
  note: optionalText(500),
});

export const supportMessageSchema = z.object({
  name: trimmed(120, 2),
  email: emailInput(),
  organizationName: optionalText(120),
  topic: z.enum(["CUSTOMER", "PROVIDER", "ACCOUNT", "OTHER"]),
  message: trimmed(3000, 10),
});

export type OfferDraftInput = z.input<typeof offerDraftSchema>;
export type RepairQuoteInput = z.input<typeof repairQuoteSchema>;
