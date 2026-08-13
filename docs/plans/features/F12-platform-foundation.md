# F12 · Platform Foundation
> Depends on: F01 (permission guards baseline)
> Branch: `feat/platform-foundation`
> Features covered: #50 Multi-tenant org model, #51 RBAC, #52 Decision policy configuration, #53 Operational performance dashboard, #54 Institutional knowledge retention, ERP integration groundwork

---

## Capability A — Multi-Tenant Organization Model (Hardening)

Core model is solid (~70%). Gaps: soft-deleted members still receive invitations; `dataMode` is not enforced at query layer.

* **Task A-1**: Fix invitation to soft-deleted member: before creating an invitation, check `AccountMembership.deletedAt IS NULL AND status = 'ACTIVE'`. If member exists with `deletedAt` set, reject with 409: "This user was previously removed from this account. Re-invite will reactivate their membership."
* **Task A-2**: `DataMode` query isolation: create a Prisma middleware in `src/lib/db.ts` that intercepts all `findMany` / `findFirst` / `findUnique` queries. If the current account has `dataMode: PRODUCTION`, add `AND dataMode = 'PRODUCTION'` (or `dataMode IS NULL`) to the query. `DEMO` data never leaks into production accounts. Test this middleware.
* **Task A-3**: Account switching: `AccountSwitcher.tsx` already exists. Add account type badge (ENTERPRISE / INDIVIDUAL) and data mode indicator (DEMO / PRODUCTION / SANDBOX). Users cannot switch to accounts they're not members of.
* **Task A-4**: Account soft-delete: `POST /api/platform-admin/accounts/[id]/deactivate`. Sets `Account.status = "INACTIVE"` and `Account.deletedAt`. All queries in `auth-guards.ts` reject inactive accounts with 403.
* **Task A-5**: Client workspace isolation: broker accounts have `Client` sub-tenants. Each client's shipments, products, and parties are scoped to `clientId`. Queries in shipment/product/party routes must support `?clientId=` filter. A broker cannot access one client's data from another client's context.
* **Task A-6**: Vitest: DEMO account data does not appear in PRODUCTION account queries; soft-deleted member cannot receive invitation; inactive account is rejected at auth layer.

## Capability B — Role-Based Governance (Fine-Grained)

`Role`, `Permission`, `RolePermission` exist. Many routes don't check specific permissions.

* **Task B-1**: Define the complete permission set in `src/lib/permissions.ts` (likely already started — validate and extend):
  ```
  documents.read, documents.create, documents.delete
  shipments.read, shipments.create, shipments.manage
  classification.read, classification.create, classification.approve, classification.override
  decisions.review, decisions.approve, decisions.override
  exceptions.read, exceptions.resolve, risk.accept
  filing.read, filings.create, filings.submit
  drawback.read, drawback.claim
  refunds.read, refunds.manage
  audits.read, audits.run
  regulatory.read, regulatory.review
  users.read, users.manage
  roles.manage
  account.manage
  products.read, products.manage
  parties.read, parties.manage
  ai.use
  ```
* **Task B-2**: System role permission sets: seed in `prisma/seed.ts`:
  - `OWNER`: all permissions
  - `ADMIN`: all except `account.manage`, `roles.manage`
  - `BROKER`: documents, shipments, classification, decisions, exceptions, filing, products, parties (all read+create+manage), drawback, refunds, audits (run), ai.use
  - `SPECIALIST`: same as BROKER but not `filings.submit` or `drawback.claim`
  - `REVIEWER`: read-only on everything + `decisions.review`
  - `VIEWER`: read-only on everything
* **Task B-3**: Custom roles: `POST /api/admin/roles` — create a custom role for the account with a selected permission set. Custom roles inherit no permissions; they start empty. UI: roles management page already exists (`/app/admin/roles`) — wire to real API.
* **Task B-4**: Per-endpoint permission enforcement: for every endpoint in the audit from F01-E-1, add the `requirePermission(ctx, perm)` call. No consequential mutation goes unguarded.
* **Task B-5**: Permission check performance: permissions are resolved from the Clerk JWT session + account membership role lookup. Cache the resolved permission set in the request context (once per request, not once per permission check). Never hit the database multiple times per request for permissions.
* **Task B-6**: Vitest: VIEWER role cannot call `POST /api/decisions`; BROKER role can; custom role with only `documents.read` cannot approve decisions.

## Capability C — Decision Policy Configuration

Auto-approval thresholds are hardcoded. This allows account-level configuration.

* **Task C-1**: `AgentPolicyConfig` model (from F01-B-3): expose via API. `GET /api/admin/settings/agent-policies` — list all configured policies for the account. `POST /api/admin/settings/agent-policies` — create/update a policy.
* **Task C-2**: Policy configuration UI in `/app/admin/settings`: "AI Policies" tab. Shows: list of agent types (HTS Classification, Origin Determination, Valuation, etc.). For each: auto-approval threshold slider (0–100%), require-part-master-match toggle, confirm threshold. Save writes `AgentPolicyConfig` row.
* **Task C-3**: Approval workflow configuration: for each stage in the autonomous workflow (F04-G), the admin can set: `requireHumanApproval: boolean`, `minimumReviewerRole: Role`. This is stored in `AgentPolicyConfig` with `policyType: "STAGE_GATE"`.
* **Task C-4**: Policy version history: `AgentPolicyConfig` changes are logged to `AuditLog`. Show policy history in the settings UI — when was each threshold changed, and by whom.
* **Task C-5**: Vitest: changing the auto-threshold to 95% means decisions at 90% confidence go to CONFIRM, not AUTO; policy history records the change.

