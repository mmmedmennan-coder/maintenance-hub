# Implementation status

This file records what exists, how it was verified and what is still missing. It was written at
the end of the initial build (28 September 2026) and describes the commit that adds it.

**Overall status:** the pilot scope of the master prompt is implemented as one Next.js
application (web + API), a separate worker and a PostgreSQL 16 database with row-level security.
The core journey works end to end in a real browser with separate accounts. The application is
ready for **local acceptance testing with fictional data**. It is **not production-ready**: nothing
has been deployed, the S3 and production SMTP adapters have not run against real services, no load
or penetration test was done, and the legal and operational points in §5 are still open.

Status values used below:

| Value | Meaning |
| --- | --- |
| **Tested** | Implemented; an automated test (named) checks the behavior. |
| **Inspected** | Implemented; checked by hand in the browser and/or by the page crawl, but no dedicated automated assertion. |
| **Partial** | Part of the requirement is implemented; the gap is described. |
| **Deferred** | Out of scope by the prompt, or needs credentials/authorization not given. |

## 1. Checks actually run

All checks were run in the build environment (Linux, Node.js 22.22.2, PostgreSQL 16 installed
locally, Mailpit 1.x binary for e-mail capture) on the final code.

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Types | `npm run typecheck` (TypeScript strict) | 0 errors |
| Production build | `npm run build` | success, no build warnings |
| Unit tests | `npm run test` | 7 files, **38/38 passed** (money, Casablanca time incl. Ramadan UTC+0, security helpers, startup configuration, schemas, PDF rendering, i18n key coverage) |
| Integration tests | `npm run test:integration` | 6 files, **15/15 passed**, against real PostgreSQL with the production-style roles `mh_app` / `mh_auth` / `mh_worker` (not a superuser) |
| End-to-end tests | `npm run test:e2e` (Playwright, Chromium, production build on port 3100, fresh seeded test DB, Mailpit) | **11/11 passed** |
| Responsive crawl | custom Playwright crawl of 88 page visits per width (all roles, list + detail pages) at **360, 768 and 1440 px** | 0 problems (HTTP status, horizontal overflow, console errors, untranslated keys, error screens) |
| Accessibility scan | axe-core 4 (WCAG 2.0/2.1 A + AA + best-practice rules) on 76 pages (public, customer, provider, technician, admin, detail pages) at 360 and 1440 px | 0 violations after fixing 2 findings (auth footer outside a landmark; low-contrast hash text) |
| Fresh install | on an empty scratch database: `db:bootstrap` → `db:migrate` → `db:seed`, then `db:seed` again | success; the second seed created no duplicates |
| Dependency audit | `npm audit` | 0 vulnerabilities (with two `overrides`, see `docs/DEPLOYMENT.md` §8) |
| Docker Compose | `docker compose config` | file valid. **Containers not started**: Docker Hub pulls are blocked in the build environment, so PostgreSQL and Mailpit were run natively instead |
| Screenshots | Playwright | `docs/screenshots/` (customer dashboard and offer comparison, provider calendar, admin, technician at 360 px) |

**Not run or blocked:**

- PowerShell commands in the README were not executed, because no Windows machine was available. The bash sequence was run on Linux.
- `docker compose up` could not run (see above).
- The S3 storage adapter and a real SMTP provider were not tested; only local private storage and Mailpit were exercised.
- No load, soak or security penetration test was done. There was no manual screen-reader test and no Firefox or Safari run: E2E ran on Chromium only.
- Playwright used the pre-installed Chromium through `PLAYWRIGHT_CHROMIUM_PATH` because the bundled browser revision was not available here. On a normal machine, `npx playwright install chromium` is enough.

## 2. Automated test inventory

