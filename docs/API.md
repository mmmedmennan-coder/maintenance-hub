# API `/api/v1`

The web interface uses the same endpoints as any other client. Route handlers are thin: they parse
and validate input with the Zod schemas of `src/lib/schemas.ts`, resolve the acting membership and
call a domain service in `src/server/modules`, which authorizes the action and runs it in one
transaction under row-level security.

## Conventions

| Topic | Rule |
| --- | --- |
| Authentication | Better Auth session cookie (`mh.session_token`), obtained through `/api/auth/*` (sign-up, sign-in, e-mail verification, password reset, sign-out). |
| Acting organization | The session's active organization, validated against the user's memberships (`POST /api/v1/me/active-organization` to switch). Never taken from a header. |
| CSRF | Mutations must come from the application origin (`Origin` = `APP_URL`, or `Sec-Fetch-Site: same-origin`). |
| Body | JSON (`Content-Type: application/json`), 64 KB maximum. File content: raw body on `PUT /documents/{id}/content`, 10 MB maximum. |
| Success | `200 { "data": … }`, with `Cache-Control: no-store, private`. |
| Error | `{ "error": { "code", "message", "details"? } }`; `details.fields` maps field paths to French messages. Database errors and secrets are never returned. |
| Private resources | Resources the caller may not see answer `404 NOT_FOUND` (no existence leak). |
| Money | Inputs are strings such as `"1 234,50"` or numbers in MAD; responses use integer centimes (`…Minor`) with `currency: "MAD"`. |
| Time | Inputs use local Casablanca date `YYYY-MM-DD` and time `HH:MM`; responses are ISO-8601 UTC instants. |
| Pagination | `?page=N` (1-based) on list endpoints; responses include `total`, `page`, `pageSize`. |
| Idempotency | `Idempotency-Key: <8–100 chars [A-Za-z0-9_-]>` accepted on the operations marked **(idem)**. Same key + same body → the stored outcome; same key + different body → `422 IDEMPOTENCY_KEY_REUSED`. |

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid input (see `details.fields`) |
| `UNAUTHENTICATED` | 401 | No valid session |
| `ENTITLEMENT_REQUIRED` | 402 | Provider subscription inactive (new offers / plans only) |
| `FORBIDDEN` | 403 | Role or organization type not allowed, or cross-origin mutation |
| `NOT_FOUND` | 404 | Missing or not visible to the caller |
| `SLOT_CONFLICT` | 409 | Technician overlap (exclusion constraint), outside declared availability or time off |
| `VERSION_CONFLICT` | 409 | The record changed (stale `expectedLockVersion` / `version` / snapshot) |
| `INVALID_TRANSITION` | 409 | Action not allowed in the current state |
| `CONFLICT` | 409 | Uniqueness (e.g. one active booking per request, already invited) |
| `PAYLOAD_TOO_LARGE` | 413 | Body or file too large |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | JSON expected |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Key reused with another payload |
| `RATE_LIMITED` | 429 | Too many sign-ins, resets, invitations, uploads or support messages |
| `INTERNAL` | 500 | Unexpected error (logged server-side without personal data) |

Role abbreviations below: **C-W** customer owner/manager, **C-R** any customer member (incl. viewer),
**P-M** provider owner/dispatcher, **T** technician (assigned jobs only), **A** platform administrator,
**Any** any signed-in member (visibility decided by RLS), **Public** no session required.

