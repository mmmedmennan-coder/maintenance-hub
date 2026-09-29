# Deployment guide

This document prepares a pilot deployment. **Nothing has been deployed**: no public hosting, paid
service, DNS, bucket or e-mail account was created while building the application. Every step
below must be performed and verified by the operator.

## 1. Topology

```text
Internet ─TLS─► reverse proxy / platform load balancer ─► web: `npm run start` (Next.js, port 3000)
                                                            │
                                   worker: `npm run worker:start` (no inbound port)
                                                            │
                   PostgreSQL 16 (managed, private network) ┘  +  S3-compatible private bucket  +  SMTP provider
```

| Component | Requirement |
| --- | --- |
| Web | Node.js 22 LTS, `npm ci && npm run db:generate && npm run build`, then `npm run start` (set `PORT` if needed). Stateless: several instances are possible (sessions and rate limits live in PostgreSQL). |
| Worker | Same build and environment, `npm run worker:start`. At least one instance must run permanently; several are safe (`FOR UPDATE SKIP LOCKED`, leases). |
| PostgreSQL | 16.x with the `btree_gist` extension available, TLS, automated backups/PITR. |
| Storage | Private S3-compatible bucket (AWS S3, Scaleway, OVH, MinIO…). |
| E-mail | Transactional SMTP account with SPF/DKIM configured for the sending domain. |

Production refuses to start with an insecure configuration (`src/server/env.ts`): non-https
`APP_URL`, local e-mail capture (`SMTP_HOST=localhost`) or local file storage are rejected unless the
app runs on localhost for acceptance testing. Secure cookies are enabled automatically for https.

## 2. Environment and secrets

Provide the variables of `.env.example` through the hosting platform's secret store (never in the
image or repository):

- `NODE_ENV=production`, `APP_NAME`, `APP_URL=https://…`, `BETTER_AUTH_URL` (same origin).
- `BETTER_AUTH_SECRET`: 32+ random characters; rotating it signs everyone out.
- `DATABASE_URL` (`mh_app`), `AUTH_DATABASE_URL` (`mh_auth`), `WORKER_DATABASE_URL` (`mh_worker`) for
  the running services; `MIGRATION_DATABASE_URL` (`mh_owner`) **only** for the migration job. Use
  `?sslmode=require` (or stricter) with managed databases.
- `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (non-AWS providers),
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` as required by the provider.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`.
- `BOOKING_CONFIRMATION_HOURS` (default 24), `AUTH_SIGNIN_RATE_LIMIT_PER_MINUTE` (default 5),
  `WORKER_POLL_INTERVAL_MS` (default 2000).
- Do **not** set `ALLOW_DEMO_SEED` (the seed also refuses `NODE_ENV=production`).

## 3. Database provisioning (once)

`npm run db:bootstrap` is a local helper and refuses production. With the provider's administrative
account, run the equivalent SQL (replace passwords; role names are fixed because migrations reference them):

```sql
CREATE ROLE mh_owner  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '…';
CREATE ROLE mh_app    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '…';
CREATE ROLE mh_auth   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '…';
CREATE ROLE mh_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '…';
CREATE DATABASE maintenance_hub OWNER mh_owner ENCODING 'UTF8' TEMPLATE template0;
\c maintenance_hub
CREATE EXTENSION IF NOT EXISTS btree_gist;          -- needs the provider's admin role on most platforms
REVOKE ALL ON DATABASE maintenance_hub FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE maintenance_hub TO mh_app, mh_auth, mh_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO mh_owner;
GRANT USAGE ON SCHEMA public TO mh_app, mh_auth, mh_worker;
```

Check that no runtime role is a superuser, table owner or `BYPASSRLS`
(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'mh_%';`).

Then, from a one-off job with `MIGRATION_DATABASE_URL` set:

```bash
npm run db:migrate        # schema, constraints, RLS policies, triggers, grants
npm run db:reference      # equipment categories, Rabat-Salé area, pilot plan (idempotent)
ADMIN_PASSWORD='…' npm run admin:create -- --email admin@votre-domaine.ma --name "Administrateur"
```

## 4. Releases and migrations

1. Change `prisma/schema.prisma`, run `npm run db:diff -- <name>` locally, review the generated SQL
   and add any RLS policy, grant, constraint or trigger the change needs (in a migration file —
   never `prisma migrate dev`, which would drop the security objects).
2. Run `npm run test:integration` (real PostgreSQL, production-style roles) and `npm run test:e2e`.
3. Deploy: back up → run `npm run db:migrate` (owner role) → roll out web and worker with the same
   commit. Prefer additive migrations so the previous version keeps running during the rollout.

## 5. Private storage

- Bucket with **all public access blocked**, server-side encryption, no website hosting. Browser
  uploads go through the application (`PUT /api/v1/documents/{id}/content`), so no CORS rule is needed.