| Test | What it proves |
| --- | --- |
| `tests/integration/marketplace-flow.test.ts` › journey with isolation | request → invite → offers → selection → confirmation, with a second customer, uninvited provider and losing bidder denied at each step (records, offers, files, counts); idempotency key reused with a different payload → `IDEMPOTENCY_KEY_REUSED` |
| `…/marketplace-flow.test.ts` › public directory | only approved providers are exposed |
| `tests/integration/concurrency.test.ts` (5 tests) | parallel confirmations of one technician/time → exactly one; parallel selections → one booking; identical parallel retries → one booking; cancellation frees capacity and a conflicting reschedule keeps the original slot; expired offer refused, superseded version → `VERSION_CONFLICT` |
| `tests/integration/work-execution.test.ts` › changed scope | technician and read-only member cannot approve; stale version cannot be approved; a revised scope needs its own approval while the first approval stays intact; totals exact; report, acknowledgment/dispute and payments are separate; reported ≠ confirmed; partial payment and reversal balances; payment retries not duplicated; private files denied to other companies and to unassigned technicians after PDF generation |
| `…/work-execution.test.ts` › diagnostic only | the diagnostic visit completes and can be paid when the repair is declined |
| `tests/integration/maintenance-worker.test.ts` (3 tests) | plan needs customer consent; exactly one draft per due date on repeated runs; overdue pending bookings expire and the offer can be chosen again; a crashed worker's lease is reclaimed and effects stay idempotent |
| `tests/integration/memberships.test.ts` (2 tests) | onboarding cannot create a platform organization or grant `platform_admin`; staff limit counts members + pending invitations; invitations bound to the invited e-mail |
| `tests/integration/admin-routing.test.ts` | an administrator routes a breakdown to one eligible provider without being able to edit the request |
| `tests/e2e/01-public-and-access.spec.ts` (3) | public pages at 360 px with honest wording; sign-in required and each role stays in its workspace; guessed booking id through the API → not found |
| `tests/e2e/02-marketplace.spec.ts` | new account: sign-up, e-mail verification link from Mailpit, onboarding, site, equipment, 4-step request, invitation, provider offer with live total, **comparison and selection on a 390 px phone**, dispatcher confirmation with technician |
| `tests/e2e/03-field-work.spec.ts` (3) | read-only member cannot approve; **manager approves the exact quote version on a phone**; technician on a phone starts work, a fake image is refused and stays "Non enregistré" with retry, report submitted; customer acknowledges; PDF downloads; outsider denied; payments: reported vs confirmed amounts; change-order quote with live totals |
| `tests/e2e/04-admin.spec.ts` (2) | provider approval requires a verified identity check; manual routing of a breakdown; dispute mediation and resolution |
| `tests/e2e/05-accounts.spec.ts` (2) | staff invitation → registration → verification → joins as technician, seat limit shown; password reset by e-mail and sign-in with the new password |

## 3. Requirements matrix

Main code locations: pages in `src/app/**`, API in `src/app/api/v1/**`, domain services in
`src/server/modules/*.ts`, database in `prisma/schema.prisma` and `prisma/migrations/*`, worker in
`src/server/worker/*`.

### §4 Visual quality and frontend behavior

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Calm design tokens (warm white, navy, teal, amber) | Inspected | `src/app/globals.css` (`@theme` tokens), screenshots |
| Desktop sidebar, mobile drawer, simple technician interface | Inspected | `src/components/domain/app-shell.tsx`, `shell-client.tsx`, `src/app/technicien/**` |
| No horizontal scroll at 360/768/1440 px; labelled scroll area for comparison | Tested | crawl (0 problems); `expectNoHorizontalOverflow` in E2E; `offer-comparison.tsx` shows cards below `md` and a labelled `role=region` table above |
| Reusable components (provider card, filters, status badges, comparison, booking summary, calendar, equipment cards, timeline, uploader, quote line editor, approval panel, notifications, pagination, confirmation dialogs) | Inspected | `src/components/domain/*`, `src/components/ui/*`, `src/features/*` |
| Loading, empty, validation, server-error and success states; input preserved after failure; success only after the server confirms | Inspected | `loading.tsx`/`error.tsx`, `EmptyState`, `FormError`/field errors; forms keep values on API errors; toasts follow the API response |
| Real upload progress and visible failed/unsaved uploads | Tested | `document-uploader.tsx` (XHR progress, "Non enregistré" + retry), E2E 03 |
| Semantic HTML, focus, labels, keyboard dialogs, contrast, status not only by color, reduced motion | Tested (automated scan) | axe 0 violations; badges carry text + icon; `prefers-reduced-motion` in `globals.css`; dialogs are native `<dialog>` with focus return |
| No invented testimonials, counts, guarantees or ratings; demo data labelled | Inspected | public pages (E2E 01 checks wording); "Démonstration" badges on seed providers, checks and reviews |
| Manifest, icons, offline page without caching private data | Inspected | `src/app/manifest.ts`, `icon.svg`, `apple-icon.png`, `/hors-ligne`, `public/sw.js` registered by `service-worker.tsx` (network first; never caches API responses, documents or private pages) |
| Centralized branding | Inspected | `APP_NAME`, `Brand` component, `src/messages/fr.json` |

