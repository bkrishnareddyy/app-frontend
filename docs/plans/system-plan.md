# Qubere System Plan
> Last updated: 2026-08-12

## 1. What We Are Building

Qubere is an enterprise trade compliance platform that automates the full lifecycle of a US customs import from document receipt through entry filing, with a persistent audit trail every Fortune 500 legal and compliance team can defend in a CBP audit. It replaces the spreadsheet-and-email workflow brokers and importers use today.

The platform has three audiences:
- **Licensed customs brokers** who manage entry preparation for clients
- **Importer compliance teams** who own the product master, HTS decisions, and audit record
- **Trade lawyers and auditors** who need defensible evidence chains for Focused Assessments and AD/CVD proceedings

Every action a user can take in the UI must also be available via the AI chat interface (structured tool calls backed by the same APIs).

---

## 2. Current Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| App framework | Next.js 16 App Router | Monorepo root is the web app |
| Language | TypeScript 5 | Strict mode |
| Database | PostgreSQL via Prisma 6 | 3,526-line schema, ~100 models |
| Auth | Clerk | Multi-tenant account switching, invitations |
| Storage | Vercel Blob | Documents, attachments |
| Background jobs | Inngest 4 | Document pipeline, cron, webhooks |
| AI | Google Gemini (@google/genai) | OCR, extraction, classification, screening |
| Email inbound | Resend + webhooks | Document ingestion via email |
| UI | React 19, Tailwind CSS 4 | Custom component library in packages/ui |
| Testing | Vitest (unit), Playwright (e2e) | Very sparse coverage today |
| Deployment | Vercel Hobby | Cron: max 2/day, 1 execution each |
| Packages | ai, auth, db, types, ui | Turbo monorepo |

---

## 3. Feature Inventory & Readiness

### Readiness Key
- **Production Foundation** — tenant-scoped, validated, tested, audit-logged
- **Prototype** — functional scaffolding, not enterprise-ready (fake data, float math, hardcoded values)
- **Stub** — route exists, returns synthetic data
- **Not Started** — no meaningful implementation

