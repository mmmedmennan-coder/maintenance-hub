# Architecture

Maintenance Hub is a **modular monolith** (one Next.js application) plus **one background worker**,
both backed by a single PostgreSQL database. There are no microservices, caches or queues outside
PostgreSQL.

## 1. System overview

```text
                  Browser (customer · provider · technician · admin)
                                   │  HTTPS, session cookie (Better Auth)
                                   ▼
 ┌──────────────────────────── Next.js 16 (App Router) ─────────────────────────────┐
 │  Server Components (reads)      Client Components (forms, comparison, uploads)   │
 │           │                                   │ fetch /api/v1 (JSON, Idempotency-Key)
 │           │                     Route Handlers /api/v1/* (thin: parse → service) │
 │           ▼                                   ▼                                  │
 │   src/server/modules/*  ← domain services: authorization, transitions, totals     │
 │           │  withActor(): one transaction, SET LOCAL app.user_id / app.org_id     │
 │   src/server/auth (Better Auth, memberships)   src/server/storage (private files) │
 └───────────┼───────────────────────────────┬──────────────────────┬───────────────┘
             │ role mh_app (RLS)             │ role mh_auth         │ local dir / S3
             ▼                               ▼                      ▼
 ┌───────────────────────── PostgreSQL 16 ─────────────────┐   private objects
 │ business tables + RLS · triggers · exclusion constraint │        ▲
 │ identity tables (Better Auth) · outbox_event · email_… │        │
 └───────────────────────────▲─────────────────────────────┘        │
                             │ role mh_worker (scoped policies)     │
 ┌───────────────────────────┴───────────── Worker (Node) ─────────┴──────┐
 │ outbox → notifications, report/quote PDFs, competing-offer closure      │
 │ e-mail queue → SMTP (Mailpit locally) · scheduled: booking/offer expiry,│
 │ maintenance occurrences, abandoned uploads                             │
 └─────────────────────────────────────────────────────────────────────────┘
```