### §5 Roles and pages

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Five roles through real sessions and server permissions | Tested | `src/server/auth/*`, `src/server/api.ts` (`actorRoute` with org types/roles), RLS; E2E 01 |
| Multi-organization membership, active membership resolved per request | Tested | `setActiveOrganization`, `/api/v1/me/active-organization`; `withActor` sets context transaction-locally; `memberships.test.ts` |
| No public path to platform admin; documented admin command | Tested | `npm run admin:create`; `memberships.test.ts` |
| Public: home, how it works, directory, search/filter, profile, pricing, contact | Tested | `src/app/(public)/**`; E2E 01 |
| Auth: register, sign-in, sign-out, verification, reset, onboarding | Tested | `src/app/(auth)/**`, `/onboarding`; E2E 02, 05 |
| Customer screens (dashboard, sites/equipment CRUD, wizard, request detail/offers, comparison, bookings, approvals, history, documents, payments, notifications) | Tested (core) / Inspected (rest) | `src/app/client/**`; E2E 02, 03; crawl |
| Provider screens (dashboard, profile/areas, staff, availability/calendar, invitations, offer editor, bookings, assignments, repair quotes, reports, plans, subscription) | Tested (core) / Inspected (rest) | `src/app/prestataire/**`; E2E 02, 03, 05 |
| Technician screens (today, job detail, status actions, notes, findings, photos, report) | Tested | `src/app/technicien/**`; E2E 03 on a 390 px viewport |
| Admin screens (provider review, areas/categories, unmatched requests, disputes, review moderation, subscriptions, audit) | Tested (review, routing, disputes) / Inspected (rest) | `src/app/admin/**`; E2E 04 |
| Shared: account settings, organization switcher, notifications, timeline | Inspected | `/compte`, shell switcher, `/notifications`, `BookingView` timeline |
| Invitation acceptance for provider staff and customer colleagues | Tested (provider staff) / Inspected (customer colleagues, same code path) | `/invitations/[id]`, `acceptInvitation`; E2E 05 |
| Safe return URL through sign-in | Tested | `safeNext` in auth forms; E2E 05 (`/connexion?next=` → invitation) |
| Customer invites an unregistered provider, who must still pass checks | Inspected | `referProvider` (`/api/v1/referrals`), provider approval requires checks (E2E 04) |

