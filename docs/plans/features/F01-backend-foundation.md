# F01 · Backend Foundation
> Priority: MUST ship before any other feature. Everything downstream depends on these fixes.
> Branch: `feat/backend-foundation`

These are cross-cutting fixes to the API layer, data model, and AI pipeline that block every other feature. No new product capability ships correctly without this work landing first.

---

## Capability A — Decision State Normalizer
Eliminate the four-way vocabulary drift that causes `/app/actions` to show the wrong rows.

* **Task A-1**: Create `src/lib/decisions/decisionState.ts` with a closed `DecisionState` union (`AUTO_VERIFIED | NEEDS_REVIEW | BLOCKED | APPROVED | REJECTED | IN_PROGRESS`), a `normalizeDecisionStatus(raw: string): DecisionState | null` function that maps every legacy string (including `"Needs Review"`, `"Review Required"`, `"Attention"`, `"Pending"`, `"Approved"`), and an exported `ACTIONABLE_STATES` set.
* **Task A-2**: Add Prisma migration: `AgentDecision.triageState String?`, `AgentDecision.blockedReason String?`. Index `(accountId, triageState)`.
* **Task A-3**: Update all agent writers (`htsAgent.ts`, `originRulesAgent.ts`, `complianceAuditAgent.ts`, `valuationAssistsAgent.ts`, `customsFilingAgent.ts`, `productIntelligenceAgent.ts`, `filingReadinessAgent.ts` in `packages/ai/`) to write `triageState` from structured agent output, not as a string.
* **Task A-4**: Delete the four client-side categorizers (`ActionsClient.categorize`, `DocumentReviewPanel.classifyDecision`, inline block in `dashboard/page.tsx`, `reviewCategory` in `editableFields.ts`). All readers use `triageState` column.
* **Task A-5**: Update `src/lib/decisions/workQueue.ts` and `actions/page.tsx` to filter on `triageState IN (ACTIONABLE_STATES)`.
* **Task A-6**: Write a Vitest test asserting every literal an agent can produce normalizes to a non-null `DecisionState`.
* **Task A-7**: Write and run a Prisma migration script that backfills `triageState` on existing `AgentDecision` rows using `normalizeDecisionStatus`.

## Capability B — Auditable Auto-Approval
Make machine approvals distinguishable from human approvals everywhere.

* **Task B-1**: Add Prisma migration: `AgentDecision.autoApproved Boolean @default(false)`, `AgentDecision.autoApprovalPolicy String?`. State `AUTO_VERIFIED` is the only valid state for auto-approved decisions; `APPROVED` is reserved for human reviewers.
* **Task B-2**: Create `src/lib/decisions/autoApprovalPolicy.ts`: pure function `shouldAutoApprove(confidence: number, partMasterMatch: boolean, agentName: string, accountPolicy?: AgentPolicyConfig): "AUTO" | "CONFIRM" | "REVIEW"`. Default thresholds: confidence ≥ 90 AND part-master match → AUTO; confidence ≥ 80 → CONFIRM; else REVIEW. Part-master disagreement always → REVIEW regardless of confidence.
* **Task B-3**: Create `AgentPolicyConfig` Prisma model: `{ accountId, agentName, autoThreshold, confirmThreshold, requirePartMasterMatch }`. Used by `autoApprovalPolicy.ts`; falls back to defaults if no row.
* **Task B-4**: Replace all hardcoded per-agent thresholds with `shouldAutoApprove()`.
* **Task B-5**: Every auto-approval writes an `AuditLog` row: `{ action: "AUTO_APPROVE", entity: "AgentDecision", metadata: { policyId, confidence, agentName, partMasterMatch } }`.
* **Task B-6**: Vitest test: `shouldAutoApprove` for all threshold boundary conditions; assert part-master disagreement always returns "REVIEW".

## Capability C — Decimal-Safe Monetary Arithmetic
Replace all floating-point money calculations.

