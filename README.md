# ERP

Multi-tenant ERP: organisations, branches, employees, roles, accounts, attendance, payroll, sale, store, purchase and reports. The full plan is in [`ERP-Architecture-Plan.md`](./ERP-Architecture-Plan.md).

## Requirements

- Node.js 22 or newer
- pnpm 10 (`corepack enable` picks the pinned version)
- Docker Desktop, for PostgreSQL, MongoDB and Redis

## First run

```bash
corepack enable
pnpm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
pnpm infra:up             # postgres, mongo, redis
pnpm dev                  # web on :3000, api on :4000
```

Open http://localhost:3000. GraphiQL is at http://localhost:4000/graphql in development.

## Commands

| Command                                      | What it does                                            |
| -------------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                                   | Runs the API and web app with reload                    |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Checks every package                                    |
| `pnpm build`                                 | Production build of both apps (cached by Turborepo)     |
| `pnpm format`                                | Formats the repo with Prettier                          |
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

## Rules that do not bend

- The server never trusts totals, prices or balances from the browser. It recomputes them.
- Every input is validated on the server with the shared zod schemas.
- Permission, branch scope and tenant are checked in the service layer on every action.
- Every failure leaves the API in one shape: `code`, `message`, `fieldErrors`, `requestId`.
- Secrets live in `.env`, which is never committed.

## Workflow

Issue, then branch `feat/<issue>-<slug>`, then Conventional Commits, then a pull request that says `Closes #<issue>`, then rebase-and-merge once CI is green.