| # | Feature | Readiness | % Done | Critical Gaps |
|---|---|---|---|---|
| 1 | Multi-channel document intake | Prototype | 35% | Email route exists; S3 upload is public (no MIME/size/malware check); no API-ingest webhook for external systems; no batch-upload workflow |
| 2 | Automated document classification | Prototype | 30% | AI agent exists; classification is prototype-grade (writes to unstructured JSON); document type is guessed, not a closed enum; no confidence threshold for routing to human review |
| 3 | Structured data extraction | Prototype | 20% | AI pipeline discards bbox/page provenance (writes to `extractedJson` blob, not `ExtractionField` rows); field-level confidence not stored; no field-level human correction feedback loop |
| 4 | Source-linked evidence viewer | Stub | 10% | `ExtractionField` model has `bbox`/`pageNumber`; PDF rendered in `<iframe>` (no overlay possible); pipeline never writes bbox; nothing to highlight against today |
| 5 | Shipment document workspace | Prototype | 55% | UI panels exist; document-to-shipment attach/detach works; document status vocabulary drifts across components; no workspace-level completeness indicator visible to user |
| 6 | Canonical product master | Prototype | 60% | Full CRUD + bulk import UI; normalization route is prototype (regex stripping, hardcoded defaults); `ProductAlias` model exists; classification binding route exists |
| 7 | Product intelligence enrichment | Prototype | 35% | `ProductAttribute`, `ProductComposition`, `ProductCountryFact` models exist; UI tabs exist in product detail; no structured source tracing for enrichment values |
| 8 | Cross-document reconciliation | Stub | 15% | Route exists; uses synthetic rule `quantity % 100 !== 0`; no real field-level comparison logic across document types; `ReconciliationIssue` model is correct |
| 9 | Conflict detection | Stub | 15% | Bundled with reconciliation; no quantity/value/weight/origin comparison engine |
| 10 | Missing-document detection | Prototype | 30% | `requiredDocumentTypes.ts` enumerates expected docs; logic is checked in readiness engine; no per-entry-type required-doc ruleset; no UI indicator per missing type |
| 11 | Shipment readiness score | Prototype | 40% | `shipmentReadiness.ts` computes score; `Shipment.readinessScore` stored; `PreFilingReadiness` component shows blockers; score formula is static, not driven by account configuration |
| 12 | Dependency-aware reprocessing | Prototype | 25% | `reprocess` route exists; `PipelineJob` model tracks steps; no DAG-based dependency resolution; reprocessing is a full re-run, not targeted |
| 13 | Exception workbench | Prototype | 45% | `ExceptionItem` model, `ActionsClient.tsx` exists; decision status vocabulary drifts (4 independent parsers reading different string literals); priority ranking ignores deadline and dollar exposure |
| 14 | Exception assignment and resolution | Prototype | 40% | Assignment route and resolve route exist; structured resolution reason codes not implemented; `resolutionNote` is free text only; waive path is ungated |
| 15 | Autonomous workflow orchestration | Prototype | 30% | `agentOrchestrator.ts`, `PipelineJob`, `PipelineStepExecution` exist; Inngest wired; no configurable stage gate; no retry/backoff with circuit breaker; orchestrator is monolithic |
| 16 | Human approval controls | Prototype | 25% | `AgentDecision` model exists; auto-approve threshold is hardcoded per agent (magic numbers); auto-approved decisions are indistinguishable from human approvals; `reviewedByUserId` null on auto-approvals |
| 17 | Evidence-backed HTS proposals | Prototype | 40% | `ClassificationCase`, `ClassificationProposal`, `ProposalEvidence`, `GriAnalysisStep` in schema; `htsAgent` exists; ruling citation incomplete; no GRI step-by-step UI |
| 18 | GRI reasoning workspace | Stub | 15% | `GriAnalysisStep` model in schema; no dedicated UI; GRI reasoning buried in agent prose string |
| 19 | CROSS ruling retrieval | Prototype | 30% | `Ruling`, `RulingFragment`, `RulingHtsReference` models; `v1/rulings/search` API; ingest route exists; no similarity scoring against product facts |
| 20 | Bulk catalog classification | Prototype | 20% | `v1/batch/classification` API exists; no UI surface; no ambiguous-SKU routing to human review queue |
| 21 | Classification version history | Prototype | 35% | `ProductClassification` model with `effectiveDate`, `supersededById`; version history tab in product UI; no approval workflow with effective dates |
| 22 | Classification change impact | Stub | 15% | `v1/regulatory/impact-analysis` API; no shipment/entry/product enumeration from an HTS change |
| 23 | Origin determination | Prototype | 30% | `OriginDetermination` model; `advisory/origin-determination` API; auto-creates `TradeAgreement` on the fly; defaults RVC to 65%; no substantial transformation rules engine |
| 24 | Trade-agreement qualification | Prototype | 15% | `TradeAgreement` model; no qualification test logic; no missing-evidence identification |
| 25 | Customs valuation engine | Stub | 15% | `ValuationAssistsRecord` model; no assist computation; no related-party indicator check; no royalties/commissions reconciliation |
| 26 | Duty-stack calculation | Prototype | 25% | `HtsDutyRate`, `HtsDutyRateHistory` models; `dutyEngine.ts` exists; uses JavaScript floats; no Section 301/232/AD/CVD layer separation; no source version metadata |
| 27 | AD/CVD scope screening | Not Started | 5% | `ScreeningLog` model exists; no scope language matching; no PRC entity list check |
| 28 | Regulatory monitoring | Prototype | 35% | `RegulatoryUpdate` model; `regulatory` routes; no Federal Register ingestion; no automated alert creation |
| 29 | Product-level policy impact | Prototype | 20% | `regulatory/[id]/impacted` route; no duty exposure calculation on impact |
| 30 | Tariff scenario modeling | Prototype | 30% | `LandedCostScenario`, `LandedCostScenarioLineItem` models; simulator routes; float math; no versioned rate snapshot |
| 31 | Landed-cost simulation | Prototype | 25% | `simulator/scenarios/[id]/calculate` route; inline static MPF/HMF multipliers; no freight/insurance component model |
| 32 | Automated 7501 preparation | Stub | 20% | `filing/[id]/entry-summary` route; mock 7501 calculation; no field-to-source provenance mapping |
| 33 | Pre-filing validation | Prototype | 30% | `filing/[id]/validate` route; checks some required fields; no CBP format validation; no bond sufficiency check |
| 34 | Entry-line provenance | Prototype | 25% | `FilingSnapshot` model; no source-document linkage per entry line |
| 35 | Filing readiness gate | Prototype | 35% | `PreFilingReadiness` component; `shipmentReadiness.ts`; gate is not enforced server-side (transmit can proceed even when blockers exist) |
| 36 | ACE/ABI filing integration | Stub | 5% | `filing/[id]/transmit` uses `MockCustomsTransmissionProvider` only; no real ACE/ABI adapter; no acknowledgment parsing |
| 37 | Filing-status tracking | Prototype | 40% | `CustomsFiling` status enum (DRAFT→SUBMITTED→ACCEPTED→REJECTED→RELEASED→LIQUIDATED); status transition UI exists; no ACE status polling |
| 38 | Continuous compliance monitoring | Stub | 15% | `ComplianceAuditRecord` model; `compliance/audits/run` uses fixed 5-item checklist with hardcoded risk scores |
| 39 | Reasonable-care record | Prototype | 20% | `audit/package` route; generates basic package; no source citation per field; no versioned snapshot |
| 40 | Immutable audit trail | Prototype | 50% | `AuditLog` model; `audit.ts` writes events; raw invitation token leaked in audit metadata; some routes missing audit calls |
| 41 | Audit population analytics | Not Started | 5% | No analytics queries; no `WorkMetricSnapshot` model |
| 42 | Focused Assessment defense file | Stub | 10% | `audit/room/[filingId]` route; no document assembly; no control inventory |
| 43 | Duty-opportunity detection | Stub | 5% | `RefundOpportunity` model; `refunds/opportunities/scan` applies arbitrary 40%/15% factors; no real opportunity scoring |
| 44 | Drawback matching | Prototype | 20% | `DrawbackClaim`, `DrawbackMatch` models; `drawback/match` route; no inventory lot management; float math; no over-allocation prevention |
| 45 | Section 301 refund readiness | Stub | 5% | `RefundOpportunity` model can hold this; no entry population tracking; no evidence chain |
| 46 | PSC eligibility workflow | Stub | 10% | `PostSummaryCorrection` model; `refunds/psc` route; corrected-duty uses `origDuty * 0.7` heuristic |
| 47 | Reconciliation management | Prototype | 20% | `ReconciliationIssue` model; separate from PSC; no entry flagging; no deadline tracking |
| 48 | ERP and broker integration | Not Started | 0% | No adapters; no outbound webhooks; no CargoWise/SAP/Oracle mapping |
| 49 | Data lineage and synchronization | Prototype | 20% | `AuditLog` + `Fact` models; no lineage graph; no write-back tracking |
| 50 | Multi-tenant organization model | Production Foundation | 70% | `Account`, `AccountMembership` models; Clerk integration; account switcher; `dataMode` isolation; minor gap: soft-deleted members can still receive invitations |
| 51 | Role-based governance | Prototype | 55% | `Role`, `Permission`, `RolePermission` models; system roles + custom roles; many API routes check `getAccountContext()` without a specific permission; fine-grained permission guards missing on consequential endpoints |
| 52 | Decision policy configuration | Not Started | 10% | Confidence thresholds are hardcoded per agent; no account-level configuration model |
| 53 | Operational performance dashboard | Stub | 10% | `CommandCenterClient.tsx` exists; no real metrics computed; no `WorkMetricSnapshot` |
| 54 | Institutional knowledge retention | Prototype | 30% | Decisions and history persisted; no searchable knowledge base; no "why did we classify this way" query |
| 55 | Portable compliance record | Stub | 10% | `audit/package` route; no structured export format; no broker-independent access path |

