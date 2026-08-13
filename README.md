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

### 9. Qubere AI Copilot

A read-only conversational layer over the data the console already shows,
opened with **Ask Qubere AI** in the header. It is not a database agent: the
model never sees SQL, an internal API, or the page's DOM. It may call a closed
registry of 16 named tools (`src/modules/copilot/tools/`), each with a zod input
schema, and each reading through the same services and permission checks the
screens use.

Four properties are enforced in code rather than in the prompt, because a prompt
is a request and this platform files customs entries:

- **Tenancy.** Every tool read is scoped to the session's account inside the
  service. An id belonging to another tenant returns `NOT_FOUND`, never
  `NOT_AUTHORIZED` — the Copilot is not an enumeration oracle. The page context
  the browser sends is a hint about referents only; it is re-resolved through a
  tenant-scoped read, and dropped silently if it does not resolve.
- **RBAC.** Tools are gated on the same nav/permission checks as the screens
  they read, filtered out of the model's declarations and re-checked in the
  executor before any query runs. Copilot access is never wider than console
  access.
- **Grounding.** Every id a tool returns is recorded in a per-turn ledger.
  Entities, evidence and actions in the answer are validated against it —
  unknown ids are dropped with a visible warning, model-rewritten labels are
  replaced with the service's, and every `href` is built server-side from a
  fixed route map, so the model cannot emit a URL.
- **Origin safety.** The Copilot never infers a legal country of origin from a
  manufacturer, supplier, ship-from, port or export country. With no current
  `VERIFIED` origin claim it says there is no approved determination, whatever
  the manufacturing country says.

Retrieved business content — extracted document fields especially — is passed to
the model inside a labelled data envelope and is never treated as instruction.
The retrieval phase and the answering phase are separate model calls, and the
retrieval phase's prose is discarded in code: no hidden reasoning is returned,
streamed, or written to the audit trail. Turns are audited as
`COPILOT_CONVERSATION_STARTED`, `COPILOT_QUERY`, `COPILOT_TOOL_EXECUTED`,
`COPILOT_NAVIGATION_ACTION` and `COPILOT_ERROR` in the existing audit log —
question, outcome and counts, never tool arguments or answer prose.

