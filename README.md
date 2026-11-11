# ERP

Multi-tenant ERP: organisations, branches, employees, roles, accounts, attendance, payroll, sale, store, purchase and reports. The full plan is in [`ERP-Architecture-Plan.md`](./ERP-Architecture-Plan.md).

## Requirements

- Node.js 22 or newer
- pnpm 10 (`corepack enable` picks the pinned version)
- PostgreSQL 16+ and Redis. Either Docker (`pnpm infra:up`) or plain installs on your machine; both work.
  MongoDB is not used yet.

## First run

```bash
corepack enable
pnpm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
pnpm infra:up             # postgres, mongo, redis
pnpm db:migrate           # create or update the tables
pnpm dev                  # web on :3000, api on :4000
```

## Without Docker

Install PostgreSQL (postgresql.org installer) and, if you want Redis-backed limits, any Redis. Without
Redis the API falls back to in-memory limits, so it still runs. Then put this in `.env`:

```
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/erp
TEST_DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/erp_test
```

Create the database once (`CREATE DATABASE erp;` in pgAdmin or psql), then `pnpm db:migrate` and `pnpm dev`.

## On Railway (private database URL)

`postgres.railway.internal` only resolves inside Railway, so `pnpm db:migrate` cannot run from a laptop
against it. Let the deployed API do it. On the API service set `DATABASE_URL` to the private URL and add

```
RUN_MIGRATIONS=true
SEED_DEMO=true        # optional: demo accounts below; remove once you have real users
```

On every start the API applies pending migrations before it listens; if one fails, the deploy fails and
the old version keeps running. Run the web app and API from the same Railway project and use the
deployed URL to sign in.

## Demo login

`pnpm db:seed` creates a demo organisation (refuses to run when `NODE_ENV=production`). Sign in at
http://localhost:3000/login with one of these emails and password `Demo@12345678`:

| Email                | Role         |
| -------------------- | ------------ |
| `owner@demo.test`    | Owner        |
| `admin@demo.test`    | Super Admin  |
| `sales@demo.test`    | Sale team    |
| `accounts@demo.test` | Account team |
| `employee@demo.test` | Employee     |

Open http://localhost:3000/register to create an organisation, then sign in with the owner's email and password. GraphiQL is at http://localhost:4000/graphql in development.

## Commands

| Command                                      | What it does                                            |
| -------------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                                   | Runs the API and web app with reload                    |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Checks every package                                    |
| `pnpm build`                                 | Production build of both apps (cached by Turborepo)     |
| `pnpm format`                                | Formats the repo with Prettier                          |
| `pnpm db:migrate` / `pnpm db:seed`           | Creates the tables / adds the demo organisation         |
| `pnpm infra:up` / `pnpm infra:down`          | Starts or stops the local databases                     |
| `pnpm stack:up`                              | Two API instances behind Nginx on http://localhost:8080 |

## Layout

```
apps/api          Express + GraphQL Yoga API
  src/config      validated environment
  src/core        errors, logger, request context
  src/modules     one folder per business module
apps/web          Next.js app (App Router, Tailwind, shadcn/ui)
packages/shared   error codes, permission helpers, zod schemas used by both apps
packages/config   shared ESLint and TypeScript presets
```

## Sign-in and sessions

- `POST /auth/login`, `/auth/refresh` and `/auth/logout` are REST endpoints on the API; everything else is GraphQL. The web app forwards `/auth/*` and `/graphql` to the API, so the browser only talks to one origin.
- A session is three httpOnly cookies: a 15-minute access token, a 7-day refresh token (sent only to `/auth`), and a marker the web app's route guard reads. JavaScript cannot read any of them.
- Each refresh token works once. If a spent one is presented again, the whole session is revoked.
- Signing out, deactivating a user or deactivating an organisation takes effect on the next request.
- Sign-in is by email and password only: an email belongs to exactly one organisation, so the API finds the organisation from it. Five failed sign-ins lock that email for 15 minutes. Counters live in Redis; if Redis is down each API instance counts in memory.
- Every write must carry the `x-erp-client` header and, if the browser sends an `Origin`, it must be listed in `CORS_ORIGINS`.
- Tests need PostgreSQL and Redis running (`pnpm infra:up`).

## Database and tenants

Every table has row-level security. Application code reaches PostgreSQL only through `withTenant(db, tenantId, fn)`, which opens a transaction, switches to the restricted `erp_app` role and pins the tenant, so a query can only see or change that tenant's rows.

- A new table needs `SELECT app_enable_tenant_rls('<table>');` in its migration. A test fails if one is missed.
- Tests use `TEST_DATABASE_URL` (default: local `erp_test`) and wipe that database on every run. They refuse to run against a database whose name does not end in `_test`, and they never read `DATABASE_URL`.
- For production, give the API its own login that is only a member of `erp_app`, and keep the owner login for migrations:

  ```sql
  CREATE ROLE erp_api LOGIN PASSWORD '<generate one>' NOSUPERUSER NOBYPASSRLS IN ROLE erp_app;
  ```

  Then set `DATABASE_URL` to the `erp_api` login and `MIGRATION_DATABASE_URL` to the owner login.

## Rules that do not bend

- The server never trusts totals, prices or balances from the browser. It recomputes them.
- Every input is validated on the server with the shared zod schemas.
- Permission, branch scope and tenant are checked in the service layer on every action.
- Every failure leaves the API in one shape: `code`, `message`, `fieldErrors`, `requestId`.
- Secrets live in `.env`, which is never committed.

## Workflow

Issue, then branch `feat/<issue>-<slug>`, then Conventional Commits, then a pull request that says `Closes #<issue>`, then rebase-and-merge once CI is green.