---

## 4. Cross-Cutting Infrastructure Gaps

These affect every feature and must be resolved before domain features can be built on top of them:

### 4.1 Decision Status Vocabulary Drift (P0 blocker)
Four independent components read decision status with four different string sets. `/app/actions` currently shows the wrong rows — auto-approved decisions, not human-actionable ones. The fix is a single `decisionState.ts` normalizer and a `triageState` column on `AgentDecision`. Nothing downstream is trustworthy until this lands.

### 4.2 Auto-Approve Is Invisible (P0 blocker)
Agents write `status: confidence >= 70 ? "Approved" : "Needs Review"`. An auto-approved decision is indistinguishable from a human approval — `reviewedByUserId` is null, no audit log, no policy identifier. This directly violates reasonable-care requirements. Fix: `autoApproved Boolean`, `autoApprovalPolicy String`, and a non-human `AUTO_VERIFIED` state.

### 4.3 Float Math for Money (P0 blocker)
Duty, MPF, HMF, landed cost, and drawback calculations use JavaScript floats. This is legally inadmissible. Fix: `Decimal.js` throughout, `roundToCents()` helper.

### 4.4 GET Endpoints That Mutate (P0 security)
`GET /api/exceptions`, `GET /api/documents/[id]/extractions`, `GET /api/findings`, and `GET /api/hts` seed database rows when empty. Violates HTTP semantics, breaks read replicas, creates phantom data. Fix: Remove all seeding from GET handlers; move to seed scripts.