### §6 Business journeys

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| **A.** Request wizard with site/equipment, diagnostic or maintenance, symptoms, photos, windows; asset ownership validated | Tested | `request-wizard.tsx`, `requests.ts` (`createRequestDraft`, `submitRequest`); DB composite FKs; E2E 02, integration |
| **A.** Provider search by category, city/service area, published service hours; paginated, filters in the URL, honest empty states | Tested | `searchProviders`, `/prestataires`; integration (approved only), E2E 01 |
| **A.** Search by *declared availability* | **Partial** | The directory filters by published service hours for a weekday. Technician availability windows are not used in public search. They are enforced when the provider confirms the booking. |
| **A.** Invite up to 3 eligible providers (customer or routing admin); limited brief before selection; breakdown routed to one company; unassigned / awaiting / confirmed shown | Tested | `inviteProviders` (max 3, eligibility), RLS brief projection, `admin-routing.test.ts`, E2E 04 |
| **B.** Structured offer (scope, call-out, diagnostic/fixed fee, tax, window, duration, exclusions, cancellation, expiry, warranty) | Tested | `offer-editor.tsx`, `saveOfferDraft`/`issueOffer`; E2E 02 |
| **B.** MAD display; diagnostic separate from repair; "Devis de réparation après diagnostic" | Tested | `offer-comparison.tsx`; E2E 02 amount assertions |
| **B.** Drafts editable, issued versions immutable (DB trigger), revisions supersede; missing information disclosed; competitors' offers hidden | Tested | triggers in `…_security/migration.sql`; `concurrency.test.ts`, `marketplace-flow.test.ts` |
| **C.** Selection of a specific version → pending booking, locked against competing selection | Tested | `selectOfferVersion`, partial unique index; `concurrency.test.ts` |
| **C.** Provider confirms technician + conflict-free slot; pending label until then | Tested | `confirmBooking`, exclusion constraint; E2E 02 |
| **C.** Decline/timeout → customer re-chooses; expiry and availability revalidated; history kept; no duplicate active booking | Tested | `declineBooking`, `expireOverdueBookings`; `maintenance-worker.test.ts` |
| **C.** Cancellation, no-show, reschedule with reasons + audit; other party accepts; original kept until replacement commits; no unapproved charges | Tested | `cancelBooking`, `reportNoShow`, `proposeReschedule`/`respondToReschedule`; `concurrency.test.ts` |
| **D.** Technician on site and findings; versioned repair quote (parts, labor, qty, tax, timing, exclusions, warranty); approval of the exact version | Tested | `performWorkAction`, `saveRepairQuoteDraft`, `issueRepairQuote`, `decideRepairQuote`; `work-execution.test.ts`, E2E 03 |
| **D.** Approval stores approver, time, version, amount/currency, snapshot hash; approved version immutable; retries not duplicated; new scope needs new approval | Tested | `Approval` model + triggers; `work-execution.test.ts` |
| **D.** Approved scope required before repair; maintenance offer pre-authorizes its own work only; diagnostic-only completion | Tested | transition checks in `work.ts`; `work-execution.test.ts` (diagnostic only) |
| **E.** Timestamped job events with validated transitions; no free-form status endpoint | Tested | `/work-orders/[id]/events` accepts named actions only; `JobEvent`; DB transition trigger |
| **E.** Service report (findings, work, linked approved scope, parts, photos, recommendations, follow-up date); PDF from persisted data; not a certificate | Tested | `submitReport`, worker `generateReportPdf`, `src/server/pdf/render.ts`; E2E 03, `pdf.test.ts` |
| **E.** Acknowledgment or dispute kept separate from work status; admin resolution appended, not rewritten; pending acknowledgment shown honestly | Tested | `respondToReport`, `adminDisputeAction`, `DisputeEvent`; `work-execution.test.ts`, E2E 04 |
| **F.** Direct payments: cash/transfer/other, date, optional private evidence; `REPORTED` vs `CONFIRMED`; customer cannot confirm; admin corrections with reason + audit | Tested | `recordPayment`, `updatePayment`; `work-execution.test.ts`, E2E 03 |
| **F.** Partial payments, confirmed balance, explicit reversals, no deletion; completed ≠ paid | Tested | `paymentSummary`; `work-execution.test.ts` |
| **F.** Editable pilot plan 399 MAD/month excl. tax, 3 staff; manual admin periods, audited; expiry blocks new offers/plans only | Tested (staff limit) / Inspected (periods, expiry) | `SubscriptionPlan`, `recordSubscriptionPeriod`, `assertEntitled`; `memberships.test.ts`; rules in `docs/ARCHITECTURE.md` |
| **F.** Maintenance plans: provider-entered recurrence, customer consent, reminders/draft requests only, unique occurrence key | Tested | `proposePlan`, `decidePlan`, `generateMaintenanceOccurrences`; `maintenance-worker.test.ts` |
| **F.** One review per eligible booking, moderation, provider reply, ratings from published reviews | Inspected | `createReview`, `moderateReview`, `respondToReview`; unique index on `review.booking_id` |