| Concern | Choice (pinned in `package.json`, one `package-lock.json`) |
| --- | --- |
| Runtime | Node.js 22 LTS (`.nvmrc`, `engines`) |
| Web | Next.js 16.3, React 19.3, TypeScript 5.9 strict |
| UI | Tailwind CSS 4.3, Lucide icons, own accessible primitives (`src/components/ui`) |
| Forms | React Hook Form 7 + Zod 4 schemas shared with the API (`src/lib/schemas.ts`) |
| Identity | Better Auth 1.7 (e-mail/password, e-mail verification, reset, organization plugin, Prisma adapter) |
| Data | PostgreSQL 16, Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`) |
| Documents | `pdfkit` (DejaVu fonts embedded for French text), `file-type` for content sniffing |
| E-mail | `nodemailer` → SMTP (Mailpit in development) |
| Storage | local private directory (development) or S3-compatible bucket (`@aws-sdk/client-s3`) |
| Tests | Vitest (unit + real PostgreSQL integration), Playwright (browser journeys) |

### Source layout

```text
src/app/                    pages (public, (auth), onboarding, client, prestataire, technicien, admin) and /api/v1
src/components/ui|domain/   primitives and shared product components (offer comparison, booking view, calendar…)
src/features/               client-side forms and interactions
src/server/auth             Better Auth instance, session → actor resolution, page guard, role helpers
src/server/db               Prisma clients per database role, transaction context (withActor/withPublic)
src/server/modules          domain services (requests, offers, bookings, work, payments, maintenance, admin…)
src/server/storage|pdf|notifications|worker   files, PDF rendering, e-mail queue, worker handlers
src/worker/index.ts         worker entry point
src/lib                     money, time, i18n, schemas, API client (no secrets)
src/messages/fr.json        every interface string (French)
prisma/                     schema + SQL migrations (init, security: RLS, triggers, grants)
scripts/                    bootstrap, migrate, diff, seed, admin, anonymize, e2e server
tests/unit|integration|e2e
```

There is no separate `src/server/policies` directory: resource authorization lives in each domain
service (`can.*` helpers in `src/server/auth/roles.ts` plus ownership checks) and is enforced a second
time by PostgreSQL row-level security.

## 2. Request handling and security context

1. `src/proxy.ts` (Next 16 "proxy", formerly middleware) only forwards the path for return URLs.
2. Pages call `guard()` → `requirePageActor()`: verified Better Auth session → memberships → active
   organization (`session.activeOrganizationId`, validated against memberships) → `Actor`
   `{ userId, orgId, orgType, role }`. Wrong workspace → redirect to the actor's own home;
   no session → `/connexion?next=<path>` (only same-site relative paths are accepted).
3. API handlers use `actorRoute()` / `publicRoute()` (`src/server/http.ts`): same-origin check for
   mutations (CSRF), actor resolution, Zod validation of params/query/body (64 KB JSON cap),
   consistent error envelope, `Cache-Control: no-store, private`.
4. Every business query runs inside `withActor(actor, fn)`: one transaction on the `mh_app` role
   that first executes `set_config('app.user_id', …, true)` and `set_config('app.org_id', …, true)`
   (transaction-local, never from a header). RLS helper functions re-validate the membership from
   those two values, so a forged organization id grants nothing.
5. Mutating services lock the aggregate (`SELECT … FOR UPDATE`, or an advisory lock where the caller
   may read but not update, e.g. platform routing), check the transition, write, append a
   `job_event`, an `audit_event` and an `outbox_event` in the same transaction.

### Database roles

| Role | Used by | Rights |
| --- | --- | --- |
| `mh_owner` | `db:migrate`, `db:seed`, `admin:create`, `user:anonymize` | owns the schema; never used by the running app |
| `mh_app` | web requests | RLS enforced (`NOBYPASSRLS`, not owner); append-only on history tables |
| `mh_auth` | Better Auth | identity tables only (user, session, account, verification, rate_limit, organization, member, invitation) |
| `mh_worker` | worker | outbox/e-mail queues, notifications, PDFs, reminders; scoped policies, no membership admin |

### Row-level security (summary)

Helper functions in schema `app` (`SECURITY DEFINER`, fixed `search_path`, no recursion into the
policies they serve): `uid()`, `org()`, `role()`, `org_type()`, `is_admin()`, `is_customer_writer()`,
`is_provider_manager()`, `is_technician()`, `technician_id()`, `provider_sees_booking()`,
`provider_can_see_request/site/equipment()`, `is_request_invitee()`, `can_see_work_order()`,
`queue_health()`, `provider_is_public()`, and `provider_declares_availability(org, date, category)`,
which answers the public directory's "declared available on this date" filter with a boolean only
(an active technician with a weekly window that day, the requested skill if any, and no time off
covering the whole window). Technician names, hours, time off and reservations stay private;
existing bookings are not considered, because declared availability is provisional until a
provider confirms a slot.

| Data | Customer | Invited provider (before selection) | Selected provider | Technician | Admin |
| --- | --- | --- | --- | --- | --- |
| Sites, equipment | own | no (brief copy only) | the booked site/asset only; access notes after confirmation | assigned job's site/asset | read (audited views) |
| Service request | own | through `request_invitation.brief` only | booked request | — | read |
| Offer versions | issued versions addressed to it | its own | its own | — | read |
| Booking, work order, timeline | own | — | own jobs | assigned jobs only | read |
| Repair quotes | issued/decided versions | — | all its versions (drafts private) | assigned jobs | read |
| Notes | shared + customer-private | — | shared + provider-internal | shared + provider-internal (assigned) | read |
| Documents | own + shared | `QUOTING_SHARED` request attachments | shared job files | assigned job files | read |
| Payments | own bookings | — | own bookings | no | read, reverse |
| Membership, subscriptions | own org | — | own org (managers) | no | all |

Integration tests exercise these rules with the real roles (guessed ids, competitor offers, forged
organization context, technician isolation, file downloads).

## 3. Data model (main relationships)

```text
Organization ─┬─ Member(role) ── User ── Session/Account (Better Auth)
              ├─ Invitation (staff)
CUSTOMER org ─┼─ Site ── Equipment ── EquipmentCategory ── ServiceCategory
              │            │                 ServiceArea (cities, routing hours)
              └─ ServiceRequest (DEM-…) ─┬─ RequestInvitation(brief JSON) ── Offer ── OfferVersion (v1, v2 …)
                                          └─ Booking (RDV-…, selected OfferVersion) ─┬─ AppointmentReservation (tstzrange, exclusion)
                                                                                     ├─ RescheduleProposal
                                                                                     ├─ JobEvent (timeline)
                                                                                     ├─ PaymentRecord ── PaymentEvent
                                                                                     ├─ Review ── ReviewResponse
                                                                                     └─ WorkOrder (INT-…) ─┬─ RepairQuote ── RepairQuoteVersion ─┬─ QuoteLineItem
                                                                                                           │                                     └─ Approval (hash)
                                                                                                           ├─ WorkOrderNote (SHARED / PROVIDER_INTERNAL / CUSTOMER_PRIVATE)
                                                                                                           ├─ ServiceReport (hash) ── Document (photos, REPORT_PDF)
                                                                                                           └─ Dispute ── DisputeEvent