## Public, identity and account

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /categories` | Public | — | Active equipment categories |
| `GET /service-areas` | Public | — | Active service areas (cities, routing hours) |
| `GET /providers` | Public | `categoryId`, `serviceAreaId`, `city`, `weekday` (1–7, published service hours), `date` (YYYY-MM-DD, today to +90 days: at least one active technician declared available that day, with the category skill if `categoryId` is set; provisional), `q`, `page` | Approved profiles only, 9 per page; ratings from published reviews |
| `GET /providers/{slug}` | Public | `reviewPage` | Approved profile, verified checks (with dates and demo flag), published reviews |
| `POST /support` | Public | `supportMessageSchema` (name, email, organizationName?, topic, message) | 5 messages per client address per hour (PostgreSQL counter shared by all web instances), then `RATE_LIMITED` |
| `GET /me` | session | — | User, memberships, active organization |
| `POST /me/active-organization` | session | `{ organizationId }` | Must be one of the user's memberships |
| `POST /onboarding` | session (no membership) | `{ type: CUSTOMER|PROVIDER, name, city }` | Creates the organization, owner membership (and a DRAFT provider profile). Never grants platform administrator. |
| `POST /invitations/{id}/accept` | session | — | E-mail must match the invitation; creates the membership (and technician profile) |
| `GET /organization/members` | C-R, P-M | — | Members, pending invitations, staff limit |
| `POST /organization/invitations` | owners (dispatcher: technicians only) | `{ email, role }` | Staff limit from the plan; 20 invitations/day |
| `DELETE /organization/invitations/{id}` | owners | — | |
| `PATCH /organization/members/{id}` | owners | `{ role }` | Roles valid for the organization type; at least one owner remains |
| `DELETE /organization/members/{id}` | owners | — | Technician profile deactivated, history kept |
| `POST /referrals` | C-W | `{ email, companyName, message? }` | Invites a provider to register (e-mail through the queue); it still needs verification |
| `GET /notifications` | Any | `page` | Own notifications |
| `POST /notifications/read` | Any | `{ ids: "all" | uuid[1..100] }` | Marks own notifications read |

## Sites and equipment

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /sites` | C-R | `archived=0|1` | |
| `POST /sites` | C-W | `siteSchema` | Service area derived from the city |
| `GET /sites/{id}` · `PATCH /sites/{id}` | C-R · C-W | `siteUpdateSchema` (+ `version`) | Optimistic `version` |
| `POST /sites/{id}/archive` | C-W | `{ archived: boolean }` | Archive instead of delete |
| `GET /equipment` | C-R | `siteId`, `categoryId`, `archived`, `page` | |
| `POST /equipment` | C-W | `equipmentSchema` | Site must belong to the organization |
| `GET /equipment/{id}` · `PATCH` | C-R · C-W | `equipmentUpdateSchema` (+ `version`) | |
| `POST /equipment/{id}/archive` | C-W | `{ archived }` | |
| `GET /equipment/{id}/history` | C-R | — | Completed work orders with reports |

## Requests, invitations and offers

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /requests` | C-R | `status`, `page` | |
| `POST /requests` | C-W | `requestDraftSchema` (equipmentId, kind DIAGNOSTIC/MAINTENANCE/BREAKDOWN, title, symptoms, 1–3 future `preferredWindows`) | Creates a DRAFT; equipment must be the customer's and active |
| `GET /requests/{id}` | C-R, A | — | Request, invitations, issued offer versions, documents |
| `PATCH /requests/{id}` | C-W | `requestUpdateSchema` (+ `version`) | Drafts only |
| `POST /requests/{id}/submit` | C-W | — | DRAFT → OPEN; refused while uploads are pending |
| `GET /requests/{id}/eligible-providers` | C-W | — | Approved, covering the area and category, not yet invited |
| `POST /requests/{id}/invite` | C-W | `{ providerOrgIds: uuid[] }` | Max 3 active invitations; each provider receives a limited brief |
| `POST /request-invitations/{id}/revoke` | C-W | — | |
| `POST /requests/{id}/cancel` | C-W | `{ reason }` | No active booking |
| `POST /requests/{id}/reopen` | C-W | — | After a declined/expired/cancelled/no-show booking |
| `GET /provider/invitations` | P-M | `status`, `page` | |
| `GET /provider/invitations/{id}` | P-M | — | Brief, shared attachments, own offer versions |
| `POST /provider/invitations/{id}/decline` | P-M | `{ reason? }` | |
| `PUT /provider/invitations/{id}/offer` | P-M | `offerDraftSchema` | Creates/updates the editable DRAFT version |
| `POST /offers/{id}/issue` **(idem)** | P-M | — | Active subscription; freezes and hashes the version, supersedes the previous issued one |
| `POST /offers/{id}/withdraw` | P-M | `{ reason }` | Not after selection |
| `DELETE /offers/{id}/draft` | P-M | — | |
| `POST /offer-versions/{id}/select` **(idem)** | C-W | — | Exact version, not expired/superseded; creates a PENDING booking; one active booking per request |

`offerDraftSchema`: `kind`, `scope`, `calloutFee?`, `serviceFee`, `taxRate` (percent, issuer-entered),
`taxNote?`, `windowDate`, `windowStart`, `windowEnd`, `estimatedDurationMin`, `exclusions?`,
`cancellationTerms`, `warrantyTerms?`, `validDays` (1–30). A diagnostic offer never includes repair
parts or labour (`repairPricing: AFTER_DIAGNOSIS` in the hashed snapshot).

## Bookings and scheduling

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /bookings` | C-R, P-M | `status`, `page` | |
| `GET /bookings/{id}` | Any party, T (assigned), A | — | Booking, offer version, work order, quotes, report, notes, disputes, timeline, documents; site access details only after confirmation |
| `POST /bookings/{id}/confirm` **(idem)** | P-M | `{ technicianId, date, start, durationMin, bufferBeforeMin, bufferAfterMin, expectedLockVersion }` | See `SLOT_CONFLICT`, `VERSION_CONFLICT` |
| `POST /bookings/{id}/decline` | P-M | `{ reason }` | |
| `POST /bookings/{id}/cancel` | C-W, P-M | `{ reason }` | Before work starts; releases the reservation |
| `POST /bookings/{id}/no-show` | C-W, P-M | `{ absentSide, note }` | After the start time, reporting the other side |
| `POST /bookings/{id}/reschedule-proposals` | C-W, P-M | `{ date, start, durationMin, technicianId?, reason }` | Provider proposals are checked for availability |
| `POST /reschedule-proposals/{id}/respond` | the other party | `{ accept, note?, technicianId? }` | Acceptance swaps reservations atomically |
| `POST /reschedule-proposals/{id}/withdraw` | proposer | — | |
| `GET /provider/calendar` | P-M, T (own) | `week` (Monday), `technicianId?` | Windows, time off, active reservations |
| `GET/POST /provider/technicians`, `PATCH /provider/technicians/{id}` | P-M | `technicianSchema` | Skills = equipment categories; optional linked member |
| `POST /provider/availability`, `DELETE /provider/availability/{id}` | P-M | `{ technicianId, weekday, start, end }` | |
| `POST /provider/time-off`, `DELETE /provider/time-off/{id}` | P-M | `{ technicianId, startDate, startTime, endDate, endTime, reason? }` | |