### 4.5 Missing Fine-Grained Permissions
Most routes check authentication but not specific permissions (e.g. `filings.submit`, `drawback.claim`, `classification.approve`). Fix: Extend `auth-guards.ts` with domain permission checks on every consequential endpoint.

### 4.6 ExtractionField Pipeline Disconnect
The AI pipeline writes bbox/page provenance through docling but discards it into `extractedJson` (unstructured blob). `ExtractionField` model exists with `bbox`, `pageNumber`, `confidence` — pipeline never writes to it. Fix: Persist `ExtractionField` rows from pipeline output. This unblocks source-linked evidence viewer completely.

### 4.7 PDF Viewer Cannot Support Overlays
`DocumentReviewPanel` uses `<iframe>` for PDF rendering. Browser-native PDFs cannot host React overlay layers. Fix: Replace with `pdf.js` canvas + absolutely-positioned highlight layer.

### 4.8 Token Leakage in Audit Log
`/api/admin/users` stores raw invitation token in `AuditLog.metadata`. Fix: Hash token before logging; exclude from metadata.

### 4.9 No Pagination on Collection Endpoints
`GET /api/shipments`, `GET /api/exceptions`, `GET /api/drawback/claims` return unbounded arrays. Fix: Cursor-based pagination on all list endpoints (schema: `limit`, `cursor`, `total`).

### 4.10 Chat Interface Requires Structured Tool API
Every UI action needs a corresponding API that accepts structured parameters and returns typed responses — not prose. Current advisory/query endpoint returns template strings. Fix: Define OpenAPI 3.1 spec; generate typed client; expose all domain operations as tool-callable endpoints.

---

## 5. Data Gaps (Capabilities That Need Real Data Sources)

| Capability | Current State | What's Needed |
|---|---|---|
| HTS tariff rates | `HtsNode`/`HtsDutyRate` models, cron refresh | Real USITC HTS feed; current import script exists (`prisma/import-hts.ts`) |
| CROSS rulings | `Ruling` model, ingest route | CBP CROSS API or bulk download pipeline |
| Federal Register | `RegulatoryUpdate` model | Federal Register API ingestion cron |
| AD/CVD orders | No model | Commerce ITAD scope orders dataset |
| ACE/ABI submission | Mock provider only | CBP ABI gateway credentials and CATAIR integration |
| Denied party lists | `DeniedPartyWatchlist` model, toy data | BIS Consolidated Screening List, OFAC SDN |
| ERP/TMS connectors | None | CargoWise, SAP GTS, Oracle GTM webhooks |
| CBP bond registry | Manual entry | CBP bond system or surety API |

---

## 6. Summary Readiness by Domain

| Domain | Avg Readiness | Blocker Count |
|---|---|---|
| Document Intelligence | 28% | 3 (pipeline persistence, PDF viewer, classification vocab) |
| Shipment Workspace | 30% | 2 (reconciliation engine, readiness gate server enforcement) |
| Actions & Workflow | 30% | 2 (decision vocabulary drift, auto-approve invisibility) |
| HTS Classification | 28% | 1 (GRI UI, ruling similarity scoring) |
| Origin & Valuation | 17% | 3 (no substantial transformation engine, float math, trade agreement logic) |
| Filing & Entry | 25% | 2 (7501 population, real ABI adapter) |
| Audit & Governance | 24% | 2 (token leak, missing population analytics) |
| Duty Recovery | 12% | 3 (float math, lot management, heuristic refund scanning) |
| Regulatory Intelligence | 27% | 1 (no Federal Register ingest) |
| Platform Foundation | 48% | 2 (fine-grained permissions, policy config) |
| Product & Party Master | 48% | 1 (normalization quality) |

**Overall platform readiness: ~28%**

The scaffolding is substantial — schema, routes, and UI shells exist for nearly every feature. The work ahead is replacing prototype logic with production-grade engines, fixing the infrastructure blockers, and building the experiences that are purely missing (AD/CVD, ACE/ABI, ERP integration, GRI workspace, audit analytics).
