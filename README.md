# api.companymgmt.ai

Company directory API built with Node.js 24, Express 5, TypeScript, Prisma 7.10, and PostgreSQL 17.

## Local setup

```sh
npm ci
cp .env.example .env
npm run db:up
npm run db:deploy
npm run db:generate
npm run db:seed
npm run dev
```

Copy `.env.example` only if `.env` does not exist. PostgreSQL runs on `127.0.0.1:55432`; the API binds `127.0.0.1:4000`. `db:up` uses Docker directly and does not need Compose. Alternatively, `docker compose up -d --wait` uses `compose.yaml`; use one database method at a time, as both publish the same port. `db:down` stops only the Docker CLI container, preserving volume `companymgmt-postgres-data`. For the Compose method use `docker compose stop`.

## Structure

```text
src/
  app.ts                    HTTP pipeline; separate from listening
  server.ts                 startup and graceful shutdown
  config/env.ts             validated environment
  lib/                      database, logger, errors
  modules/companies/        schemas, routes, service
  generated/prisma/         generated locally; not committed
prisma/
  schema.prisma
  migrations/               committed SQL schema history
  seed.ts                   idempotent fictional examples
scripts/database.mjs        owned local container lifecycle
tests/                      boundary and database integration tests
docs/                       architecture and OpenAPI contract
```

Routes parse input and serialize output; services own business operations and persistence. Keep features together under `modules/`. Introduce repositories only when persistence logic needs a distinct abstraction. Add authorization in the request/service boundary before making company data available to multiple users.

## HTTP contract

The complete OpenAPI 3.1 contract is `docs/openapi.json`.

| Method | Path                    | Behavior                                   |
| ------ | ----------------------- | ------------------------------------------ |
| GET    | `/health/live`          | process liveness                           |
| GET    | `/health/ready`         | PostgreSQL readiness, 503 when unavailable |
| GET    | `/api/v1/companies`     | list; `search`, `status`, `page`, `limit`  |
| GET    | `/api/v1/companies/:id` | one company                                |
| POST   | `/api/v1/companies`     | create; returns 201 and Location           |
| PATCH  | `/api/v1/companies/:id` | edit, archive, or restore                  |

Creation requires `name`, `email`, and `industry`; `website` is optional and must use HTTP(S). Send an empty website to clear it. PATCH omits fields to preserve them. Use `status: "ARCHIVED"` to archive and `"ACTIVE"` to restore. No hard delete is exposed. Names and email addresses are not assumed unique.

Every `/api/v1` route except `/auth/login` and `/auth/logout` needs a session. `POST /api/v1/auth/login` checks the email and password (scrypt hashes) and sets an HTTP-only, SameSite=Lax `cc_session` cookie valid for 12 hours; only a SHA-256 hash of the token is stored. Wrong passwords and unknown emails get the same 401, and failed sign-ins are limited to 10 per 15 minutes per address. Users created in the app get a temporary password and can only call `/auth/me` and `/auth/password` until they replace it. Suspending a user or resetting their password signs them out everywhere.

Access comes from each user's role in each of their teams (`src/lib/access.ts`). A team's kind decides its two roles, and its lead always holds the manager role:

| Team kind                            | Manager role (the lead)    | Member role      |
| ------------------------------------ | -------------------------- | ---------------- |
| LEADERSHIP (C-suite)                 | Leadership Lead            | Executive Member |
| TECHNICAL (developers, AI engineers) | Team Manager               | Team Member      |
| BUSINESS (Sales)                     | Sales Manager              | Sales Member     |
| EXTERNAL (Investors)                 | Investor Relations Manager | Investor         |

- The Leadership Lead creates, edits and deletes teams, and creates, suspends and deletes users anywhere.
- A team's manager adds and removes members of their own team, creates users in it, and edits or resets passwords for its members, but not for other managers or themselves.
- Leadership roles see every profile in full. Everyone else sees other teams' people by name, job title and team only: email, location, time zone, work mode and status are null and `restricted` is true, and searches can't match those hidden fields. Investors only see their own team and its people.
- `/auth/me` returns the sections each role may open; the frontend shows only those.
- The AI assistant reads through the same services as the person asking, so it can't reveal more than they could see.
- User, role and team changes are recorded in `AuditEvent` with the actor and before/after values.

