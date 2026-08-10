# Qubere - Enterprise AI Trade Compliance Platform

**Qubere** is an enterprise-grade AI-native trade compliance platform designed for customs and trade-compliance teams to turn commercial invoices, packing lists, and product data into evidence-backed, review-ready import decisions before filing.

This repository contains the **Phase 1 Multi-Tenant SaaS Application Foundation**, featuring enterprise identity management, account-based tenancy, fine-grained Role-Based Access Control (RBAC), Clerk authentication, Supabase PostgreSQL database models, security audit logging, and the Qubere Platform Admin Console.

---

## 🛠 Technology Stack

- **Framework**: Next.js 15 (App Router, Server Components, Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS & Apple Light Design System (`#F5F5F7`, `#1D1D1F`, `#0071E3`)
- **Authentication**: Clerk Authentication (`@clerk/nextjs`, `@clerk/backend`)
- **Database & ORM**: Supabase PostgreSQL + Prisma ORM (`@prisma/client`)
- **Testing**: Vitest (`vitest`)
- **Icons**: Lucide React (`lucide-react`)

---

## 🏗 Architecture & Key Concepts

### 1. Account-Based Tenancy Boundary
The `Account` table is the primary source of truth for tenant data isolation. An account represents an isolated customer environment and can be either:
- **`ENTERPRISE`**: A customer company environment (e.g. *Acme Corporation*). Created exclusively by Qubere internal administrators via the Platform Admin Console.
- **`INDIVIDUAL`**: A personal workspace (e.g. *Rachit's Workspace*). Created via self-service user signup.

Users can belong to multiple accounts and switch between active account contexts using the top-left **Account Switcher**.

### 2. Authentication vs Authorization
- **Authentication (Identity)**: Managed strictly by **Clerk** (sign in, MFA, sessions, email/password verification).
- **Authorization**: Managed inside PostgreSQL (`User`, `AccountMembership`, `Role`, `Permission`, `PlatformUserRole`).

### 3. Separated Platform & Customer RBAC
- **Platform Roles (`PlatformRole` & `PlatformUserRole`)**: Platform-level roles (`PLATFORM_ADMIN`, `CUSTOMER_SUPPORT`, `BILLING_ADMIN`, `SECURITY_ADMIN`) for Qubere internal operations.
- **Customer Account Roles (`Role`)**: Built-in system roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER` where `isSystem = true`) and custom customer-defined roles (`isSystem = false`, `accountId = specific account`).

### 4. Secure Token-Based Invitations
Invitations are generated with secure, unique tokens (`/invite/<token>`) supporting `PENDING`, `ACCEPTED`, `EXPIRED`, and `REVOKED` statuses.

### 5. SOC2-Ready Enterprise Audit Logging
Every administrative action (role change, status toggle, account modification, user invitation) generates an immutable `AuditLog` entry in PostgreSQL capturing:
- `accountId` & `userId`
- `action`, `entity`, `entityId`, `metadata`
- `ipAddress`, `userAgent`, `requestId`
- `success` outcome status (`true` / `false`)

### 6. Row-Level Security & Capability Gating
To ensure data privacy within multi-tenant accounts:
- **Row-Level Security (Data Segregation)**: Planners can only access their own assigned records (e.g., shipments), while Admins can view all data within the account.
- **Capability Gating**: API routes strictly enforce capabilities via `hasPermission()` checks (e.g., `documents.create`, `filings.submit`, `intel.read`), returning `403 Forbidden` if a user lacks the necessary privilege.

---

## 📁 Repository Structure

```
├── prisma/
│   ├── schema.prisma        # Prisma data models & database relationships
│   └── seed.ts              # Database seed script for test accounts & RBAC
├── scripts/
│   └── seed-clerk-users.ts  # Programmatic Clerk user provisioning script
├── src/
│   ├── app/
│   │   ├── (auth)/          # Clerk Auth routes (/sign-in, /sign-up)
│   │   ├── api/             # Internal API routes (account, users, platform-admin)
│   │   ├── app/             # Application Console (/app/dashboard, /app/admin, /app/admin/users)
│   │   ├── invite/[token]/  # Token-based secure invitation acceptance
│   │   ├── platform-admin/  # Qubere Platform Admin Console
│   │   ├── globals.css      # Design tokens & Apple light theme
│   │   └── page.tsx         # Landing page & auto-redirect guard
│   ├── components/          # Reusable UI components (Sidebar, Header, AccountSwitcher)
│   ├── lib/                 # Core utilities (auth context, audit logger, db client)
│   └── middleware.ts        # Route protection middleware
├── tests/
│   └── multi-tenant.test.ts # Vitest multi-tenant unit tests
└── package.json
```

---

## ⚡ Getting Started Locally

### 1. Prerequisites
- Node.js 18+ & npm
- Clerk account credentials
- Supabase PostgreSQL database URL

### 2. Environment Setup
Create a `.env` file in the root directory:

```env
# Clerk Authentication Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Clerk Redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/app/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/app/dashboard

# Supabase Connection Strings (Transaction Pooler vs Direct Connection)
# DATABASE_URL uses Port 6543 (Transaction Mode) for Next.js App / Serverless API routes
DATABASE_URL="postgresql://postgres.cqrhojmrdbrfrgtkurzj:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
# DIRECT_URL uses Port 5432 (Session Mode) for Prisma Migrations & CLI commands
DIRECT_URL="postgresql://postgres.cqrhojmrdbrfrgtkurzj:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres"

# Scheduled job authentication (see "Scheduled Jobs" below).
# Optional locally; required in production so /api/cron/* endpoints can't
# be triggered by anyone who finds the URL.
CRON_SECRET=
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup & Seeding
Generate the Prisma Client, push schema to PostgreSQL, and seed the test environment:

```bash
npx prisma generate
npx prisma db push --force-reset
npx prisma db seed
```

To provision all 10 test users into your Clerk instance via the Clerk API:
```bash
npx tsx scripts/seed-clerk-users.ts
```

### 5. Run Development Server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## ⏰ Scheduled Jobs

### HTS Master Data Nightly Refresh
`GET /api/cron/hts-refresh` checks USITC for changes to the US Harmonized Tariff Schedule and stages a new release if the content has actually changed.

- **Schedule**: nightly, defined in `vercel.json` (`0 8 * * *`, i.e. 8am UTC). On Vercel this runs automatically once deployed. On other hosts, you need your own scheduler (e.g. a system cron, GitHub Actions on a schedule) making an authenticated `GET` request to this endpoint on the same cadence — `vercel.json`'s `crons` block only takes effect on Vercel.
- **Source**: fetches the real USITC export API (`https://hts.usitc.gov/reststop/exportList`) chapter by chapter (01–99), since a single request spanning the whole schedule is rejected by that API.
- **Change detection**: the fetched content is checksummed (SHA-256) and compared against the currently published release. If nothing changed, the run is a no-op (`status: "NO_CHANGE"`). This means it's safe to run nightly even when USITC hasn't published anything new.
- **Never auto-publishes**: a genuinely new revision is staged as `DRAFT` only — never automatically made live. Duty rates from this data feed real filing calculations (`/api/filing`), so a change to legally-binding tariff data goes through a human review-and-publish step: `POST /api/v1/admin/hts/releases/[releaseId]/publish`.
- **Auth**: set `CRON_SECRET` in production; the endpoint requires `Authorization: Bearer <CRON_SECRET>` when that env var is set (Vercel Cron sends this header automatically once `CRON_SECRET` is configured in your Vercel project).
- **Runtime**: configured with `maxDuration = 300` (seconds) — the chapter-by-chapter fetch plus batched DB inserts for the full schedule (~20k+ line items) takes roughly 2–3 minutes end to end.

To trigger it manually (e.g. to test), call the endpoint directly with the correct bearer token:
```bash
curl -X GET "https://<your-deployment>/api/cron/hts-refresh" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Sanctions Watchlist Sync
`scripts/nightly-watchlist-sync.ts` exists in the repo but is **not currently wired to any scheduler** — running it today requires invoking it manually (`npx tsx scripts/nightly-watchlist-sync.ts`). It also currently seeds hardcoded example OFAC/BIS entries rather than fetching from a real sanctions list source. Treat it as a stub, not a working scheduled job.

---

## 🧪 Testing & Build Verification

### Run Unit Tests
```bash
npm test
```

### Production Build Verification
```bash
npm run build
```

---

## 🔑 Test User Credentials

Default password for all seeded test users: **`QuberePass2026!`**

| Email | Account / Context | Role | Access Level |
| :--- | :--- | :--- | :--- |
| `admin@qubere.ai` | Qubere Platform + Acme Corp | `PLATFORM_ADMIN` / `OWNER` | Full Platform Admin Console (`/platform-admin`) |
| `owner.acme@qubere.ai` | Acme Corporation (`ENTERPRISE`) | `OWNER` | Enterprise Owner |
| `admin.acme@qubere.ai` | Acme Corporation (`ENTERPRISE`) | `ADMIN` | Enterprise Admin |
| `member.acme@qubere.ai` | Acme Corporation (`ENTERPRISE`) | `MEMBER` | Standard Enterprise Member |
| `viewer.acme@qubere.ai` | Acme Corporation (`ENTERPRISE`) | `VIEWER` | Read-only Viewer |
| `owner.global@qubere.ai` | Global Trade Logistics (`ENTERPRISE`) | `OWNER` | Enterprise Owner |
| `multirole@qubere.ai` | Acme Corp & Global Trade | Multi-Account | Member @ Acme + Admin @ Global Trade |
| `joe@target.com` | Target (`ENTERPRISE`) | `ADMIN` | Account Admin (Views all Target data) |
| `anna@target.com` | Target (`ENTERPRISE`) | `ADMIN` | Account Admin (Views all Target data) |
| `sarah@target.com` | Target (`ENTERPRISE`) | `PLANNER` | Planner (Uploads docs; restricted to own data) |
| `romeo@target.com` | Target (`ENTERPRISE`) | `PLANNER` | Planner (Uploads docs; restricted to own data) |
| `eva@target.com` | Target (`ENTERPRISE`) | `PLANNER` | Planner (Uploads docs; restricted to own data) |

---

## 📄 License
© 2026 Qubere Inc. All rights reserved. Trade Compliance AI Platform.
