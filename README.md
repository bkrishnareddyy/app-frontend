# Qubere - Enterprise AI Trade Compliance Platform

**Qubere** is an enterprise-grade AI-native trade compliance platform designed for customs and trade-compliance teams to turn commercial invoices, packing lists, and product data into evidence-backed, review-ready import decisions before filing.

This repository contains the **Phase 1 Multi-Tenant SaaS Application Foundation**, featuring enterprise identity management, account-based tenancy, fine-grained Role-Based Access Control (RBAC), Clerk authentication, Supabase PostgreSQL database models, security audit logging, and the Qubere Platform Admin Console.

---

## 🛠 Technology Stack

- **Framework**: Next.js 16 (App Router, Server Components, Turbopack)
- **UI**: React 19
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

### 7. Global Product / Item Master

One product record per tenant holds what is true about the goods everywhere;
jurisdiction-specific customs positions hang off it separately. There is no
`Product.hsCode` — a product has a US classification, an EU classification and
so on, each with its own status, reviewer and effective window, and only
`APPROVED` counts. Country of manufacture and country of origin are stored as
different facts, and origin is never inferred from a manufacturer, supplier,
seller, export or shipping country.

See [docs/product-master.md](docs/product-master.md) for the domain model,
matching rules, change-detection signals, CSV import, and what is deliberately
not implemented.

### 8. Global Party Master

One party record per tenant holds who they are — identity, roles, and
registrations are kept as separate axes rather than a single "verified"
flag. `PartyRole` records that a party acts as a supplier, importer,
carrier, broker and so on (a party is not one fixed "type"), and
`PartyRegistration` tracks per-country registration claims through their
own `CLAIMED → UNDER_REVIEW → VERIFIED` lifecycle, independent of the
party's own `UNREVIEWED → IN_REVIEW → APPROVED` review status. A name match
alone is never treated as legal-identity proof.

See [docs/party-master.md](docs/party-master.md) for the domain model,
matching rules, change-detection signals, CSV import, and what is
deliberately not implemented.

---

## 📁 Repository Structure

```text
├── docs/
│   ├── product-master.md    # Global Product / Item Master domain reference
│   ├── party-master.md      # Global Party Master domain reference
│   ├── document-intelligence.md # Document parsing pipeline reference
│   └── ai-chat-interface.md # AI assistant design spec (not yet built)
├── prisma/
│   ├── schema.prisma        # Prisma data models & database relationships
│   ├── migrations/          # Versioned schema migrations
│   └── seed.ts              # Database seed script for test accounts & RBAC
├── scripts/
│   ├── seed-clerk-users.ts  # Programmatic Clerk user provisioning script
│   └── seed-qubere-trade-network.ts # Demo product/party network seed
├── src/
│   ├── app/
│   │   ├── (auth)/          # Clerk Auth routes (/sign-in, /sign-up)
│   │   ├── api/             # Internal API routes (account, users, platform-admin,
│   │   │                    #   products, parties, documents, shipments, filing, …)
│   │   ├── app/             # Application Console — dashboard, admin, products,
│   │   │                    #   parties, shipments, documents, filing, actions
│   │   ├── invite/[token]/  # Token-based secure invitation acceptance
│   │   ├── platform-admin/  # Qubere Platform Admin Console
│   │   ├── globals.css      # Design tokens & Apple light theme
│   │   └── page.tsx         # Landing page & auto-redirect guard
│   ├── components/          # Reusable UI components (Sidebar, Header, AccountSwitcher,
│   │                        #   table/BulkSelection, …)
│   ├── lib/                 # Core utilities (auth context, audit logger, db client,
│   │                        #   csvExport, i18n)
│   ├── modules/             # Domain logic (product, party, shipment, documents,
│   │                        #   tables, …), independent of the route layer
│   └── middleware.ts        # Route protection middleware
├── tests/                   # Vitest unit and integration tests
└── package.json
```

---

## ⚡ Getting Started Locally

### 1. Prerequisites

- Node.js 20.9+ & npm (required by Next.js 16)
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