## Work orders, repair quotes and reports

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `POST /work-orders/{id}/events` | T, P-M | `{ action: START_TRAVEL|ARRIVE|START_WORK|WAIT_FOR_PARTS, note?, expectedLockVersion }` | Only these named actions; START_WORK/WAIT_FOR_PARTS need an approved scope |
| `POST /work-orders/{id}/notes` | C-W, T, P-M | `{ body, visibility }` | Customers: SHARED/CUSTOMER_PRIVATE; providers: SHARED/PROVIDER_INTERNAL |
| `POST /work-orders/{id}/repair-quotes` | T, P-M | `repairQuoteSchema` | Starts a new quote (first = repair, next = change orders) as DRAFT |
| `POST /repair-quotes/{id}/versions` | T, P-M | `repairQuoteSchema` (+ `revisionReason` when revising) | Creates/updates the DRAFT version |
| `POST /repair-quote-versions/{id}/issue` **(idem)** | T, P-M | — | Hash of the canonical snapshot; work order → AWAITING_APPROVAL |
| `POST /repair-quote-versions/{id}/withdraw` | T, P-M | — | Draft deleted, issued → WITHDRAWN |
| `POST /repair-quote-versions/{id}/decision` **(idem)** | C-W only | `{ decision: APPROVED|REJECTED, expectedSnapshotHash, reason? }` | Technicians and viewers get 403; stale hash → 409 |
| `POST /work-orders/{id}/reports` **(idem)** | T, P-M | `reportSchema` (findings, workPerformed, partsUsed?, recommendations?, nextServiceDate?, photoDocumentIds ≤ 12) | No pending quote; photos must be READY and belong to the job |
| `POST /work-orders/{id}/acknowledgment` | C-W | `{ decision: ACKNOWLEDGE|DISPUTE, reason? }` | DISPUTE needs ≥ 10 characters and opens a dispute |
| `GET /reports/{id}/pdf` | parties, A | — | `303` to the authorized download once the worker generated it |

`repairQuoteSchema`: `scopeSummary`, `lines[1..40]` (`kind` PART/LABOR/TRAVEL/OTHER, `description`,
`quantity`, `unitPrice` excl. tax, `taxRate`), `estimatedDurationMin?`, `timingNote?`, `exclusions?`,
`warrantyTerms?`, `validDays`, `revisionReason?`. Totals are always computed on the server.

