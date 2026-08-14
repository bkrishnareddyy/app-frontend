# Qubere — Open Items
> Compiled: 2026-08-13 (second-pass re-audit). Everything below is still broken, missing, or newly introduced — verified against current code, not against any prior status claim. Full task-by-task detail and file:line evidence for each item lives in the per-feature audit file linked at the end of its row.

## Scorecard (current)

| Feature | Now | Was (baseline) | Audit |
|---|---|---|---|
| F01 Backend Foundation | 80% | 62% | [F01](F01-audit.md) |
| F02 Document Intelligence | 63% | 74%* | [F02-F03](F02-F03-audit.md) |
| F03 Shipment Workspace | 63% | 71%* | [F02-F03](F02-F03-audit.md) |
| F04 Actions & Workflow | 80% | 55% | [F04-F05](F04-F05-audit.md) |
| F05 HTS Classification | 86% | 57% | [F04-F05](F04-F05-audit.md) |
| F06 Origin, Valuation & Tariff | 87% | 65% | [F06-F07-F08](F06-F07-F08-audit.md) |
| F07 Filing & Entry | 88% | 80% | [F06-F07-F08](F06-F07-F08-audit.md) |
| F08 Audit & Governance | 80% | 52% | [F06-F07-F08](F06-F07-F08-audit.md) |
| F09 Duty Recovery | 75% | 45% | [F09-F10](F09-F10-audit.md) |
| F10 Regulatory & Tariff Intelligence | 73% | 58% | [F09-F10](F09-F10-audit.md) |
| F11 Product & Party Master | 90% | 88% | [F11-F12](F11-F12-audit.md) |
| F12 Platform Foundation | 82% | 61% | [F11-F12](F11-F12-audit.md) |
| F13 Chat Interface | 52% | 32% | [F13](F13-audit.md) |
| **Overall** | **~77%** | **~62%** | |

*F02/F03 dropped below their own baseline on deeper re-inspection — see the integrity note below. Not a code regression per se; the original 74%/71% didn't catch that the real reconciliation engine never runs on the live upload path.

## Process note — verify before trusting a "done" claim

Two separate audit passes this round found a status file that had been overwritten with claims that didn't hold up:
- F04/F05's on-disk audit had been left claiming **100%, every task DONE** — including a circuit breaker and stage-stepper UI that don't exist anywhere in the code.
- F02/F03 had an intermediate "self-reported" status claiming **83%/80%** — the actual re-verification landed at 63%/63%, because credit had been given for backend/schema work that never reaches an end user (the real reconciliation engine, the real shipment-candidate matching) even though the *routes* for those exist correctly.

Treat any "100%" or suspiciously-high self-reported number in this codebase as a claim to verify, not a fact — check the file:line evidence in the linked audit before building on top of it.

---

## Tier 0 — Broken in the live/production path right now

1. **Regulatory-ingest cron will crash on its only reachable invocation path.** `src/app/api/cron/regulatory-ingest/route.ts:186-201` — the fixed no-`accountId` fallback branch calls `db.notification.create({ accountId: null, userId: "system", ... })`, but `Notification.accountId` is a non-nullable, FK-constrained column and no `User` with id `"system"` exists. This branch is the *only* one ever invoked in production (via the daily `data-dispatcher` cron) and has no try/catch, so it throws on the first `actionRequired` regulatory update and aborts the rest of that batch. [F09-F10](F09-F10-audit.md)
2. **The real cross-document reconciliation engine never runs on the primary user journey.** `PipelineOrchestrator.processEvent` (`src/modules/agents/pipelineOrchestrator.ts:209`) still calls the old, separate `src/modules/shipment/reconciliationEngine.ts`, which hard-codes `conflictsDetected = 0`. The correct, tested engine (`src/lib/reconciliation/reconciliationEngine.ts`) is only reachable via `POST /api/shipments/[id]/reconcile`, which has zero frontend callers. Every downstream fix (CONFLICT exceptions, resolution fields, AuditLog) is real and correctly wired to that route — it just never fires automatically. [F02-F03](F02-F03-audit.md)
3. **Chat's "Resolve Exception" button is guaranteed to fail on every use, but tells the user it succeeded.** `ChatClient.tsx:1489-1499` omits the server-required `expectedVersion` field, so the request 400s every time — but the code unconditionally `alert()`s success. Approve/Reject share the same no-`res.ok`-check pattern, so any real failure (permission denied, stale version) is silently reported as success. [F13](F13-audit.md)
4. **A demo/simulated filing path writes the human-reviewer-only status in production.** `src/modules/agents/customsFilingAgent.ts:176` sets `triageState: "APPROVED"` from a `[DEMO MODE]` simulated ACE transmission, with no environment gate — this directly violates the invariant that `APPROVED` means a licensed human reviewed it, undermining the core auditability guarantee F01 exists to establish. [F01](F01-audit.md)
5. **Shipment-candidate suggestions are collected but never shown to anyone.** `DocumentShipmentCandidate` rows are written correctly (join, pagination, confidence field all real now) but `grep -rn "shipmentCandidates" src/app src/components` still returns only the API route — no UI anywhere reads it. Same gap as the original baseline audit, just with better backend plumbing underneath. [F02-F03](F02-F03-audit.md)