### §7 Data model and integrity

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| All listed entities | Done | `prisma/schema.prisma`: 55 models, including Better Auth's `User`/`Session`/`Account`/`Verification`/`Organization`/`Member`/`Invitation` (no parallel identity tables) |
| FKs, delete policies, indexes, uniqueness, optimistic `version` fields | Tested | schema + migrations; `VERSION_CONFLICT` tests |
| Composite relationships against mismatched ownership (asset ↔ customer, technician ↔ provider) | Tested | composite FKs in `…_init` and `…_security`; integration isolation tests |
| Archival instead of deletion for assets with history; issued documents preserved | Inspected | `setSiteArchived`, `setEquipmentArchived`; document deletion limited to non-issued uploads |
| Money in integer centimes with currency; server totals; documented rounding; no inferred tax rate | Tested | `src/lib/money.ts`, `money.test.ts`; tax rate entered by the issuer |
| Separate state machines and a documented transition table | Done | `docs/ARCHITECTURE.md` §4; DB triggers |

### §8 Cross-company authorization

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Customer / invited provider / losing bidder / chosen provider / technician visibility rules | Tested | 167 RLS policies on 51 tables (`…_security/migration.sql`); `marketplace-flow.test.ts`, `work-execution.test.ts`, E2E 01/03 |
| Shared vs internal vs private notes and documents | Tested | `WorkOrderNote.visibility`, `Document.visibility`; integration tests |
| Admin support with explicit privileges and audited access | Inspected | `platform_admin` policies, `auditAdminView` (`admin.viewed` events), `/admin/audit` |
| Centralized server authorization + RLS; non-owner runtime role without `BYPASSRLS`; separate migration role | Tested | services check actor/role, then RLS; roles `mh_owner`/`mh_app`/`mh_auth`/`mh_worker`; integration suite runs as `mh_app` |
| Transaction-local context from the verified session; no header-based org context | Tested | `src/server/db/context.ts` (`set_config(…, true)`) |
| Auth library restricted to identity tables | Done | `mh_auth` grants only on identity tables |
| Worker, PDFs, counts, exports and file links respect the same boundaries | Tested | worker uses `mh_worker` with validated references; every download goes through `authorizeDownload` under RLS, then is streamed (local) or redirected to a 60-second presigned URL (S3); `work-execution.test.ts` |
| `src/server/policies` | Not used | Authorization lives in the services (`actorRoute` role/org checks + per-operation checks) and in RLS, not in a separate policies folder |

### §9 Concurrency and retries

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| One short confirmation transaction (lock, validate, capability/availability, reserve, update, outbox) | Tested | `confirmBooking`; `concurrency.test.ts` |
| Exclusion constraint with half-open UTC ranges and travel/setup buffers; timezone tests | Tested | `appointment_reservation` `EXCLUDE USING gist (… tstzrange(blocked_start, blocked_end, '[)') …)`; `time.test.ts` |
| No moving `now()` in partial indexes; no temporary holds | Done | pending selection is provisional; confirmation takes the reservation |
| Idempotency keys scoped to actor/org + operation, request hash, stored outcome, reuse with other payload fails | Tested | `IdempotencyRecord`; `concurrency.test.ts`, `marketplace-flow.test.ts`, `work-execution.test.ts` |
| One active booking per request; one effective selection | Tested | partial unique index `booking_one_active_per_request`; `concurrency.test.ts` |
| Actionable version/slot conflict errors | Tested | `VERSION_CONFLICT`, `SLOT_CONFLICT` shown in UI with refresh prompt |

### §10 API

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Typed schemas and documented endpoints under `/api/v1` for every listed resource | Done | 104 route files under `src/app/api/v1`; zod schemas in `src/lib/schemas.ts`; `docs/API.md` |
| Pagination and bounded input sizes | Done | `page` query parameter with fixed server-side page sizes (`paginationQuery`); length/array maxima in every schema |
| Consistent error codes, no existence leaks, no raw DB errors | Tested | `src/server/errors.ts`; private resources return `NOT_FOUND` (E2E 01, integration) |
| Totals and counts from real data; indexes; no per-row query loops | Inspected | dashboards use aggregate queries; indexes in schema |
| No shared user-specific caching | Done | dynamic rendering for private pages; `Cache-Control: no-store, private` on the API |