The block above is enough to run the app with auth, RBAC, and the core
product/party/shipment/filing flows. The variables below turn on specific
integrations — each one is optional, and every feature it gates reports
itself as unavailable (never a silent fallback) when unset. See each
feature's linked doc for what "unconfigured" looks like in the UI.

| Variable | Gates | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | AI agents (classification, document intelligence, normalization, product intelligence, HTS classification) | No default; agent calls fail closed without it |
| `GEMINI_MODEL` | Same agents | Defaults to a built-in model name per agent if unset |
| `BLOB_READ_WRITE_TOKEN` | Document upload storage (Vercel Blob) | Required for any document upload in production; see [docs/document-intelligence.md](docs/document-intelligence.md) |
| `MAX_UPLOAD_BYTES` | Upload size limit | Defaults to 50 MB |
| `DOCUMENT_PARSER_PROVIDER` | Document Intelligence parsing pipeline | `ibm-docling` \| `mock` \| `none` (default `none` — see [docs/document-intelligence.md](docs/document-intelligence.md)) |
| `DOCLING_API_BASE_URL`, `DOCLING_API_KEY`, `DOCLING_AUTH_HEADER_NAME`, `DOCLING_AUTH_HEADER_SCHEME`, `DOCLING_SUBMIT_PATH`, `DOCLING_STATUS_PATH`, `DOCLING_RESULT_PATH`, `DOCLING_SOURCE_DELIVERY`, `DOCLING_SUBMIT_ENCODING` | IBM-hosted Docling connection, only read when `DOCUMENT_PARSER_PROVIDER=ibm-docling` | All but base URL and API key have working defaults |
| `DOCUMENT_PARSER_REQUEST_TIMEOUT_MS` | Docling request timeout | Defaults to 60000 |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Inbound email → document intake | Required to receive documents by email |
| `RESEND_ALLOWED_INBOUND_RECIPIENTS`, `RESEND_PUBLIC_DOCUMENT_ADDRESS` | Inbound email allow-list / displayed address | Optional even with Resend configured |
| `ALLOW_DEMO_SEEDING` | Enables demo/mock seeding routines outside of `NODE_ENV=development` | Always blocked in production regardless of this flag — see `src/lib/environment.ts` |
| `PLATFORM_ADMIN_EMAIL` | `scripts/bootstrap-admin.ts` | Only used by that one-off script |
| `ENABLE_LEGACY_CLASSIFICATION_MOCK` | Legacy `/api/classification/classify` mock path | Dev/testing only |

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

### Document Processing Worker
`GET|POST /api/cron/document-processing` advances the Document Intelligence pipeline by one bounded pass: it submits queued documents to the configured parser provider, polls in-flight conversions, retrieves and persists completed results, runs the quality gate, and reclaims work abandoned by a crashed worker.

- **Schedule**: daily, defined in `vercel.json` (`0 9 * * *`). This endpoint is a **backstop, not the pipeline** — Vercel's Hobby plan allows two cron entries, each at most once a day, which is nowhere near enough to carry a document through submit-then-poll. What actually drives the pipeline on Vercel is the request path: uploading, reprocessing, or polling a document's processing status schedules a bounded drain via Next's `after()`, so a document reaches the parser within seconds. Cron then sweeps up what no request will ever touch — runs abandoned by a crashed worker, and conversions that outlived the invocation that started them. It also carries the inbound-email backstop tick, which has no cron entry of its own for the same reason.
- **On other hosts**, run the long-lived worker instead: `npm run worker:documents`. All three paths drive the same durable Postgres state and are safe to run simultaneously; every transition is a conditional update, so no two callers can double-apply one.
- **Auth**: requires `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set.
- **No work without a provider**: returns HTTP 503 with an explicit blocker when `DOCUMENT_PARSER_PROVIDER` is unset or IBM Docling is not configured, rather than a 200 that looks like an idle queue.
- **Does not hold the request open** waiting for the parser, and creates no documents, exceptions, or demo data.

See [docs/document-intelligence.md](docs/document-intelligence.md) for the architecture, processing profiles, provenance chain, configuration, and known limitations.

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