## Capability D — Operational Performance Dashboard

`CommandCenterClient.tsx` exists with fake metric cards.

* **Task D-1**: Replace all hardcoded metric values with real data from `GET /api/dashboard/metrics?period=MONTHLY`. This API returns `WorkMetricSnapshot[]` (from F08-C). If no snapshots exist yet (first week), show empty state with "Metrics will appear here after the first daily computation."
* **Task D-2**: Dashboard layout: three sections:
  - **Queue at a glance**: count of NEEDS_REVIEW, BLOCKED, CONFIRM decisions; count of open exceptions; oldest unresolved exception age
  - **Filing pipeline**: shipments by status, average cycle time (from metric snapshot), this week's filed vs. last week
  - **Quality trends**: first-pass acceptance rate (30-day), touch rate, exception resolution rate
* **Task D-3**: Filing cycle time: timeline chart showing rolling 30-day median of "doc receipt → filing submission" in hours. From `WorkMetricSnapshot.cyclTimeMedianHours`.
* **Task D-4**: Exception age distribution: bar chart showing counts by age bucket (0-24h, 1-7 days, 7-30 days, 30+ days). From `ExceptionItem.createdAt`.
* **Task D-5**: Client-level breakdown: for broker accounts, show metrics per client (not just account-wide). `GET /api/dashboard/metrics?clientId=...`.
* **Task D-6**: Vitest: dashboard API with no metric snapshots returns empty-state structure, not error; metric API with clientId filter returns only that client's data.

## Capability E — Institutional Knowledge Retention

Knowledge is retained if decisions are stored with reasoning. Query surface is missing.

* **Task E-1**: Decision search: `GET /api/decisions?q={product description}&htsCode=...&confidence[gte]=80` — full-text search across `AgentDecision.summary`, `ClassificationDecision.changeReason`, `GriAnalysisStep.reasoning`. Returns `{ decisions, proposals, griSteps }` relevant to the query.
* **Task E-2**: "Why was this classified?" query: `GET /api/products/[id]/classification-rationale` — returns the complete `ClassificationCase` with GRI steps and ruling citations for the current approved classification. This is the institutional knowledge for that product.
* **Task E-3**: Broker transition export: when a broker account relationship ends, the importer's `Owner` can download their full product master + classification rationale + reasonable-care records. This is the "portable compliance record" (F08-E). Document that this is their right and provide a clear UI action.
* **Task E-4**: Knowledge base search UI: in the HTS classification workspace, a sidebar panel "Similar past classifications" shows `GET /api/decisions` results for the current product description. Shows: similar products, their HTS codes, confidence, and GRI reasoning. This is institutional memory surfaced in context.

## Capability F — ERP & Broker Integration Groundwork

No integration exists. Build the foundation; specific connector implementations come later.

* **Task F-1**: Webhook outbound system: `POST /api/admin/settings/webhooks` — register an endpoint URL and event types. `AccountWebhook` model (new): `{ id, accountId, url, secret, events: string[], status, lastDeliveryAt }`.
* **Task F-2**: Webhook event types for v1: `shipment.status_changed`, `decision.approved`, `exception.created`, `filing.submitted`, `filing.accepted`, `classification.changed`.
* **Task F-3**: Webhook delivery: Inngest function delivers events to registered endpoints. Payload signed with HMAC-SHA256 using `AccountWebhook.secret`. Retry on failure (3 attempts, exponential backoff). Log delivery attempts to `WebhookDeliveryLog` model (new).
* **Task F-4**: Inbound API (for ERP push): the `POST /api/v1/intake/document` endpoint from F02-A-2 serves as the ERP inbound. Add a `POST /api/v1/intake/shipment` endpoint for ERP to push shipment data directly (creates/updates `Shipment` + `ShipmentLineItem` rows). Authenticated via API key.
* **Task F-5**: Data lineage: every `ShipmentLineItem` and `Product` field that was set by an ERP push records `source: "ERP"`, `sourceSystem: string`, `sourceId: string`. The audit trail shows where the value came from.
* **Task F-6**: API key management UI: `/app/admin/settings` — "API Keys" tab. Create, label, revoke API keys. Show last used timestamp. Keys have scopes matching the permission set (e.g. a document-ingest key only has `documents.create`).

## Data gaps
- **ACE/ABI credentials**: ERP integration roadmap includes CargoWise and Descartes broker systems. These require bilateral integration agreements. V1 establishes the API contract; specific connector implementations are partner-dependent.
- **SAP GTS / Oracle GTM connectors**: These require access to sandbox environments. Scope for a later milestone when an enterprise customer with these systems is onboarding.