## Documents

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `POST /documents` | C-W, T, P-M | `{ kind: PHOTO|ATTACHMENT|PAYMENT_EVIDENCE, fileName, sizeBytes ≤ 10 MB, requestId | workOrderId | equipmentId, shareWithProviders? }` | Returns `{ documentId, uploadUrl, maxBytes }`; 12 files per target, hourly cap per user |
| `PUT /documents/{id}/content` | uploader | raw bytes | Actual type sniffed (JPEG, PNG, WebP, PDF); `READY` or `FAILED` |
| `GET /documents/{id}/download` | whoever RLS allows | `inline=1` | Streams (local) or redirects to a 60 s signed URL (S3); admin views audited |
| `DELETE /documents/{id}` | owner organization | — | Not for files attached to a submitted report or payment |

## Payments, maintenance, reviews, disputes

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /bookings/{id}/payments` | C-R, P-M, A | — | Records, events and balance summary |
| `POST /bookings/{id}/payments` **(idem)** | C-W (→ REPORTED), P-M (→ CONFIRMED) | `{ amount, method CASH|BANK_TRANSFER|CHEQUE|OTHER_EXTERNAL, paidOn ≤ today, externalReference?, note?, evidenceDocumentId? }` | No money moves through the platform |
| `POST /payments/{id}` **(idem)** | P-M (payee), A (reverse) | `{ action: CONFIRM|REJECT|REVERSE, reason? }` | Reject/reverse require a reason; history kept |
| `GET /maintenance-plans` | C-R, P-M | — | |
| `POST /maintenance-plans` | P-M | `{ equipmentId, title, scope, intervalMonths, reminderLeadDays, firstDueDate }` | Only for assets the provider already served; active subscription |
| `POST /maintenance-plans/{id}` | C-W (CONSENT/DECLINE/RESUME), both (PAUSE/END) | `{ action, note? }` | |
| `GET /provider/serviceable-equipment` | P-M | — | Assets eligible for a plan |
| `POST /bookings/{id}/review` | C-W | `{ rating 1–5, comment? }` | Completed booking, one review, pending moderation |
| `POST /reviews/{id}/response` | P-M | `{ body }` | One reply per review |
| `POST /disputes/{id}/comments` | parties, A | `{ body }` | |
| `POST /disputes/{id}/withdraw` | C-W | — | |

## Provider profile and subscription

| Method & path | Who | Input | Notes |
| --- | --- | --- | --- |
| `GET /provider/profile` | provider members | — | |
| `PUT /provider/profile` | P-M | `providerProfileSchema` (+ `version`) | Service areas, categories, weekly service hours (closed days omitted) |
| `POST /provider/profile/submit` | P-M | — | Completeness checks (summary, description, areas, categories, a technician with availability) |
| `GET /provider/subscription` | P-M | — | `{ active, paidUntil, planName, maxStaff }` |

## Administration (platform administrator only)

| Method & path | Input | Notes |
| --- | --- | --- |
| `GET /admin/metrics` | — | Live counts, confirmation rate, queue health |
| `GET /admin/providers`, `GET /admin/providers/{id}` | `status` | Detail view is audited |
| `POST /admin/providers/{id}/checks` | `{ type, status, publicNote?, internalNote?, expiresAt? }` | |
| `POST /admin/providers/{id}/review` | `{ decision: APPROVE|REJECT|SUSPEND|REINSTATE, reason }` | Approval requires a verified BUSINESS_IDENTITY check |
| `GET /admin/requests/unmatched` | — | Open requests without an active invitation, breakdowns first |
| `POST /admin/requests/{id}/route` | `{ providerOrgId, note? }` | Invites one eligible provider (audited) |
| `GET /admin/disputes`, `POST /admin/disputes/{id}` | `{ action: UNDER_REVIEW|COMMENT|RESOLVE, body }` | |
| `GET /admin/reviews`, `POST /admin/reviews/{id}`, `POST /admin/reviews/{id}/hide-response` | `{ decision: PUBLISH|REJECT, note? }` · `{ reason }` | |
| `GET /admin/subscriptions` | — | |
| `POST /admin/subscriptions/{providerOrgId}/periods` | `{ periodStart, periodEnd, amount?, reference?, reason }` | Manual pilot period |
| `POST /admin/subscriptions/{providerOrgId}/correction` | `{ paidUntil: date|null, reason }` | Audited correction |
| `PATCH /admin/plans/{id}` | `{ name, price, maxStaff, taxNote, active, reason }` | |
| `POST /admin/categories`, `PATCH /admin/categories/{id}` | `{ labelFr, code, active, sortOrder }` | |
| `POST /admin/service-areas`, `PATCH /admin/service-areas/{id}` | `{ name, code, cities[], routingHours, active }` | |
| `GET /admin/audit` | `targetType`, `targetId`, `page` | |
| `GET /admin/support`, `POST /admin/support/{id}` | — | Mark handled |

## Examples

Create a draft request (customer owner):

```http
POST /api/v1/requests
Content-Type: application/json

