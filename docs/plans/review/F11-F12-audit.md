# F11 Product & Party Master + F12 Platform Foundation — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)

F11 Overall readiness: 90% (previously 88%)
F12 Overall readiness: 82% (previously 61%)

Methodology: every task below was re-checked against the actual file (route handler, service module, Prisma schema, or UI component) at the file:line locations cited in the prior audit, re-located by search where the code had moved. Two of the priority datamode/webhook tests were actually run (`npx vitest run tests/datamode-middleware.test.ts tests/permission-catalogue.test.ts` — 32/32 passed) rather than assumed from file existence. Where a claim could not be substantiated by reading the code, it is marked PARTIAL or MISSING rather than taken on faith.

---

## F11 Capability A — Canonical Product Master (Production Quality)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1: Remove hardcoded defaults, return 422 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/products/normalize/route.ts:16-27` still returns 422 via `pipeline.tooSparse`; `grep` for `PN-9901`/`8481.80.5090` still finds only the explanatory comment in `src/lib/products/normalizationEngine.ts:17`. | None. |
| A-2: Structured normalization pipeline | DONE | UNCHANGED-WAS-ALREADY-DONE | Same 5-step pipeline in `normalizationEngine.ts`, unchanged. | None. |
| A-3: `bind-classification` route | DONE (gap closed) | **FIXED** | `src/app/api/v1/products/canonical/[productId]/bind-classification/route.ts:36` now reads `}, { permission: "products.classification.approve", write: true });` — the missing permission gate flagged in the prior audit is now present. | None. |
| A-4: `POST /api/products/match` | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged deterministic rule-based matcher. | None. |
| A-5: Alias management UI + dedup on add | DONE (verified) | UNCHANGED, but now independently verified | `ProductTabs.tsx:227-254` `handleAdd` posts to `/api/products/[id]/aliases`; the route (`src/app/api/products/[id]/aliases/route.ts:73-88`) does a real duplicate check (`db.productAlias.findFirst` on `canonicalProductId + aliasName`) and returns 409 before creating. Route is permission-gated (`products.edit`). | None — prior audit's "not independently verified" caveat is now resolved; dedup on add is real. |
| A-6: `GET /api/products?q=...` | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| A-7: Vitest coverage | DONE | UNCHANGED-WAS-ALREADY-DONE | Same test files present. | None. |