## Tier 1 — New fake-data violations introduced during this round of fixes

6. **Dashboard exception-age chart shows fabricated numbers as live data.** `CommandCenterClient.tsx:900-904` — a real-looking 4-bucket bar chart with hardcoded literals `12`, `5`, `2`, `0` baked into the JSX. No bucket-computation code exists anywhere; `computeAnalyticsMetrics()` only returns a single average. Worse than the prior state, where the chart was honestly absent. [F11-F12](F11-F12-audit.md)
7. **Recovery UI shows fake drawback-lot data even though the real pipeline now produces real lots.** `VaultClient.tsx:97-117` — `// Fetch mock/available lots for layout representation`, two hardcoded fabricated lot objects. There is no `GET /api/drawback/lots` endpoint at all, so even a fixed frontend has nothing real to call. [F09-F10](F09-F10-audit.md)
8. **A new `origDuty * 0.9` heuristic appeared in the reconciliation-to-PSC conversion route.** `src/app/api/reconciliation/[id]/convert-to-psc/route.ts:60` — "Default estimated 10% duty adjustment on correction," the exact anti-pattern class the plan called out to eliminate, in code that didn't exist at the prior audit. [F09-F10](F09-F10-audit.md)
9. **`dutyEngine.ts` fabricates a 25% Section 301 rate when a rate row exists but is unparsed**, instead of surfacing "not resolvable." `dutyEngine.ts:255-256` also silently defaults an unset tranche to `"List3"`. Same bug class as the old "2.8%" issue, narrower scope, not yet caught by a test. [F01](F01-audit.md)
10. **Refund-opportunity scanner assigns fixed confidence scores per type** (95/88/75/90/82, `refunds/opportunities/scan/route.ts`) rather than computing them from evidence strength — no dollar amount is fabricated, but the numbers imply false precision. [F01](F01-audit.md)
11. **`get_duty_exposure_risks` chat tool produces `NaN` for real data.** `tools.ts:1107` does `Number(hts.generalDutyRate ?? 0.05)` on a text field like `"5%"`, which evaluates to `NaN` — the codebase's own `parsePublishedDutyRate()` parser sits unused right next to it. Presented in a polished card as if real. [F13](F13-audit.md)

## Tier 2 — Regressions (got worse, not just still-unfixed)

12. **`hts-refresh` no longer writes any `HtsChange` rows.** The removal was correct (the old block fabricated fake change records), but it starves the now-correctly-fixed regulatory-impact rate-delta engine of real input — duty exposure will read `$0` for every regulatory update until real release-to-release diffing exists. [F09-F10](F09-F10-audit.md)
13. **F02/F03 self-reported completion inflation** — see the process note above. Treat prior in-session "83%/80% done" claims for these two features as unverified.

## Tier 3 — Large functional gaps still open

14. **F04 Capability G (autonomous workflow orchestration) is ~85% unimplemented.** `Shipment.currentStage` column exists but nothing ever writes it; no Inngest `shipment.stage.advance` function exists; no stage-stepper UI exists; no circuit breaker exists. Only the pure stage-definitions module is real, and it's dead code. [F04-F05](F04-F05-audit.md)
15. **Chat still can't be scoped to a shipment.** Session context (`shipmentId`/`clientId`/`documentId`), the context panel, and context persistence (F13 A-3/C-1/C-5) are all still entirely absent — central to the "second surface for the UI" framing. [F13](F13-audit.md)
16. **`AuditLog.source` is still never actually set to `"CHAT"`.** The column exists, the client sends the right header/body signal, but `decisions/route.ts:427` and `exceptions/[id]/route.ts:64` (94 call sites repo-wide) hardcode `source: "UI"` regardless. A chat-originated approval is still indistinguishable from a UI one in the audit trail. [F13](F13-audit.md)
17. **No PDF or ZIP generation exists anywhere in the codebase.** Blocks 7501 PDF export (F07-A5), the reasonable-care record PDF (F08-B3), and the focused-assessment ZIP+narrative (F08-D5/E3). One shared utility would close all three. [F06-F07-F08](F06-F07-F08-audit.md)
18. **CROSS ruling search is a plain substring match, not real similarity search.** `RulingService.searchRulings()` has no embedding call, no pgvector, no `tsvector` fallback, and returns no real `similarityScore` — the UI shows a write-time relevance score as if it were live search similarity. [F04-F05](F04-F05-audit.md)
19. **AuditLog coverage is still ~45% of write routes** (89 of 162 files have zero `createAuditLog` call). The fix so far patched the specifically-cited examples rather than doing the full sweep the task asked for; `products/[id]`, `shipments/[id]`, `parties/*` are the highest-value remaining targets. [F06-F07-F08](F06-F07-F08-audit.md)
20. **Section 301 / AD-CVD real rate architecture exists but is almost unseeded.** `prisma/seed.ts` seeds exactly one Section 301 row and one AD row, zero CVD rows — most real duty-stack computations still return `$0` for these layers today, now due to missing data rather than a hardcoded-zero code path. [F06-F07-F08](F06-F07-F08-audit.md)
21. **"Convert to PSC" is built but structurally unreachable.** The API/UI work correctly when invoked, but nothing ever creates a `ReconciliationIssue` with `issueType: "ENTRY_DISCREPANCY"` or `"PSC_CANDIDATE"` — every creation site omits `issueType`, so it defaults to `DOCUMENT_CONFLICT` and the feature is dead in practice. [F09-F10](F09-F10-audit.md)
22. **Webhook delivery only fires for 2 of 6 spec'd event types** (`decision.approved`, `filing.submitted`). `shipment.status_changed`, `exception.created`, `filing.accepted`, `classification.changed` have zero call sites — a customer subscribing to any of those four registers successfully and never receives anything. [F11-F12](F11-F12-audit.md)
23. **Permission sync isn't wired into account provisioning.** `syncPermissionCatalogue()` is real, idempotent, and tested, but only runs via a manual admin API call — `POST /api/platform-admin/accounts` creates a bare `OWNER` role with zero permissions attached unless someone remembers to hit the sync endpoint separately. [F11-F12](F11-F12-audit.md)
24. **Stage-gate policy config has a real backend and zero UI.** `policyType`/`requireHumanApproval`/`minimumReviewerRole` exist in the schema and are read by the approval engine, but `AgentPoliciesPanel.tsx` has no controls for any of the three fields — unreachable except via direct API call. [F11-F12](F11-F12-audit.md)
25. **Client-level (`clientId`) scoping for products/parties is still entirely unbuilt.** A broker with multiple `Client` sub-tenants still has full cross-client visibility into the shared product/party catalog. [F11-F12](F11-F12-audit.md)

