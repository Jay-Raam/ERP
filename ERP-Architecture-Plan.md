# Multi-Tenant ERP — Architecture Plan & Estimate

## Goals and scope

This plan covers a multi-tenant ERP where each organisation runs its branches, staff, stock, sales, purchases, accounts and payroll from one login. No code starts until you approve this plan and the decisions in the next section.

- **Modules:** Organisation, Branch, Employee, Roles and permissions, Accounts, Attendance, Payroll, Sale, Store, Purchase, Report.
- **Roles:** Owner (full access), Super Admin, Employee, Sale team, Account team. Menus and actions come from permissions, never from hard-coded role checks.
- **Stack:** Next.js and shadcn/ui on the front; Node.js, Express and GraphQL Yoga on the back; PostgreSQL, MongoDB and Redis for data; Nginx as load balancer; Nodemailer for mail.
- **Non-negotiables:** the server never trusts data or totals sent by the browser, every field is validated and sanitised, one central error handler on both sides, every endpoint tested on every push, a clean GitHub history, and a pixel-accurate UI.

## Assumptions and decisions

I made eleven assumptions to keep the plan moving. Each one changes the build if you disagree, so please check the table before we start.

| Topic | Assumption in this plan (tell me what to change) |
|---|---|
| Owner vs Super Admin | Owner is the top user of one organisation and sees everything. Super Admin administers users, roles, branches and employees, with no payroll or ledger-edit rights by default. No separate platform console for the software vendor in v1. |
| Tenant onboarding | A new organisation registers once and its first user becomes Owner. Login asks for organisation, email and password. |
| Tenant isolation | One shared database with a tenant ID on every row, enforced by PostgreSQL row-level security, not a database per tenant. |
| Two databases | PostgreSQL holds money, stock, HR and permissions (needs transactions). MongoDB holds attendance punches, audit logs, notifications and report snapshots. |
| API style | All business operations go through GraphQL Yoga. Express also serves login and refresh, health checks and file upload. |
| N+1 and script injection | I read these as the N+1 query problem (fixed with DataLoader batching) and script, SQL and NoSQL injection (fixed with validation, sanitising and parameterised queries). |
| Pixel perfect | Needs a design reference. If you have Figma or screenshots, share them. If not, Stage 1 builds a design system you approve first, then Playwright screenshot tests lock it. |
| Git timestamps | Commit and push times will be real. I will not backdate or fake dates; the human-like spacing comes from real pacing (see Git workflow). |
| Store and purchase staff | None of the five roles is a storekeeper or buyer. Default: Super Admin runs Store and raises purchase orders; Account team handles bills and payments. Roles are data, so adding one later is easy. |
| Money and tax | One currency per organisation; tax rates configurable per organisation. Multi-currency and statutory filings are out of scope for v1. |
| Code and GitHub | Code lives in `E:\Projects\ERP` on your computer. You create the empty GitHub repository and give push access; secrets never go in the repo. |

## System architecture

One stateless API tier sits behind a load balancer, with PostgreSQL for money, MongoDB for event logs and Redis for speed and queues.

The browser reaches both the Next.js web app and the API only through the load balancer, so API instances can be added or removed without changing anything else. Server-side rendering calls the API the same way a browser does. Slow work (email, report exports) is queued in Redis and handled by the worker, so a request never waits on SMTP. The Nginx load balancer runs two API instances locally in Docker Compose to prove failover; production would use the cloud provider's balancer.

## Backend architecture

The backend is a modular monolith in one monorepo: every business module is a folder with its own schema, service and tests, so any module can become a separate service later without a rewrite.

A request flows through Express middleware (helmet, CORS, rate limit, request ID), then GraphQL Yoga, resolver, service, repository and database. Resolvers stay thin: parse input, call a service, return. Business rules live only in services.

```
erp/
  apps/api/src/
    config/          validated env (zod), constants
    core/            errors, logger, auth, tenant context, rbac, dataloaders
    modules/<name>/  schema.graphql, resolvers, service, repository, validators, tests
    jobs/            BullMQ workers (mail, reports)
    server.ts        Express + Yoga bootstrap
  apps/web/          Next.js app
  packages/shared/   zod schemas, error codes, permission keys (used by both apps)
  packages/config/   eslint, tsconfig, prettier presets
```