PROVIDER org ─┬─ ProviderProfile ─┬─ ProviderServiceArea / ProviderCategory
              │                   └─ ProviderCheck (typed, dated, public/internal notes)
              ├─ TechnicianProfile ── TechnicianSkill / AvailabilityWindow / TimeOff
              ├─ ProviderSubscription ── SubscriptionPlan / SubscriptionEvent
              └─ MaintenancePlan (asset + provider, customer consent) ── MaintenanceOccurrence (unique key)
Cross-cutting: Document, Notification, OutboxEvent, EmailDelivery, AuditEvent, IdempotencyRecord, SupportMessage
```

Integrity measures (see `prisma/migrations/*_security/migration.sql`):

- Composite foreign keys carry `(customer_org_id, provider_org_id)` down the chain, so a booking,
  work order, quote, payment or note cannot point at another company's asset, technician or request.
- `RESTRICT` deletes on history; assets and sites are **archived**, never deleted once used.
- Partial unique indexes: one active booking per request (`PENDING_CONFIRMATION/CONFIRMED/COMPLETED`),
  one draft and one issued version per offer and per repair quote, one pending reschedule per
  booking, one open dispute per work order, one active reservation per booking, one report PDF per
  report, one quote PDF per version, one review per booking, unique maintenance occurrence key.
- `EXCLUDE USING gist (technician_id WITH =, tstzrange(blocked_start, blocked_end, '[)') WITH &&)
  WHERE (status = 'ACTIVE')`: no overlapping active reservations for a technician. `blocked_*` include
  the travel/setup buffers; intervals are half-open UTC instants. No moving `now()` in index predicates.
- Triggers (`app.trg_*`) enforce the transition tables below, immutability of issued offer/quote
  versions and payment facts, that approvals match the exact issued amount/currency/hash, that only
  the payee confirms receipts, and that only the owner role can create platform administrators.
- `lock_version` / `version` columns for optimistic concurrency on bookings, work orders, requests,
  profiles and assets.

## 4. Lifecycles and transition tables

Separate states are kept for request routing, offer versions, booking, work execution, approval,
acknowledgment, payment and dispute — no single status mixes "completed", "accepted" and "paid".

### Service request

| From → To | Actor | Prerequisites |
| --- | --- | --- |
| `DRAFT → OPEN` | customer owner/manager | no pending upload |
| `OPEN → BOOKING` | customer (selecting an offer version) | version `ISSUED`, not expired; no active booking |
| `BOOKING → OPEN` | customer (reopen) | last booking `DECLINED`/`EXPIRED`/`CANCELLED`/`NO_SHOW` |
| `BOOKING → CLOSED` | worker (`report.submitted`) | report submitted |
| `DRAFT/OPEN/BOOKING → CANCELLED` | customer | reason; no active booking |

Invitations: `INVITED → OFFERED` (offer issued) · `INVITED → DECLINED` (provider) · `INVITED/OFFERED → REVOKED`
(customer) · `→ CLOSED` (request closed). Max 3 active invitations; breakdowns are routed one provider at a
time by an administrator (`invitedAsAdmin`).

### Offer version

`DRAFT → ISSUED` (provider manager, active subscription, future window) · `ISSUED → SUPERSEDED` (new version
issued) · `ISSUED → WITHDRAWN` · `ISSUED → SELECTED` (customer) · `ISSUED → NOT_SELECTED` (another offer
confirmed) · `ISSUED → EXPIRED` (worker) · `SELECTED → RELEASED` (booking declined/expired/cancelled).
Issued content is immutable (trigger) and hashed at issue time.

### Booking

| From → To | Actor | Prerequisites / effects |
| --- | --- | --- |
| `PENDING_CONFIRMATION → CONFIRMED` | provider owner/dispatcher | before deadline (`BOOKING_CONFIRMATION_HOURS`), `expectedLockVersion`, slot inside the offer window, technician active + skilled + available, no time off; reservation insert (exclusion constraint); work order created |
| `PENDING_CONFIRMATION → DECLINED` | provider | reason; selection released |
| `PENDING_CONFIRMATION → EXPIRED` | worker | deadline passed; selection released |
| `PENDING_CONFIRMATION/CONFIRMED → CANCELLED` | either party | reason; work not started (`SCHEDULED`/`EN_ROUTE`); reservation released; pending reschedules withdrawn |
| `CONFIRMED → NO_SHOW` | either party (reports the other side) | start time passed, technician not recorded on site |
| `CONFIRMED → COMPLETED` | provider/technician (report) | report submitted |

Rescheduling: a proposal (`PENDING`) never changes the confirmed slot; acceptance by the other party
releases the old reservation and inserts the new one in the same transaction (if the insert
conflicts, the whole transaction rolls back and the original reservation stays).

### Work order

| From | To | Actor | Prerequisites |
| --- | --- | --- | --- |
| `SCHEDULED` | `EN_ROUTE`, `ON_SITE` | assigned technician or dispatcher | on-site no earlier than 12 h before the slot |
| `EN_ROUTE` | `ON_SITE` | idem | |
| `ON_SITE`, `DIAGNOSED`, `IN_PROGRESS`, `AWAITING_PARTS` | `AWAITING_APPROVAL` | idem (issuing a repair quote) | quote lines valid |
| `AWAITING_APPROVAL` | `DIAGNOSED` | system | last pending quote approved/rejected/withdrawn |
| `ON_SITE`, `DIAGNOSED`, `AWAITING_PARTS` | `IN_PROGRESS` | technician/dispatcher | **approved scope**: an approved repair-quote version, or a maintenance booking (`maintenance_scope_authorized`) |
| `DIAGNOSED`, `IN_PROGRESS` | `AWAITING_PARTS` | idem | approved scope |
| `ON_SITE`, `DIAGNOSED`, `IN_PROGRESS`, `AWAITING_PARTS` | `REPORT_SUBMITTED` | idem | no quote awaiting decision; photos must be saved (`READY`) |
| `SCHEDULED`, `EN_ROUTE` | `CANCELLED` | booking cancellation / no-show | |

There is no free-form status endpoint: `POST /work-orders/{id}/events` accepts only the four named
actions above, and the database trigger re-checks every change.

### Repair quote version and approval

`DRAFT → ISSUED` (technician/dispatcher; hash of the canonical snapshot) · `ISSUED → SUPERSEDED` (revision
issued; revision reason required) · `ISSUED → WITHDRAWN` · `ISSUED → APPROVED / REJECTED` (customer
owner/manager only, with `expectedSnapshotHash`). The `approval` row stores approver, timestamp,
version id, amount, currency and hash (trigger checks they equal the issued version). A later
change order is a new quote needing its own approval; earlier approvals are never modified. A
diagnostic job can be reported and paid when repair is declined (`repairDeclined = true`).

### Report acknowledgment and dispute

Acknowledgment: `PENDING → ACKNOWLEDGED` or `PENDING → DISPUTED` (customer); `DISPUTED → ACKNOWLEDGED` once no
dispute is open. Dispute: `OPEN → UNDER_REVIEW → RESOLVED` (admin, with a summary) or `→ WITHDRAWN`
(customer). Events are append-only; the report, its hash and the timeline are never rewritten.

### Payments

`REPORTED` (customer declares) → `CONFIRMED` / `REJECTED` (payee = provider). Provider-recorded receipts
start `CONFIRMED`. `CONFIRMED → REVERSED` (provider or admin, reason, audit). Facts (amount, date,
method, parties) are immutable. Balance = accepted offer total + latest approved version of each
repair quote − confirmed payments; reported payments are shown separately. Partial payments are
supported; a completed job is not considered paid.

### Maintenance plans

`PROPOSED → ACTIVE` (customer consent) / `DECLINED` · `ACTIVE ↔ PAUSED` · `→ ENDED`. The worker creates a
**draft** request per due date (`reminderLeadDays` ahead) using the occurrence key
`<planId>:<dueDate>` (unique), never a confirmed or billable visit. Intervals are entered by the
provider; the software does not invent them.

### Provider profile and reviews

Profile: `DRAFT → SUBMITTED` (provider, completeness checks) → `APPROVED` (admin; requires a verified
`BUSINESS_IDENTITY` check) / `REJECTED`; `APPROVED ↔ SUSPENDED`. Only approved profiles are public.
Reviews: one per completed booking, by the customer; `PENDING_MODERATION → PUBLISHED / REJECTED`
(admin); ratings are computed from published reviews only; one provider reply (can be hidden by an admin).

### Subscription entitlement (pilot)

`SubscriptionPlan` rows hold the configurable pilot plan (default 399 MAD/month excl. tax, 3 staff
accounts). Periods are recorded manually by an administrator after payment was collected outside
the platform (`SubscriptionEvent`, audited). **Active** = `paid_until ≥ today` (Casablanca). When
inactive, a provider **cannot issue offers or propose maintenance plans**; it keeps full access to
history, pending confirmations, ongoing jobs, reports and payments. The staff limit (members +
pending invitations) comes from the plan.

## 5. Concurrency and retries

- Selection: row lock on the request + partial unique index `booking_one_active_per_request`.
- Confirmation: one transaction (lock booking → check state/version/deadline → capability and
  availability → insert reservation → update booking → create work order → timeline/audit/outbox).
  Overlaps raise `23P01` → `SLOT_CONFLICT`; stale screens → `VERSION_CONFLICT`.
- Idempotency (`Idempotency-Key` header) on offer issue/selection, booking confirmation, repair quote
  issue/decision, report submission, payment record/update: keys are scoped to organization +
  operation, the request hash and the outcome are stored in the same transaction; a different payload
  with the same key → `IDEMPOTENCY_KEY_REUSED` (422); a lost race replays the committed outcome.
- Queries of one transaction run on one connection; the pg client serializes them explicitly
  (`src/server/db/serial-pool.ts`).

## 6. Money, time and language

- Money: integer centimes + ISO currency (`MAD`). Lines: subtotal = round-half-up(quantity(thousandths) ×
  unit price) to the centime, then tax = round-half-up(subtotal × rate(basis points)); totals are exact sums
  of rounded lines (`src/lib/money.ts`, unit-tested). Tax rates are entered by the issuer; no universal
  Moroccan rate is assumed and documents are not presented as legal invoices.
- Time: instants in UTC (`timestamptz`), calendar dates as `date`. Display and input in
  `Africa/Casablanca` (UTC+1, UTC+0 during Ramadan per the tz database, unit-tested).
- Language: all strings in `src/messages/fr.json` (unit test checks every key, including keys built
  from templates). `LOCALE`, `DIR` and `INTL_LOCALE` are centralized in `src/lib/i18n.ts` for a future
  Arabic/RTL locale; no language selector is shown.

## 7. Background processing

Services write `outbox_event` rows in the business transaction. The worker claims batches with
`FOR UPDATE SKIP LOCKED`, a 5-minute lease (reclaimed after a crash), exponential backoff (10 s → 1 h)
and `max_attempts` (then `DEAD`, visible on the admin dashboard). Handlers are idempotent
(notification unique `(event_id, user_id)`, deterministic PDF storage keys, conditional updates).
E-mails are queued in `email_delivery` (same lease/backoff), delivered through SMTP and their body
is cleared once sent. Scheduled tasks run every minute: expire overdue pending bookings, mark
expired offers, generate maintenance occurrences, clean abandoned uploads.

## 8. Files

Two-step upload: `POST /api/v1/documents` records ownership, target and visibility (`OWNER_ONLY`,
`QUOTING_SHARED`, `SHARED_PARTIES`) and returns an upload URL; `PUT …/content` streams the body with a
10 MB cap, sniffs the real type (JPEG/PNG/WebP/PDF only), stores it under an opaque key outside
`public/` and marks it `READY` (or `FAILED`, shown as "Non enregistré" with a retry). Downloads are
authorized under RLS first, then streamed (local) or redirected to a 60-second signed URL (S3).
PDFs are rendered from persisted data only (no HTML, no external URLs). Report photos (up to 8,
JPEG/PNG/WebP) are decoded by the worker with `sharp` (pixel limit, strict decoding, EXIF
orientation), resized to at most 1200 px, flattened and re-encoded as metadata-free JPEG before
being embedded; a file that cannot be decoded is listed by name instead.

## 9. Personal data

Stored: names, e-mail addresses, optional phone numbers, site addresses and access notes, uploaded
photos/documents, IP and user agent in sessions. Logs redact e-mail addresses and never include
secrets. Account deletion is not self-service (it would break shared work records); on request, an
operator runs `npm run user:anonymize` (see `docs/DEPLOYMENT.md`).