Cost is bounded per question — at most 4 model rounds, 8 tool calls, 10 rows per
search, 6 000 characters per tool result, 8 replayed turns, 45 seconds — and per
caller: 15 questions a minute per user and 60 per account, answered with HTTP 429
and a plain explanation in the panel rather than a transport error. Provider token
counts are recorded on `copilot.answer_completed` and on the `COPILOT_QUERY` audit
entry, so spend can be attributed to an account without a separate billing export;
a provider that reports nothing is recorded as `null`, never as zero. The caller
quota is enforced twice: an in-memory sliding window per instance
(`copilotRateLimit.ts`) as a cheap fast path, then the shared Postgres counter
described in [AI cost controls](#-ai-cost-controls) as the real ceiling.

`COPILOT_ENABLED=false` switches the Copilot off on its own — the header button
disappears and the route answers honestly if called directly — without touching
`GEMINI_API_KEY`, which the classification and document agents share.

The Copilot cannot approve a classification, determine origin, edit the Product
or Party Master, submit a filing, or close an exception. Every workflow remains
fully usable without it, and when no model is configured the panel says so
rather than answering from nothing.

---

## 💰 AI Cost Controls

Every AI capability here — the Copilot, HTS classification, document
intelligence, product intelligence, normalization, the compliance audit and
email intake — bills against one `GEMINI_API_KEY`. `src/lib/ai/aiQuota.ts` is the
one counter all of them go through, backed by the `AiUsageWindow` table because
the database is the only thing every serverless instance shares.

**Metering is always on. Enforcement is opt-in.** With none of the variables below
set, every AI call is counted and every AI call is allowed — the agents behave
exactly as they did before, and an operator gets a spend history they did not
have. Ceilings apply only where one is deliberately configured.

| What | Where it applies | Default |
| --- | --- | --- |
| `AI_ACCOUNT_TOKENS_PER_DAY` | Every surface, per account, per UTC day | Unset — unlimited |
| `AI_AGENT_USER_REQUESTS_PER_MIN` | Agent routes, per user per surface | Unset — unlimited |
| `AI_AGENT_ACCOUNT_REQUESTS_PER_MIN` | Agent routes, per account per surface | Unset — unlimited |
| `COPILOT_USER_REQUESTS_PER_MIN` | Copilot, per user | 15 |
| `COPILOT_ACCOUNT_REQUESTS_PER_MIN` | Copilot, per account | 60 |

A value of `0`, a negative number or anything unparseable is treated as unset
rather than as a ceiling of zero, so a typo cannot refuse every request on the
platform.

Three properties are worth knowing before turning a ceiling on:

- **Refusal happens at the route, before any work starts.** Once an agent has
  begun writing decisions and findings against a shipment, stopping it would leave
  the shipment half-classified — worse than the overspend. Cron routes are not
  request-throttled for the same reason; the daily token ceiling still bounds what
  they spend.
- **Failure is not enforcement.** If the counter cannot be read or written — the
  migration below not yet applied, a database blip — the call is allowed and
  `ai.quota_unavailable` is logged once per process. A metering table must never be
  able to stop customs classification.
- **Windows are fixed, not sliding.** A minute window is a truncated minute, so a
  burst of up to twice the nominal rate is possible across a boundary. That is the
  trade for one atomic statement per increment, and for a cost guard it is the
  right one.

Counters are attributed to a real user where there is one and to `system` where
there is not (a cron-triggered classification has no user). Old windows are swept
by the existing `/api/cron/document-processing` tick, which reports
`usageWindowsPruned`.

`prisma/migrations/20260812200000_ai_usage_windows/migration.sql` is hand-written,
purely additive and idempotent — one new table, three indexes and one foreign key,
with `IF NOT EXISTS` throughout. It has been applied to the development database
(`prisma migrate deploy`, confirmed by `prisma migrate status`). Any other
environment needs the same step:

```bash
npx prisma migrate deploy
```

In an environment where it has not been applied — or during a database outage —
every AI call takes the fail-open path above: unmetered, unrestricted, and logged
as degraded.

---

## 🧠 AI Model Selection

Each of the seven AI surfaces chooses its model independently, through
`src/lib/ai/aiModel.ts`. It is keyed off the same surface names the quota layer
uses, so a call site names its surface once and gets both its model and its meter
under that name.

Precedence, most specific first:

| Rung | Variable | Scope |
| --- | --- | --- |
| 1 | `COPILOT_MODEL`, `HTS_CLASSIFICATION_MODEL`, `DOCUMENT_INTELLIGENCE_MODEL`, `PRODUCT_INTELLIGENCE_MODEL`, `NORMALIZATION_MODEL`, `COMPLIANCE_AUDIT_MODEL`, `DOCUMENT_INTAKE_MODEL` | One surface |
| 2 | `AI_DEFAULT_MODEL` | Every surface without an override |
| 3 | `GEMINI_MODEL` | Deprecated; honoured so existing environments do not silently move |
| 4 | built-in default | Nothing configured |

A blank value counts as unset at every rung, so `COPILOT_MODEL=` falls through
rather than asking the provider for a model named empty string.

This selects a model *name*, not a provider. The only adapter wired today is
google-genai, so a name from another vendor would be handed to the Gemini client
and rejected by it — adding a second vendor means an adapter, not a new variable.

Two places record the model rather than call it: the `DocumentParseVersion` row
written by the Document Intelligence Agent, and the `AgentExecution` row written
by the classification extractor. Both now report the model that actually ran, so
provenance cannot claim one model while another did the reading.

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
│   │                        #   table/BulkSelection, copilot/…)
│   ├── lib/                 # Core utilities (auth context, audit logger, db client,
│   │                        #   csvExport, i18n)
│   ├── modules/             # Domain logic (product, party, shipment, documents,
│   │                        #   copilot, tables, …), independent of the route layer
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
| `GEMINI_API_KEY` | AI agents (classification, document intelligence, normalization, product intelligence, HTS classification) and the AI Copilot | No default; agent calls fail closed without it, and the Copilot panel reports itself unconfigured |
| `AI_DEFAULT_MODEL` | The model every AI surface calls | Falls back to a built-in name. See [AI model selection](#-ai-model-selection) |
| `COPILOT_MODEL`, `HTS_CLASSIFICATION_MODEL`, `DOCUMENT_INTELLIGENCE_MODEL`, `PRODUCT_INTELLIGENCE_MODEL`, `NORMALIZATION_MODEL`, `COMPLIANCE_AUDIT_MODEL`, `DOCUMENT_INTAKE_MODEL` | One surface each | Each overrides `AI_DEFAULT_MODEL` for that surface alone |
| `GEMINI_MODEL` | Deprecated global model name | Still honoured below `AI_DEFAULT_MODEL` so existing environments do not move; prefer the variables above |
| `COPILOT_ENABLED` | AI Copilot only | Absent means on. `0` \| `false` \| `off` \| `no` hides the launcher and makes the route decline, leaving every other AI agent running |
| `AI_ACCOUNT_TOKENS_PER_DAY` | Daily token ceiling for an account, across every AI surface | Unset means unlimited; usage is still counted. See [AI cost controls](#-ai-cost-controls) |
| `AI_AGENT_USER_REQUESTS_PER_MIN`, `AI_AGENT_ACCOUNT_REQUESTS_PER_MIN` | Request ceilings on the agent routes | Both unset by default, so agents are metered and never refused |
| `COPILOT_USER_REQUESTS_PER_MIN`, `COPILOT_ACCOUNT_REQUESTS_PER_MIN` | Copilot request ceilings | Default 15 per user and 60 per account per minute |
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

Some suites read the configured database, so prefer running the files that cover
what you changed. The AI Copilot's safety behaviour and the shared AI cost
controls are covered by eight files that need no database and run in seconds:

```bash
npx vitest run tests/copilot-grounding.test.ts tests/copilot-tools.test.ts \
  tests/copilot-rbac.test.ts tests/copilot-service.test.ts \
  tests/copilot-origin-safety.test.ts tests/copilot-rate-limit.test.ts \
  tests/ai-quota.test.ts tests/ai-meter.test.ts
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