* **Task C-1**: Add `Decimal.js` to the root `package.json`. Create `src/lib/tariff/decimal.ts` with `roundToCents(d: Decimal): Decimal`, `toNumber(d: Decimal): number` (for JSON serialization only), and `fromString(s: string): Decimal`.
* **Task C-2**: Refactor `src/lib/tariff/dutyEngine.ts`: all inputs and outputs are `Decimal`. Duty stack layers (`base`, `section301`, `section232`, `adcvd`) stored separately, never summed before return. MPF clamped to statutory min/max with Decimal arithmetic.
* **Task C-3**: Refactor `src/app/api/simulator/scenarios/[id]/calculate/route.ts` and `src/app/api/filing/[id]/entry-summary/route.ts` to use the refactored engine.
* **Task C-4**: Refactor `src/app/api/drawback/match/route.ts` and `src/app/api/drawback/claims/route.ts` to use Decimal for all refund calculations.
* **Task C-5**: Refactor `src/app/api/refunds/opportunities/scan/route.ts` and `src/app/api/refunds/psc/route.ts` — remove the heuristic multipliers (0.4, 0.15, 0.7). These routes must return an honest "no real data available" response until real calculation logic is implemented. No fake numbers.
* **Task C-6**: Vitest test: MPF calculation at $0, $10,000, $1,000,000 declared value; drawback at various quantities.

## Capability D — GET Endpoint Mutation Cleanup
Remove all database writes from GET handlers.

* **Task D-1**: Remove seeding from `GET /api/exceptions` — if empty, return `[]`, not seeded rows.
* **Task D-2**: Remove seeding from `GET /api/documents/[id]/extractions` — if empty, return `[]`.
* **Task D-3**: Remove `ensureHtsSeeded()` from the HTS GET route. HTS data is seeded via `prisma/import-hts.ts` only.
* **Task D-4**: Remove seeding from `GET /api/findings` — if empty, return `[]`.
* **Task D-5**: Add `npm run seed` documentation to README so developers know to run seed scripts manually.

## Capability E — Fine-Grained Permission Guards
Enforce domain permissions on all consequential endpoints.

* **Task E-1**: Audit every POST/PATCH/DELETE route in `src/app/api/`. Create a spreadsheet/comment in `src/lib/api/auth-guards.ts` listing the required permission for each.
* **Task E-2**: Add `requirePermission(ctx, permission: string): void` to `auth-guards.ts` — throws 403 if the user's roles don't grant the permission.
* **Task E-3**: Add permission checks to: `POST /api/filing/[id]/transmit` → `filings.submit`, `POST /api/drawback/claims` → `drawback.claim`, `POST /api/classification/classify` → `classification.create`, `PATCH /api/exceptions/[id]` with waive action → `risk.accept`, `POST /api/refunds/psc` → `refunds.manage`.
* **Task E-4**: Verify cross-tenant: nested entities (line items, documents, extractions) validate that the parent shipment belongs to `ctx.accountId`. Add Vitest integration test: account B cannot read account A's shipment detail.

## Capability F — Token Security & Audit Hardening
* **Task F-1**: In `POST /api/admin/users` invitation flow — hash invitation token with SHA-256 before storing in `AuditLog.metadata`. Never log the raw token.
* **Task F-2**: Add `requestId` to every API error response. `src/lib/api/error.ts` must inject `requestId` from the request header (or generate one if absent) into every `ApiErrorResponse`.
* **Task F-3**: Standardize all existing routes that return ad-hoc `{ error: string }` to use the `ApiErrorResponse` envelope.

## Capability G — Pagination on All Collection Endpoints
* **Task G-1**: Add cursor-based pagination helper to `src/lib/api/pagination.ts`: `parsePagination(query) → { limit: number, cursor?: string }`, `buildPage(items, total, cursor) → PagedResponse<T>`.
* **Task G-2**: Apply pagination to: `GET /api/shipments`, `GET /api/exceptions`, `GET /api/documents`, `GET /api/drawback/claims`, `GET /api/findings`, `GET /api/parties`, `GET /api/products`. Default limit: 50, max: 200.
* **Task G-3**: Update all frontend data-fetching hooks to pass `limit` and `cursor`; implement "load more" on lists that currently fetch all.

## Capability H — OpenAPI Spec Generation
Required for chat tool calling.

* **Task H-1**: Add `zod-to-openapi` to dev dependencies. Create `scripts/generate-openapi.ts` that walks `src/app/api/**/route.ts`, extracts Zod schemas, and emits `docs/openapi.yaml`.
* **Task H-2**: Add `"openapi": "tsx scripts/generate-openapi.ts"` to package.json scripts.
* **Task H-3**: Ensure every route's Zod schema has a `.describe()` annotation. These become the tool descriptions in the chat interface.
* **Task H-4**: Add OpenAPI generation to CI (`npm run openapi` must not error).