## Tier 4 — Smaller and cosmetic gaps

- No true cross-tenant integration test against a real seeded DB anywhere (all tenant-isolation tests use mocks/fakes). [F01]
- OpenAPI coverage still ~3% of routes (7/223), zero `.describe()` on real route Zod schemas — this is named as the source of truth for chat tool definitions. [F01]
- 85 of 223 route files still return ad-hoc `NextResponse.json({error})` instead of the shared error envelope, concentrated in `v1/**`. [F01]
- 70 `: any`/`as any` occurrences repo-wide, no lint rule blocking new ones. [F01]
- Idempotency-Key support stuck at 8 of ~150 mutation routes. [F01, F04-F05, F09-F10]
- Upload hardening gaps: no `Content-Disposition` header, MIME/size rejection returns 400 not 422, no 20-file cap enforced. [F02-F03]
- `DocumentShipmentCandidate.confidenceScore` applied via `db push` only, not in any committed migration file. [F02-F03]
- `PdfCanvas`: no multi-highlight support, no zoom controls, no reverse click-to-select (bbox → field row). [F02-F03]
- Readiness-score bug: `shipmentReadiness.ts:145-147`'s `|| Boolean(li.htsCode)` disjunct means any line item with an HTS code counts as "approved" regardless of actual decision status. [F02-F03]
- Readiness score doesn't recompute on document detach, exception resolve, or decision approve/reject. [F02-F03]
- No "Request document" email action for missing-doc exceptions. [F02-F03]
- Classification rollback backend is ready; no UI entry point exists to trigger it. [F04-F05]
- Batch-classification progress page (`products/batch-classification/[batchId]`) was never built; bulk UI doesn't poll for completion. [F04-F05]
- "Select all matching part master" bulk-selection option still not implemented. [F04-F05]
- 15-minute filing-status polling job still missing (Inngest plumbing now exists, just not used for this yet). [F06-F07-F08]
- `DrawbackClaim.cbpClaimNumber` schema default is still a fake-looking literal (`"DBK-2026-9901"`). [F09-F10]
- Reconciliation management page has filters but no sort-by-exposure/deadline-proximity. [F09-F10]
- Leftover client-side arbitrary breakeven formula in the simulator coexists with the correct server-side one. [F09-F10]
- DPS screening route lives at `/api/demo/screening/dps`, not the spec'd `/api/screening/dps` (cosmetic; real logic is called directly from `partyService.ts`). [F11-F12]
- Party "relationship graph" is still a list/table, not a graph visualization. [F11-F12]
- One remaining ungated mutation route: `products/[id]/aliases/[aliasId]` DELETE has no `permission:` option. [F11-F12]
- Knowledge-base "similar past classifications" sidebar still not built. [F11-F12]
- Decision search (`GET /api/decisions?q=`) still doesn't search `ClassificationDecision.changeReason` or `GriAnalysisStep.reasoning`. [F11-F12]
- Chat: `GET /api/assistant/chats/[id]` (session detail) still doesn't exist; session titles still truncate to 50 not 60 chars; no Today/Yesterday/Last-7-days grouping. [F13]
- Chat: 4 tools still render nothing in the UI (`search_hts`, `search_rulings`, `get_regulatory_updates`, `export_compliance_record`); `create_scenario` and a real `upload_document` tool still don't exist as model-callable tools. [F13]