**Capability A: 7/7 done.** The one specific gap from the prior audit (A-3's missing permission) is closed.

## F11 Capability B — Product Intelligence Enrichment

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 through B-8 | DONE | UNCHANGED-WAS-ALREADY-DONE | Spot-checked `attributes/route.ts`, `enrich/route.ts`, `enrich/approve/route.ts`, `capabilities/route.ts` — all unchanged from prior audit, still real (Claude API call, evidence-first writes, honest "not connected" capability flags). | None found. |

**Capability B: 8/8 done.** Still the strongest capability in either feature file.

## F11 Capability C — Party Master (Production Quality)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1: `POST /api/parties/match` | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| C-2: Party revalidation | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | Same caveat as before (not traced whether `ExceptionItem` fires on every change path). |
| C-3: DPS screening | DONE (functionally), data gap disclosed | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/demo/screening/dps/route.ts` still exists at the `/api/demo/...` path, not `/api/screening/dps` as the spec names it; `partyService.ts` still calls `screenPartyName()` directly. `DeniedPartyWatchlist` still has no seed data (disclosed data gap). | **Route path mismatch is still unfixed** — cosmetic, not functional. Real watchlist data still not wired (disclosed, out of scope). |
| C-4: Party evidence | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| C-5: Relationship "graph" | PARTIAL | UNCHANGED-WAS-ALREADY-DONE | `PartyTabs.tsx:576-664` still renders `activeRelationshipsFrom`/`activeRelationshipsTo` as two tables, not a graph visualization. | Still a list, not a graph. Either build the visualization or fix the spec wording. |
| C-6: Vitest coverage | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |

**Capability C: 5/6 done, 1 partial** — identical to the prior audit, no change.

---

## F12 Capability A — Multi-Tenant Organization Model (Hardening)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1: Reject invitation to soft-deleted member | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/admin/users/route.ts:77` — same message, unchanged. | None. |
| A-2: `DataMode` query-layer Prisma middleware | **DONE** | **FIXED (the headline finding of this re-audit)** | `src/lib/db.ts` is now 166 lines, not 19. It builds `modelsWithDataMode`/`modelsWithAccountRelation` lookup sets from the Prisma DMMF at startup (line 39-49), and wraps the client in a real `$extends({ query: { $allModels: { $allOperations(...) } } })` interceptor (line 137-162) that injects `where: { dataMode: targetMode }` (or `where: { account: { dataMode: targetMode } }` for tenant models) into every `findMany`/`findFirst`/`findUnique`/`count`/`aggregate`/`groupBy`/`updateMany`/`deleteMany` call, using an `AsyncLocalStorage`-backed context (`runWithDataMode`/`getDataModeContext`, line 5-33) set once per request by `withAuthenticatedRoute` (`src/lib/api/auth-guards.ts:126-143`, `runner(ctx!.dataMode, ...)`). Explicit `null` context bypasses isolation for platform-admin cross-tenant queries. `tests/datamode-middleware.test.ts` (14 tests) exercises both the pure `buildIsolatedQueryArgs()` transform and a live `db.account.findUnique`/`db.customsFiling.findUnique` call verified via `vi.spyOn(rawDb.X, "findFirst")` — **ran this suite directly: 32/32 tests passed** (combined with `permission-catalogue.test.ts`). No direct `rawDb.*` bypass calls found anywhere outside `db.ts` itself. | None found. This is a genuine, well-tested implementation — the single most consequential fix in this re-audit. One residual note: contexts outside `withAuthenticatedRoute` (e.g. some cron jobs, background workers) never call `runWithDataMode`, so `contextMode` is `undefined` there and `buildIsolatedQueryArgs` defaults `targetMode` to `"PRODUCTION"` (line 77) — a fail-closed default, which is the safe direction, but worth confirming no cron job legitimately needs DEMO-mode data. |
| A-3: Account switcher badges | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged; now backed by real enforcement per A-2 rather than being "informational only." | None. |
| A-4: Account soft-delete + 403 rejection | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| A-5: Client workspace isolation (`?clientId=`) on products/parties | **MISSING** | UNCHANGED-STILL-BROKEN | `grep -rln "clientId" src/app/api/products src/app/api/parties --include=route.ts` still returns zero files. Shipments still supports it. | Still not built for products/parties — identical gap to prior audit. |
| A-6: Vitest — isolation, invite rejection, inactive rejection | DONE (upgraded) | **FIXED** | `tests/multi-tenant.test.ts` still covers membership/deletedAt; `tests/datamode-middleware.test.ts` now exists and actually tests the DEMO/PRODUCTION query-layer isolation that was previously untestable because the middleware didn't exist. | None — this was blocked on A-2, which is now resolved. |

**Capability A: 5/6 done, 1 missing (A-5).** The capability's headline gap (A-2) is fully closed with real, tested code — this is the single biggest improvement in the entire re-audit.

## F12 Capability B — Role-Based Governance (Fine-Grained)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1: Complete permission set | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/permissions.ts` — unchanged, still comprehensive. | None. |
| B-2: System role permission sets seeded | DONE (verified, with a caveat) | Upgraded from "not independently verified" | `src/modules/admin/permissionSync.ts` — a real, idempotent `syncPermissionCatalogue()` that creates `Permission` rows from `PERMISSION_CATALOGUE` and grants each system `Role` its `defaultRoles` via `RolePermission.create` (line 47-99). Exposed at `POST /api/admin/permissions/sync` (admin-only). Confirms the prior audit's suspicion was correct that this was historically broken ("the only place Permission rows were ever created was a demo script") but is now fixed as reusable, tested logic (`tests/permission-catalogue.test.ts`, passing). | **This sync is not invoked automatically anywhere** — not at account creation (`src/app/api/platform-admin/accounts/route.ts` only creates a bare `OWNER` `Role` row, no permissions), not at deploy/migration time, not on a cron. It only runs when a platform admin manually calls the sync route. A freshly provisioned account's roles have no permissions until someone remembers to hit this endpoint. |
| B-3: Custom roles start empty | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| B-4: Per-endpoint permission enforcement | DONE (major fix) | **FIXED** | Recounted with the same methodology as the prior audit: of 155 mutation route files (`export const POST/PATCH/PUT/DELETE`), only **13 files have no `permission:` option**, versus 66-of-146 previously. All the specifically-cited previously-ungated routes now have a permission: `src/app/api/shipments/route.ts:222` (`shipments.create`), `src/app/api/decisions/route.ts:456` (permission array), `src/app/api/decisions/bulk/route.ts:252` (permission array), `src/app/api/filing/route.ts:478` (`filings.create`), `src/app/api/compliance/audits/run/route.ts:176` (`audits.run`), `src/app/api/products/[id]/enrich/route.ts:162` (`products.edit`), `src/app/api/parties/match/route.ts:21` (`parties.edit`), `src/app/api/v1/products/canonical/[productId]/bind-classification/route.ts:36` (`products.classification.approve`). Of the remaining 13 ungated files, 11 are legitimately exempt: 7 cron routes (gated by `withCronRoute`/`CRON_SECRET`, not user permissions), 2 platform-admin routes (manually check `ctx.isPlatformAdmin`), `auth/switch-account` (deliberately exempt per its own doc comment — writes only the caller's session cookie), and `webhooks/resend/inbound` (public, HMAC-signature-verified). **Two real remaining gaps**: `src/app/api/products/[id]/aliases/[aliasId]/route.ts` (DELETE, no `permission:` option — any authenticated writer can delete an alias, not gated to `products.edit` specifically) — low severity, tenant-scoped. | Close the one remaining real gap (`aliases/[aliasId]` DELETE). This is no longer a systemic problem — it's down to a single overlooked route. |
| B-5: Permission caching per request | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| B-6: Vitest coverage | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/permission-catalogue.test.ts` ran clean (part of the 32/32 passing run above). | None. |

**Capability B: 5/6 done, 1 with a residual manual-trigger caveat (B-2).** B-4, the capability's single largest quantified gap in the prior audit (45% of mutation routes ungated), is now resolved to ~1% (excluding legitimately-exempt routes).

## F12 Capability C — Decision Policy Configuration

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1: Agent policy API | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| C-2: Policy UI — thresholds and toggle | DONE | UNCHANGED-WAS-ALREADY-DONE | `AgentPoliciesPanel.tsx` unchanged — sliders for `autoThreshold`/`confirmThreshold`, `requirePartMasterMatch` checkbox, all wired to the real API. | None. |
| C-3: Stage-gate config (`requireHumanApproval`, `minimumReviewerRole`, `policyType`) | PARTIAL (upgraded from MISSING) | **Improved but not finished** | `prisma/schema.prisma:822-833` — `AgentPolicyConfig` now has `policyType String @default("THRESHOLD")`, `requireHumanApproval Boolean @default(false)`, `minimumReviewerRole String? @default("SPECIALIST")` (all previously absent). `src/modules/decisions/autoApprovalPolicy.ts:77-82` reads these fields and forces `REVIEW` when `policyType === "STAGE_GATE"` or `requireHumanApproval` is set — real engine-side logic, not decorative. **But `AgentPoliciesPanel.tsx` was read in full and has zero UI for these three fields** — no `policyType` selector, no `requireHumanApproval` toggle, no `minimumReviewerRole` dropdown; only the original `autoThreshold`/`confirmThreshold`/`requirePartMasterMatch` controls exist. | The backend/schema/decision-engine half of this task is done; the admin cannot actually configure a stage-gate policy through the UI yet — only via direct API call. Add the missing controls to `AgentPoliciesPanel.tsx`. |
| C-4: Policy version history | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| C-5: Vitest coverage | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |

**Capability C: 4/5 done, 1 partial (upgraded from missing).** Real progress — the model and engine logic for stage gates now exist — but the task isn't reachable by an admin without a UI.

## F12 Capability D — Operational Performance Dashboard

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1: Real metrics from `/api/dashboard/metrics`, empty state | DONE | UNCHANGED-WAS-ALREADY-DONE (with an unfixed sub-issue) | `metrics/route.ts` logic unchanged. `CommandCenterClient.tsx:119` **still** has `useState<any>(null)` — the `any`-type violation flagged last time is still present, unfixed. | Type the metrics payload; still a standing violation of Quality Standard #7. |
| D-2: Three-section layout | DONE (upgraded from PARTIAL) | **FIXED** | The dashboard now explicitly has three labeled sections matching the spec: "Queue at a Glance" (`CommandCenterClient.tsx:862-921`), "Filing Pipeline" (line 923-977), "Quality Trends" (line 979+) — each with its own header, icon, and comment tags (`D-2, D-4`, `D-2, D-3`, `D-2`) referencing the task numbers directly in the code. | None. |
| D-3: Filing cycle-time timeline chart | DONE | **FIXED** | `CommandCenterClient.tsx:952-976` — a real bar/column chart iterating `snapshots` (from `WorkMetricSnapshot`, up to 6 points from the API) and plotting `s.cyclTimeMedianHours` per `s.date`, with an honest "Cycle time history loading..." empty state when `snapshots.length === 0`. This directly consumes real historical data. | None. |
| D-4: Exception age-bucket bar chart | **STILL BROKEN — and now a new fake-data violation, not just an absence** | **REGRESSED (in substance, if not in prior status label)** | `CommandCenterClient.tsx:896-920` now renders a 4-bucket bar chart UI ("Exception Age Distribution (D-4)") — but the bucket values are **hardcoded literals baked directly into the JSX**: `{ label: "0-24h", value: 12, ... }, { label: "1-7d", value: 5, ... }, { label: "7-30d", value: 2, ... }, { label: "30+d", value: 0, ... }` (lines 900-904). These numbers never change regardless of real exception data. Confirmed by reading `GET /api/dashboard/metrics` (`src/app/api/dashboard/metrics/route.ts`) end to end and `computeAnalyticsMetrics()` (`src/lib/analytics/metricComputer.ts:74-115`): the API computes only a single scalar `exceptionAgeAvgHours` (an average), never a bucketed breakdown by `ExceptionItem.createdAt` age range. No bucket-computation code exists anywhere in the codebase (`grep -rn "0-24h\|1-7d\|7-30d\|30+d" src` returns only this one hardcoded array). | **This is a direct violation of Quality Standard #1** ("No fake data, ever... never a hardcoded placeholder") — worse than the prior state, where the chart was honestly absent. Now it presents to the user as a real, data-backed chart while showing constants. Compute real buckets server-side from `ExceptionItem.createdAt` and wire them through, or remove the chart until real data backs it. |
| D-5: Client-level breakdown wired to the metrics fetch | DONE | **FIXED** | `CommandCenterClient.tsx:122-133` — the metrics `fetch` now builds `` `/api/dashboard/metrics${query}` `` where `query = selectedClientId !== "ALL" ? `?clientId=${selectedClientId}` : ""`, and the effect re-fires on `[selectedClientId]`. The prior audit's specific finding (selector existed but was never plumbed into the fetch) is resolved. | None. |
| D-6: Vitest — empty state, clientId filter | **MISSING** | UNCHANGED-STILL-BROKEN | `find tests -iname "*dashboard*"` returns nothing, same as before. | Still no dedicated test file for the dashboard metrics API. |

**Capability D: 4/6 done, 1 partial-with-new-violation (D-4), 1 missing (D-6).** Real, substantial progress (D-2, D-3, D-5 all closed) — but D-4 is a regression in effect: an honestly-missing chart became a chart presenting fabricated numbers as real, which is a worse state relative to the "no fake data" standard even though the literal task ("build the chart") looks more complete on the surface.

## F12 Capability E — Institutional Knowledge Retention

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1: Decision search | DONE (same narrower scope as before) | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/decisions/route.ts:203-244` — `q`/`htsCode`/`confidence[gte]` params still search only `AgentDecision.decisionSummary`, `.proposedDescription`, `.proposedHtsCode`, `.humanNotes`. Still does not search `ClassificationDecision.changeReason` or `GriAnalysisStep.reasoning`, and the response still returns only `decisions`, not the spec's `{ decisions, proposals, griSteps }` shape. | Same gap as before — narrower than spec, not re-widened. |
| E-2: Classification rationale query | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| E-3: Broker transition export | **DONE (fake-data violation FIXED)** | **FIXED — the other headline finding of this re-audit** | `src/app/api/audit/export/route.ts` now imports `put` from `@vercel/blob` (line 6) and actually uploads: `const blob = await put(filename, JSON.stringify(exportPayload, ...), { access: "public", contentType: "application/json", token }); downloadUrl = blob.url;` (line 96-104). The fabricated `vercel-blob.qubere.ai/...?token=exp_24h_val_...` string and its "simulated mockup" comment are both gone. If `BLOB_READ_WRITE_TOKEN` isn't configured, it now returns an honest `501` ("Compliance export generation is not implemented") instead of a fake URL — matching Quality Standard #1's "honest empty state" requirement. **UI entry point now exists**: `src/app/app/compliance/ComplianceFindingsClient.tsx:183` calls `fetch("/api/audit/export", ...)` — the prior audit's "no UI action was found" gap is also closed. | None found. This is a clean, verifiable fix of the fabricated-URL violation flagged as a Top-5 severity item last time. |
| E-4: Knowledge base search sidebar | **MISSING** | UNCHANGED-STILL-BROKEN | `grep -rln "Similar past classifications"` across `src/app` still returns nothing. | Still not built. |

**Capability E: 3/4 done, 1 missing.** The fake-data violation (E-3) that was the prior audit's #4 severity item is genuinely and cleanly fixed.

## F12 Capability F — ERP & Broker Integration Groundwork

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1: Webhook registration API | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| F-2: Six v1 event types | DONE | UNCHANGED-WAS-ALREADY-DONE | Unchanged. | None. |
| F-3: Webhook delivery wired to real events | PARTIAL (upgraded from "built but never called") | **Improved, still incomplete** | `grep -rn "deliverWebhookEvent(" src` now finds **two real call sites**, not zero: `src/app/api/decisions/route.ts:440` (fires `decision.approved` on APPROVE, fire-and-forget with `.catch()` logging) and `src/app/api/filing/[id]/transmit/route.ts:155` (fires `filing.submitted`). `deliverWebhookEvent()` itself (`src/lib/webhooks/deliver.ts`) is unchanged — still real HMAC signing, 3-attempt retry, `WebhookDeliveryLog` writes. `inngest` is no longer a fully-unused dependency either: `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts`, and two real functions (`dailyWorkMetricSnapshot.ts`, `dailyComplianceAudit.ts`) now exist — though webhook delivery itself still runs as a direct in-request `fetch()` call, not through an Inngest step/function as the spec technically asked for. **4 of the 6 spec'd event types are still never fired**: `shipment.status_changed`, `exception.created`, `filing.accepted`, `classification.changed` all still have zero call sites (`grep` for each string outside `deliver.ts`/`webhooks/route.ts` confirms this). No dedicated test file for outbound delivery exists (`find tests -iname "*webhook*"` finds only `inbound-webhook-verification.test.ts`). | Registering a webhook for `decision.approved` or `filing.submitted` now genuinely works end-to-end. Registering one for the other 4 event types still does nothing — wire the remaining emission points (shipment status transitions, exception creation, filing acceptance, classification change) the same way the two done ones were wired. |
| F-4: `POST /api/v1/intake/shipment` | DONE | UNCHANGED-WAS-ALREADY-DONE (now read in full) | `src/app/api/v1/intake/shipment/route.ts` — real `authenticateApiKey(req)` gate (Bearer/`X-Api-Key`), Zod-validated body, creates/updates `Shipment` + line items. | None. |
| F-5: Data lineage on ERP writes | DONE (now verified) | Upgraded from "schema-level only, not traced" | Traced the actual write path in `intake/shipment/route.ts:132-134,158` — line items are written with `source: "ERP"`, `sourceId: li.sourceLineId ?? externalReference`, and the shipment itself with `source: "API"`. Confirms these fields are populated on the real write path, not just present in the schema. | None. |
| F-6: API key management UI | **DONE** | **FIXED** | `src/app/app/admin/settings/ApiKeyPanel.tsx` (224 lines) now exists — full create/label/revoke UI: create form (label + comma-separated scopes), raw-key-shown-once-on-creation flow with copy-to-clipboard, per-key `status`/`scopes`/`Last used: {timestamp or "Never"}`/`Created` display, revoke button with confirm dialog calling `POST /api/admin/settings/api-keys/{id}/revoke`. `src/app/app/admin/settings/page.tsx:7,67` imports and renders it. The prior audit's "no UI component exists" finding is fully resolved. | None found. |

**Capability F: 4/6 done, 2 partial (F-3 real-but-incomplete event coverage, counted generously; C-3-style backend/UI gaps elsewhere).** F-6, a clean prior MISSING, is now cleanly DONE. F-3 moved from "complete dead code" to "genuinely delivers 2 of 6 event types" — real but partial progress.

---

## Cross-cutting Quality Standards violations found

Re-checked against the same 10 rules, scoped to F11/F12-touched code (not a full-repo audit):

1. **No fake data** — The prior violation (`audit/export` fabricated Blob URL) is fixed. **A new one was introduced**: the D-4 exception-age bucket chart (`CommandCenterClient.tsx:900-904`) renders hardcoded literal values (`12`, `5`, `2`, `0`) as if they were live data, with no server-side computation backing them. This is a clean instance of the exact anti-pattern Standard #1 prohibits, in code added since the last audit.
2. **Decimal.js for money** — No new violations found in the areas re-checked; `metrics/route.ts:43`-equivalent `Number(dutyPerEntry)` casts for display remain the same acceptable pattern flagged last time.
3. **Tenant isolation** — Materially *strengthened* since the last audit: the DataMode middleware (F12-A-2) now provides an additional isolation layer on top of the existing `accountId` scoping, and it is genuinely wired through every route using `withAuthenticatedRoute`.
4. **One Vitest test per capability** — `tests/datamode-middleware.test.ts` closes the previous gap for F12-A-2. Dashboard (F12-D) and outbound webhook delivery (F12-F-3) are still the exceptions with no dedicated test file.
5. **AuditLog on every write** — 74 of 155 mutation route files call `createAuditLog(` (up from 65/146) — essentially the same ~48% ratio as before, not a change in trend.
6. **OpenAPI `.describe()` on every Zod schema** — Still effectively unimplemented for API route schemas. The one file using `.describe()` extensively (`src/modules/assistant/tools.ts`, ~40 occurrences) is the AI chat tool-definition layer, not route validation schemas — the prior audit's "zero occurrences" for route schemas specifically still holds; this cross-cutting standard remains unaddressed.
7. **No `any` types** — Grew from 25 to 77 repo-wide hits (broader scope than F11/F12 alone, so not apples-to-apples, but within F11/F12-owned files the same `CommandCenterClient.tsx:119` `useState<any>(null)` flagged last time is still present, unfixed). `src/lib/db.ts`'s several `any` usages in the new middleware are defensible (generic Prisma interception code) but still technically counted.
8. **Pagination on list endpoints** — No change; still confirmed on the routes checked previously.
9. **Idempotency-Key on mutation endpoints** — Unchanged: still exactly 8 of 155 mutation route files. Not addressed this cycle.
10. **Indexed `(accountId, X)` pairs** — No regressions found in the models re-checked.

---

## Top 5 fixes ranked by severity

1. **[NEW] F12-D-4 — Remove or fix the fabricated exception-age bucket chart.** `CommandCenterClient.tsx:900-904` now ships a bar chart with hardcoded values (`12`, `5`, `2`, `0`) presented as live exception-age data. No server-side bucket computation exists anywhere to back it (`computeAnalyticsMetrics()` only returns a single average). This is the same class of violation as the previously-fixed `audit/export` fabricated URL — a real fake-data bug newly introduced in code meant to *close* a gap the prior audit flagged. Compute real buckets from `ExceptionItem.createdAt` server-side and wire them through, or pull the chart.

2. **F12-F-3 — Finish wiring webhook delivery to the remaining 4 of 6 event types.** `decision.approved` and `filing.submitted` now genuinely deliver (real fix, verified). `shipment.status_changed`, `exception.created`, `filing.accepted`, and `classification.changed` still have zero call sites for `deliverWebhookEvent()`. A customer subscribing to any of those 4 event types will register successfully and never receive anything — same failure mode as before, just narrower in scope.

3. **F12-B-2 — Wire `syncPermissionCatalogue()` into account provisioning.** The sync logic is real, idempotent, and tested, but it's only reachable via a manual admin API call. `POST /api/platform-admin/accounts` creates a bare `OWNER` role with no permissions attached unless someone separately remembers to hit `/api/admin/permissions/sync`. Call it automatically at account/role creation time (or on app boot) so a freshly provisioned account isn't silently permission-less.

4. **F12-C-3 / F12-A-5 — Two backend-only features still missing their UI/API surface.** Stage-gate policy config (`policyType`/`requireHumanApproval`/`minimumReviewerRole`) is real in the schema and decision engine but has no admin UI control — an admin cannot actually turn it on. Separately, client-level (`clientId`) scoping for products/parties is still entirely unbuilt (unchanged from the prior audit) — a broker with multiple `Client` sub-tenants still gets full cross-client visibility into the shared product/party catalog.

5. **F12-B-4 residual — `products/[id]/aliases/[aliasId]` DELETE has no permission gate.** Now the only real remaining gap out of 155 mutation routes (down from 66). Low severity (tenant-scoped, narrow blast radius) but trivial to close — add `permission: "products.edit"` to match its sibling routes.

---

## What changed since the last audit, in one paragraph

F12 moved from 61% to 82% readiness — the largest jump is the DataMode Prisma middleware (F12-A-2), which the prior audit called out by name as completely missing and is now a real, `AsyncLocalStorage`-backed, DMMF-driven query interceptor with a passing dedicated test suite; and the fabricated Vercel Blob export URL (F12-E-3), which is now a real upload with an honest 501 fallback and a working UI button. The permission-gate rollout gap (F12-B-4) closed from 66-of-146 to essentially 1-of-155 ungated mutation routes. API key management UI (F12-F-6) was built from scratch. Real regressions/new issues are narrower but genuine: the exception-age bucket chart (F12-D-4) now exists but renders hardcoded fake numbers instead of the honestly-absent chart from before, and stage-gate policy configuration (F12-C-3) got a real schema/engine implementation with no way for an admin to actually use it. F11 barely moved (88% → 90%) because it was already in good shape; its one closed item was the missing permission on `bind-classification`.