- Credentials limited to `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on that bucket.
- Downloads are authorized by the application, then redirected to a signed URL valid 60 seconds.
- Enable object versioning (protection against accidental deletion); objects of deleted/failed uploads
  are removed by the worker's clean-up task.
- The S3 adapter is implemented but was **not tested against a live bucket** in this build (see
  `docs/IMPLEMENTATION_STATUS.md`); test upload, download and deletion before opening the pilot.

## 6. E-mail

Configure SMTP credentials of a transactional provider, `EMAIL_FROM` on a domain you control with
SPF, DKIM and DMARC. E-mails are queued in the database and sent by the worker with retries
(at-least-once: a crash right after the SMTP hand-off may send a duplicate). Failed/dead deliveries
are visible on the admin dashboard. SMS, WhatsApp and payment gateways are not implemented.

## 7. Backups and restoration

| Data | Backup | Suggested target |
| --- | --- | --- |
| PostgreSQL | Managed daily snapshots + point-in-time recovery (WAL), or `pg_dump -Fc` nightly to separate storage | RPO ≤ 24 h (≤ 5 min with PITR), keep 30 days |
| Private files | Bucket versioning + replication or periodic copy to another account/region | same retention as the database |
| Secrets | Platform secret manager; keep an offline copy of `BETTER_AUTH_SECRET` | — |

Restore procedure (test it before the pilot, then quarterly):

1. Stop web and worker (or enable maintenance mode at the proxy).
2. Restore the database into a new instance (`pg_restore -d maintenance_hub --no-owner --role=mh_owner dump.pgc`
   after recreating the roles of §3, or the provider's PITR restore).
3. Re-apply role passwords if needed; run `npm run db:migrate` (no pending migration expected).
4. Point the application to the restored database and the bucket (restore object versions if
   files were affected); restart the worker first, then the web instances.
5. Verify: sign-in, a booking detail page, a document download, the admin dashboard queue status.

## 8. Operations and security checklist

- TLS everywhere; HTTP → HTTPS redirect; HSTS at the proxy.
- The application sends CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and
  `Cache-Control: no-store, private` on API responses. Keep proxy caching disabled for `/api` and
  signed-in pages.
- Rate limits: sign-in/sign-up/reset/verification use Better Auth's database-backed limiter;
  invitations and uploads are limited from database counts; the public support form uses a
  PostgreSQL fixed-window counter (`public_rate_limit`, 5 messages per address per hour, keyed by
  an HMAC of the address, never the raw IP). All of them hold across several web instances.
  The proxy **must overwrite** `X-Forwarded-For` with the real client address; otherwise clients
  could vary the header to evade the per-address limits.
- Logs: the app never logs secrets; e-mail addresses are redacted from worker errors. Ship logs
  to a private destination with limited retention (e.g. 30 days).
- Monitor: worker process liveness, `DEAD` outbox/e-mail rows (admin dashboard), database storage
  and connection counts (web pool 10, auth pool 5, worker pool 4 connections per instance).
- Keep dependencies patched (`npm audit`). At build time `npm audit` reported 0 vulnerabilities,
  with two `overrides` in `package.json` (`mysql2`, pulled by Better Auth but unused with
  PostgreSQL, and `deepmerge-ts`, used by the Prisma CLI); remove them once upstream releases
  include the fixes.

## 9. Personal data, retention and deletion

| Data | Retention in the application |
| --- | --- |
| Sessions | 7 days, renewed daily while used; revoked on password change/reset |
| Verification/reset tokens | 24 h / 1 h |
| E-mail bodies in the queue | cleared after successful delivery (subject/recipient kept for audit) |
| Idempotency records, notifications | kept; can be purged periodically (e.g. idempotency records older than 30 days: `DELETE FROM idempotency_record WHERE created_at < now() - interval '30 days';`) |
| Work records (requests, bookings, quotes, approvals, reports, payments, disputes, audit events) | kept for both parties' records; not deleted by the application |
| Uploaded files | kept with the records they belong to; files of abandoned uploads are cleaned automatically |

Erasure requests: self-service account deletion is disabled because shared work records must stay
consistent. An operator runs:

```bash
npm run user:anonymize -- --email person@example.com            # dry run: shows what changes
npm run user:anonymize -- --email person@example.com --confirm  # applies (uses MIGRATION_DATABASE_URL)
```

It replaces the name and e-mail, deletes sessions/credentials/memberships, replaces author-name
snapshots in timelines, notes and dispute messages, unlinks technician profiles, and records an
audit event. Service reports keep the submitter's name as part of the work record, and
organization records (sites, equipment, addresses) belong to the organization — they are handled by
the organization owner or by an administrator with a documented reason. Obtain legal advice on
retention periods applicable in Morocco (loi 09-08, CNDP declarations) before the pilot; this
software does not by itself make a deployment compliant.