### §11 Files, e-mail, jobs, security

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Private storage outside `public/`, opaque keys, recorded scope, authorization before signed link | Tested | `src/server/storage/index.ts`, `documents.ts`; E2E 03 (outsider denied) |
| Content sniffing (not filename/MIME), type/size/count caps, no path traversal, failed uploads visible, abandoned objects cleaned | Tested | `file-type` signature check, `assertSafeKey`, `cleanupAbandonedUploads`; E2E 03 (fake JPEG refused), `security-helpers.test.ts` |
| Better Auth sessions/passwords, trusted origins, safe redirects, origin checks on mutations, secure cookies, rate limits (sign-in, reset, invitations, uploads) | Tested (auth flows) / Inspected (limits) | `src/server/auth/auth.ts`, `src/server/http.ts`; E2E 05 |
| Customer content rendered as text; no HTML/URLs in PDFs | Done | React escaping; PDFs built from plain fields |
| Startup validation of settings; production refuses insecure fallbacks | Tested | `src/server/env.ts`; `tests/unit/env.test.ts` |
| Log redaction; retention and anonymization documented | Done | worker error redaction; `docs/DEPLOYMENT.md` §9; `npm run user:anonymize` (dry run by default) |
| Transactional outbox + durable worker with retries, backoff, attempt limits, visible failures; at-least-once | Tested | `OutboxEvent`, `EmailDelivery`, `src/server/worker/*`; `maintenance-worker.test.ts`; admin dashboard queue status |
| Local e-mail capture; production adapter documented; SMS/WhatsApp/payment gateways visibly unavailable | Tested (Mailpit) / Deferred (others) | nodemailer SMTP; E2E 02/05 read Mailpit |

### §12 Seed and local setup

| Requirement | Status | Where / evidence |
| --- | --- | --- |
| Idempotent fictional seed: 2 customers, 3 sites, 10 assets, 3 providers, all role accounts, every listed scenario, dates relative to the seed run | Tested | `scripts/seed.ts` (runs real services under a demo clock); fresh-install check; E2E runs on it |
| Refuses production and requires `ALLOW_DEMO_SEED=true` | Done | `scripts/seed.ts` |
| Docker Compose for PostgreSQL + Mailpit | Partial | `docker-compose.yml` validated, not started here (Docker Hub blocked) |
| PowerShell and WSL/bash instructions, URLs, two terminals | Partial | `README.md`; bash path executed, PowerShell not executed |
| Documented scripts all exist | Done | `package.json`, README §6 |

### §13 Acceptance criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Full core journey across separate real accounts and sessions | Tested | E2E 02 (new account → confirmation) + E2E 03 (approval → report → acknowledgment → payments, on seeded jobs); at service level `marketplace-flow.test.ts` (request → confirmation) and `work-execution.test.ts` (confirmed booking → payments) |
| 2 | Diagnostic-only job when repair is declined | Tested | `work-execution.test.ts` |
| 3 | Second customer, uninvited provider, losing bidder cannot read others' data (IDs, API, files, search, aggregates) | Tested | `marketplace-flow.test.ts`, `work-execution.test.ts`, E2E 01, E2E 03 |
| 4 | Technician cannot approve costs or read unassigned jobs | Tested | `work-execution.test.ts` |
| 5 | Concurrent confirmations/selections | Tested | `concurrency.test.ts` |
| 6 | Expired/superseded offer refused; changed scope needs own approval | Tested | `concurrency.test.ts`, `work-execution.test.ts` |
| 7 | Identical retries not duplicated; changed payload under same key fails | Tested | `concurrency.test.ts`, `marketplace-flow.test.ts`, `work-execution.test.ts`, `maintenance-worker.test.ts` |
| 8 | Cancellation/reschedule release or replace capacity safely | Tested | `concurrency.test.ts` |
| 9 | Reported ≠ confirmed; partial payments and reversals | Tested | `work-execution.test.ts`, E2E 03 |
| 10 | Dispute without deleting history or merging states | Tested | `work-execution.test.ts`, E2E 04 |
| 11 | Worker restart/retry without duplicate effects; files protected after processing | Tested | `maintenance-worker.test.ts`, `work-execution.test.ts` |
| 12 | Mobile forms, comparison, approvals, technician photo/report; failed uploads visibly unsaved | Tested | E2E 02 (comparison + selection at 390 px), E2E 03 (approval and technician flow at 390 px, refused upload), crawl at 360 px |