Four rules keep the backend honest:

- **Never trust the client.** The browser sends IDs, quantities and raw inputs only. The server loads prices, tax rates, stock and balances from the database and recomputes every total, balance and salary figure. A total sent by the client is ignored; if the UI sends one as a stale-screen check, a mismatch is rejected with a `BUSINESS_RULE` error.
- **Re-check authorisation on every action in the service layer:** permission, branch scope and record ownership. Hiding a menu item is never the control.
- **Money is exact:** `NUMERIC(14,2)` in PostgreSQL and decimal.js in code, never floating point. Posted documents (invoices, journals, payslips) are immutable; mistakes are fixed with reversing entries.
- **Writes are safe:** one database transaction per action, optimistic locking with a version column, idempotency keys on payments and posting, and a single state machine per document (draft, approved, posted, cancelled).

**Central error handling:** one `AppError` family (`ValidationError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `BusinessRuleError`) with stable error codes shared with the frontend through `packages/shared`. One Express error middleware plus Yoga's masked-error plugin turn every failure into the same shape: code, message, field errors and request ID. Stack traces never leave the server; unknown errors become `INTERNAL_ERROR` and are logged with pino.

**N+1 control:** one DataLoader set per request for every relation field, and a test that asserts query counts on list operations.

## Frontend architecture

The frontend is Next.js (App Router, strict TypeScript) with Tailwind and shadcn/ui. Code is grouped by feature, not by file type: `src/features/<module>/` holds that module's components, hooks, GraphQL documents and form schemas, while `src/components/ui` holds the shared shadcn components.

| Concern | Choice |
|---|---|
| Data fetching | TanStack Query with graphql-request; GraphQL Code Generator builds typed operations from the API schema |
| Forms and validation | React Hook Form with the same Zod schemas the API uses (from `packages/shared`) |
| Tables | TanStack Table with server-side paging, sorting and filtering |
| Charts | Recharts through shadcn chart components |
| UI state and URL state | Zustand for small UI state; nuqs keeps filters in the URL |
| Helpers | date-fns, sonner (toasts), next-themes, lucide-react |
| Tests | Vitest and Testing Library, MSW for API mocks, Playwright for E2E and screenshots, axe for accessibility |
| Code quality | ESLint (Next, typescript-eslint, jsx-a11y), Prettier, Husky, lint-staged, commitlint |

**Authentication:** login takes organisation, email and password. The API sets httpOnly, Secure, SameSite cookies holding a 15-minute access JWT and a rotating 7-day refresh token. Next.js middleware redirects anonymous visitors away from protected routes, and the API client refreshes once on a 401. The real enforcement is always the API.

**Permission-driven UI:** login returns the user's permission keys. A `Can` component and `usePermission` hook hide actions, and the navigation config lists the permission each item needs, so menus are filtered from data instead of coded per role.

**Central error handling:** `error.tsx` and `global-error.tsx` boundaries per route group, plus one `handleApiError()` that maps API error codes to field errors, toasts, a 403 page or a redirect to login.

**Pixel-perfect method:** design tokens (colour, radius, spacing, type scale) live as CSS variables in one file; shadcn components are restyled once and never patched ad hoc; fonts are self-hosted through next/font; Playwright screenshot tests cover key screens at 390, 768 and 1440 px with a small diff threshold.

## Roles and permissions

Permissions are data, not code. A permission is a key such as `sale.invoice.create`. A role is a set of permission keys plus a data scope (own, branch or whole organisation). Each user has one role per organisation and a list of branches they may work in. Owner holds a wildcard and cannot be locked out. Menus and buttons are generated from the permission list, and the API checks the same keys on every operation.

This is the default seed. Each organisation can edit it, and approvals (payroll approve, leave approve, bill post) are separate permissions so they can be split from creating.

| Module | Owner | Super Admin | Employee | Sale team | Account team |
|---|---|---|---|---|---|
| Organisation and branches | Full | Full | none | none | none |
| Employees | Full | Full | Own profile | Own profile | Own profile |
| Roles and permissions | Full | Full | none | none | none |
| Accounts | Full | View | none | View | Full |
| Attendance | Full | Full, approves leave | Own, requests leave | Own, requests leave | Own, requests leave |
| Payroll | Full, approves runs | none | Own payslips | Own payslips | Prepares runs |
| Sale | Full | View | none | Full, own branch | View |
| Store | Full | Full | none | View | View |
| Purchase | Full | Orders | none | none | Bills and payments |
| Report | Full | Operational | none | Sales | Financial |

## Modules and data model

Each module owns its records and the checks the server runs before saving. Accounts and Store are built before Sale, Purchase and Payroll, because those three post journals and stock movements into them.

| Module | Key records | Server-side checks |
|---|---|---|
| Organisation and branch | Organisation, branch, fiscal year, settings | Unique slug and branch code per tenant; a branch with open stock or documents cannot be deleted |
| Employee | Employee, department, designation, documents | Unique employee code and email; one user per employee; soft delete only |
| Roles and permissions | Role, permission, user-role, user-branch | Owner role is immutable; the last Owner cannot be removed; data scope applied to every query |
| Accounts | Chart of accounts, journal, ledger, voucher | Debits equal credits; posted entries immutable; period locks; trial balance ties to the ledger |
| Attendance | Shift, punch (MongoDB), daily summary, leave | No overlapping punches; leave balance cannot go negative; hours computed from punches on the server |
| Payroll | Salary structure, payroll run, payslip | Gross, deductions and net recomputed on the server; run locked after approval; posts one journal |
| Sale | Customer, quotation, invoice, receipt, return | Line totals, discount and tax recomputed; stock and credit-limit check; return cannot exceed quantity sold |
| Store | Item, warehouse, stock ledger, transfer, adjustment | Stock never goes negative; every movement is a ledger row; transfers are atomic |
| Purchase | Vendor, purchase order, goods receipt, bill, payment | Bill matches order and receipt quantities (three-way match); payment cannot exceed bill balance |
| Report | Read models, saved reports, exports | Read-only; permission and branch scoped; totals reconcile to the ledger |

## Security and input validation

Every field is validated twice: in the browser for speed, and again on the server, which is the only check that counts. Both use the same Zod schemas from `packages/shared`.

| Threat | Control |
|---|---|
| Bad input | Zod schema on every GraphQL input: type, length, format, allowed values; unknown fields rejected; GraphQL enums for fixed sets |
| Script injection (XSS) | Strings are trimmed and stripped of HTML on input (sanitize-html, no tags unless a field is marked rich text); React escapes output; strict CSP; no `dangerouslySetInnerHTML` without the sanitiser |
| SQL injection | Parameterised queries only, through Drizzle ORM; no string-built SQL; a lint rule bans raw SQL outside repositories |
| NoSQL injection | Strict Mongoose schemas; keys starting with `$` or containing `.` are stripped; queries built from typed fields only |
| N+1 and heavy queries | DataLoader per request; GraphQL depth and complexity limits; page size capped at 100; introspection off in production |
| Login abuse | argon2id hashing; rate limit and temporary lockout in Redis; refresh-token rotation with reuse detection; CSRF protection on mutations |
| Tenant leak or broken access | Permission and scope checks in services; PostgreSQL row-level security; a cross-tenant test for every operation |
| Secrets and dependencies | Env validated at boot; `.env` never committed; gitleaks in hooks and CI; npm audit and CodeQL in CI |
| Accountability | Every create, update, delete and approve writes an audit record (who, tenant, what, before and after) to MongoDB |

## Testing, CI and reports

Every push runs GitHub Actions, and the backend gets its own report separate from the frontend. Workflows use path filters, so a frontend-only push does not run backend jobs.

| Workflow | Runs on | What it does |
|---|---|---|
| ci-api | Push or PR touching `apps/api` or `packages` | ESLint, typecheck, unit tests, integration and endpoint tests against real PostgreSQL, MongoDB and Redis service containers, then the backend report |
| ci-web | Push or PR touching `apps/web` or `packages` | ESLint, typecheck, component tests, Playwright E2E for every role, screenshot and accessibility checks |
| build | PR to main, and main | Production build of both apps with Turborepo and Next.js caching |
| security | PR, and weekly | gitleaks, npm audit, CodeQL |

**Build policy, as you asked:** the first build is slow, later ones reuse the cache. On feature-branch pushes the pipeline runs lint, typecheck and tests only. The full build runs on pull requests to main and on main itself, so a big project does not rebuild on every push.

The backend report is a job summary plus a downloadable artifact on every push, and a PR comment. It shows pass and fail per module, coverage per module, and an endpoint matrix: every GraphQL query and mutation read from the schema, ticked for happy path, unauthenticated, forbidden, invalid input, injection payload, cross-tenant access and calculation tampering. CI fails if any operation has no test.

**Coverage targets:** 80% on services overall and 100% on calculation and posting code (totals, tax, payroll, ledger, stock). Frontend E2E logs in as each of the five roles and checks that the right menus appear and blocked actions stay blocked.

## Git workflow

Every feature follows the same six steps, and main only ever receives work that passed CI.

1. **Issue:** a GitHub Issue from a template with the user story, acceptance criteria, API and UI notes, labels (module, type, size XS to XL) and a milestone for its stage.
2. **Branch:** cut from the latest main, named `feat/<issue>-<slug>`, for example `feat/14-branch-crud`.
3. **Commits:** Conventional Commits such as `feat(branch): add create mutation`, small and compiling. Hooks run lint-staged, commitlint and gitleaks before each commit.
4. **Push and pull request:** the PR says `Closes #14`, and CI must go green.
5. **Merge** to main with rebase-and-merge, which keeps every commit and keeps main linear (squash is the alternative if you prefer one commit per feature).
6. **Pull** main locally, delete the branch, and confirm the issue closed itself.

Human-like pacing is based on lines changed. The gap before the next push is roughly lines changed divided by about 80 lines per hour, with about 25% random variation, inside a 10:00 to 20:00 IST working window and with days off. Commits inside one PR are spaced the same way.

| Size | Lines changed | Commits | Gap before the next push |
|---|---|---|---|
| XS | under 50 | 1 to 2 | 20 to 45 minutes |
| S | 50 to 150 | 2 to 3 | 1 to 2 hours |
| M | 150 to 400 | 3 to 5 | 3 to 5 hours |
| L | 400 to 800 | 5 to 8 | 1 to 2 working days |
| XL | over 800 | split the issue first | not allowed |

Timestamps stay genuine: I will not backdate commits. The spacing is real time between real pushes, so the calendar estimate below is set by this pacing, not by coding speed.

**Keeping the repo clean:** a `.gitignore` written in the first commit, plus `.gitattributes` with LF line endings (you are on Windows) and a `.env.example` instead of real env files.

```gitignore
node_modules/
.next/
dist/
build/
coverage/
.turbo/
playwright-report/
test-results/
*.log
*.tsbuildinfo
.env
.env.*
!.env.example
.DS_Store
Thumbs.db
.idea/
.vscode/*
!.vscode/extensions.json
.data/
uploads/
*.pem
```

## Roadmap

The build runs in five stages with a gate after each of the first four; Stage 2 gives you a usable core by week 9.

The stages map to the 12 phases in the estimate: Stage 1 is P0 to P2, Stage 2 is P3 and P4, Stage 3 is P5 to P8, Stage 4 is P9 and P10, and Stage 5 is P11. Inside a stage, each feature is built in dependency order: the backend operation and its tests first, then its screen, then the E2E check. Week numbers assume the paced rhythm of about one PR per working day.

## Estimate

The build is about 125 focused build-days, or about 145 with a 15% contingency, split into roughly 93 issue-to-PR cycles. At one PR per working day that is about 19 weeks.

Platform foundation and Accounts are the heaviest because every later module depends on them: auth, tenancy, permissions, the design system and the ledger are built once and reused.

| Who builds | Calendar time | What sets it |
|---|---|---|
| One senior full-stack developer, alone | 6 to 7 months | 145 build-days at about 21 working days a month |
| Two developers (backend and frontend) | 3.5 to 4 months | Parallel work once each stage's GraphQL schema is agreed; about 15% coordination overhead |
| Claude builds, you review and decide | About 19 weeks (4.5 months) | Real-time git pacing of about one PR per working day, not coding speed; a faster cadence shortens it |

These are my own estimates, good to about plus or minus 25% until the design reference and tax rules are confirmed. Not included: hosting costs, third-party licences, data migration from an old system, a mobile app, statutory filings, multi-currency, and your review and user-testing time.

## Risks and mitigations

_(Section content was not included in the source text.)_