{ "equipmentId": "37c7d490-…", "kind": "DIAGNOSTIC", "title": "Vitrine à 10 °C",
  "symptoms": "La vitrine ne descend plus sous 10 °C depuis hier soir.",
  "preferredWindows": [{ "date": "2026-10-05", "start": "14:00", "end": "17:00" }] }
```

```json
{ "data": { "id": "3a157b6c-…", "reference": "DEM-000013" } }
```

Save and issue an offer (provider):

```http
PUT /api/v1/provider/invitations/fc89d988-…/offer
{ "kind": "DIAGNOSTIC", "scope": "Diagnostic de la vitrine.", "calloutFee": "100", "serviceFee": "250",
  "taxRate": "20", "windowDate": "2026-10-05", "windowStart": "14:00", "windowEnd": "17:00",
  "estimatedDurationMin": 60, "cancellationTerms": "Sans frais jusqu'à 24 h avant.", "validDays": 7 }
→ { "data": { "offerId": "…", "versionId": "…" } }

POST /api/v1/offers/{offerId}/issue
Idempotency-Key: 6f1c2f7e-5d0a-4a57-9e1f-2d7b8a0c9b11
→ { "data": { "versionId": "…", "versionNo": 1 } }
```

Confirm a booking with a conflicting slot:

```http
POST /api/v1/bookings/9fc947ea-…/confirm
Idempotency-Key: 0d9c…
{ "technicianId": "…", "date": "2026-10-05", "start": "14:00", "durationMin": 60,
  "bufferBeforeMin": 30, "bufferAfterMin": 30, "expectedLockVersion": 0 }
```

```json
{ "error": { "code": "SLOT_CONFLICT",
  "message": "Ce créneau chevauche une autre intervention du technicien. Actualisez le calendrier et choisissez un autre créneau." } }
```

Approve the exact repair quote displayed:

```http
POST /api/v1/repair-quote-versions/5e1f…/decision
Idempotency-Key: 8b2a…
{ "decision": "APPROVED", "expectedSnapshotHash": "a41c…(64 hex)", "reason": null }
→ { "data": { "decision": "APPROVED", "approvalId": "…", "duplicate": false } }
```

Declare a direct payment (customer) and confirm it (provider):

```http
POST /api/v1/bookings/{id}/payments
{ "amount": "420", "method": "BANK_TRANSFER", "paidOn": "2026-09-28", "externalReference": "VIR-123" }
→ { "data": { "paymentId": "…", "status": "REPORTED" } }

POST /api/v1/payments/{paymentId}
{ "action": "CONFIRM" }
→ { "data": { "paymentId": "…", "status": "CONFIRMED" } }
```

Validation error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Certains champs sont invalides.",
  "details": { "fields": { "taxRate": ["Taux invalide (0 à 100 %)."] } } } }
```

Upload a photo (two steps):

```http
POST /api/v1/documents
{ "kind": "PHOTO", "fileName": "evaporateur.jpg", "sizeBytes": 183422, "workOrderId": "…" }
→ { "data": { "documentId": "…", "uploadUrl": "/api/v1/documents/…/content", "maxBytes": 10485760 } }

PUT /api/v1/documents/…/content
Content-Type: application/octet-stream
<bytes>
→ { "data": { "ok": true, "documentId": "…", "status": "READY", "mimeType": "image/jpeg", "sizeBytes": 183422 } }
   (or an error such as 400/413, with the document marked FAILED)
```