`npm run db:seed` replaces all people and teams (never in production) with 11 fictional users, one per row of the role table, who sign in with `SEED_PASSWORD` (default `Pass@123`).

Team rules: a lead must be staff (`LEAD_MUST_BE_STAFF`) and is always a member; the lead can't leave (`LEAD_CANNOT_LEAVE`); everyone keeps at least one team (`LAST_TEAM`, `TEAM_HAS_ONLY_MEMBERS`); a person who leads a team can't be deleted or made external (`PERSON_LEADS_TEAM`). These checks run in serializable transactions, retried on conflict, so concurrent requests can't break them; a conflict that persists returns 409 `RETRY`. Database-level conflicts name the field involved (for example `TEAM_NAME_TAKEN`, `EMAIL_TAKEN`, `ALREADY_MEMBER`, `PERSON_LEADS_TEAM`) rather than a generic record error. Emails are trimmed, lower-cased and unique; time zones must be IANA names.

List responses: `{ data: Company[], meta: { total, page, limit, pages } }`. Single-record responses: `{ data: Company }`. Errors: `{ error: { code, message, requestId, details? } }`. IDs are UUIDs; dates are ISO timestamps. Maximum page size is 100. Missing status returns both active and archived records; the frontend explicitly filters status. Matching is case-insensitive on company name or industry. Pagination orders by creation time and ID; offset pagination suits this starter's scale.

## Validation and migrations

```sh
npm run check
npm run build
npm run format:check
npm run db:migrate -- --name describe_change
```

Use `db:migrate` only in development. Commit both the schema and resulting SQL migration. Use `db:deploy` in a controlled release job for staging/production; never run `migrate dev` there. Generate the Prisma client as part of a build. `db:seed` is explicit, idempotent, and only for local demonstration.

Integration tests require `TEST_DATABASE_URL` ending in `_test`; apply migrations using that database's `DATABASE_URL` first, then run `npm run test:integration`. CI supplies a separate PostgreSQL service. Tests delete only the records they create.

## Configuration

`DATABASE_URL` is required at runtime. `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGINS` (comma separated), and `LOG_LEVEL` are validated at startup. CLI generation uses a local fallback URL so CI can generate without secret credentials; migrations still need the target connection configured. Do not commit real credentials. `.env.example` contains local-only demonstration credentials.

Logs are structured JSON with generated request IDs and redacted authorization/cookie headers. Input bodies are capped at 32kb; `/api` allows 120 requests/minute per IP, in memory. Configure trusted proxy addresses deliberately when deploying behind a proxy; do not blindly trust forwarded headers. Distributed deployments need a shared rate-limit store. Health endpoints are outside the rate limit. Shutdown drains HTTP connections and closes the database pool.

## Deployment boundary

**Production startup currently fails closed.** Sign-in and per-operation role checks now exist with local accounts, but the requirements call for the shared CarrierOS identity service, and organization scoping and tenant-isolated queries are not built yet. There is no production bypass flag; replace the startup guard only once those are implemented and tested. Add TLS termination, managed PostgreSQL/backups, secrets, proxy configuration, shared rate limiting, and observability appropriate to the deployment.

The Dockerfile is a build/runtime starting point using an unprivileged user; it retains the same production guard. Run database migrations in a separate release job with development tooling available. The API never relies on a frontend-only security check.

## Dependency maintenance

The lockfile uses patched transitive overrides for `mysql2` and `deepmerge-ts` to address advisories in Prisma's dependency graph. Prisma generate, migrations, builds, and database lifecycle tests verify this setup. Re-evaluate the overrides when upgrading Prisma. Stable Prisma 7 is used; the registry's Prisma 8 release candidate is intentionally excluded.