### §14 Deliverables

| Deliverable | Status |
| --- | --- |
| Frontend + backend with real database | Done |
| Schema, migrations, RLS, indexes, constraints | Done |
| Local auth, seed, demo access | Done (`README.md` §4) |
| Worker, notifications, PDFs, private files | Done (local storage; S3 adapter untested) |
| Setup, scripts, test summaries | Done (this file §1) |
| `README.md` (French), `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, this file | Done |

## 4. Deferred by design

These are excluded by the master prompt or need credentials and authorization that were not given:

- Native apps
- IoT
- AI diagnosis
- Parts commerce
- Emergency guarantees
- Vehicle tracking
- Escrow, card checkout and payouts
- SMS/WhatsApp sending

These deferred features appear nowhere in the interface as working options.

## 5. Known limitations

1. **Not deployed; production adapters untested.** The S3 adapter (`STORAGE_DRIVER=s3`) and SMTP with a real provider were never exercised. Test both before a pilot (`docs/DEPLOYMENT.md` §5–6).
2. **Support-form rate limit is in memory,** one limiter per web instance. Other limits are database-backed. Replace it with a shared store before running several web instances.
3. **Directory "declared availability"** uses published service hours only (see §6 A above).
4. **French only.** Strings are centralized in `src/messages/fr.json`, but Arabic/RTL is not implemented.
5. **No appointment-day reminder e-mails.** Reminders exist for maintenance plans, and notifications are sent on every booking and work event.
6. **Report PDFs embed JPEG photos only** (up to 8). PNG/WebP photos stay downloadable from the job but are not embedded, because the PDF library decodes PNG asynchronously and a malformed file could not be contained safely.
7. **No automated retention purge.** Retention is documented, and the purge queries must be scheduled by the operator (`docs/DEPLOYMENT.md` §9).
8. **Demo data ages.** Scenarios are dated relative to the seed run. The pending booking expires after 24 hours (confirmation deadline) and "today" jobs become past jobs. Re-create the demo with `npm run db:reset-dev -- --yes`, `npm run db:migrate` and `npm run db:seed`. Completed demo jobs were replayed through the real services with a shifted clock (`scripts/lib/demo-clock.ts`), so their timestamps are consistent but synthetic.
9. **Log noise.** When a browser aborts a navigation mid-stream, Next.js logs `The destination stream closed early`. It is harmless and does not affect the response.
10. **Tested only with Node.js 22 and Chromium.** Firefox/Safari and Node 24 were not tested.
11. **Accessibility scans cover the loaded state of each page.** Open dialogs, error states and screen-reader flows were checked only by hand (keyboard) or not at all.
12. **Legal.** Personal-data handling (loi 09-08, CNDP declaration), commercial terms, cancellation terms and invoicing/tax compliance need legal review. The software issues quotes and reports, not legal invoices.

## 6. Next steps

1. Run the Windows/PowerShell setup from `README.md` on the target machine with Docker Desktop, and fix any path or quoting issue found.
2. Provision a staging environment (`docs/DEPLOYMENT.md`) and test S3 uploads/downloads, real SMTP (SPF/DKIM) and a backup/restore rehearsal.
3. Replace the in-memory support limiter with a database-backed one.
4. Get legal review of the data-processing notice, retention periods and pilot terms. Then prepare a small pilot with real providers who have agreed to take part.
5. Consider next:
   - technician availability windows in public search;
   - appointment reminders;
   - PNG/WebP embedding in PDFs (convert to JPEG in the worker);
   - an Arabic interface;
   - a scheduled retention purge.
