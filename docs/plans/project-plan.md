# Qubere Project Plan
> Last updated: 2026-08-12

## How to Use This

Each file in `docs/plans/features/` is a self-contained brief for one agent working on one branch. Copy the file contents as the agent's prompt. The agent needs no other context — each file includes: what currently exists, what the gaps are, and a complete task list with file-level detail.

**Branches are independent unless a "Depends on" is listed.** F01 must land first (it fixes the infrastructure all other features build on). After F01 merges, all other features can run in parallel.

---

## Dependency Graph

```
F01 Backend Foundation   ← MUST SHIP FIRST
    │
    ├── F02 Document Intelligence
    │       └── F03 Shipment Workspace (needs ExtractionField from F02)
    │
    ├── F04 Actions & Workflow
    │
    ├── F05 HTS Classification
    │
    ├── F06 Origin, Valuation & Tariff
    │
    ├── F07 Filing & Entry (needs F03, F05, F06)
    │
    ├── F08 Audit & Governance (needs F07)
    │
    ├── F09 Duty Recovery (needs F06)
    │
    ├── F10 Regulatory & Tariff Intelligence (needs F05, F06)
    │
    ├── F11 Product & Party Master
    │
    └── F12 Platform Foundation

F13 Chat Interface ← Can start after F01 but gains value as other features ship

F15 Evals & AI Quality Intelligence ← Independent; reads AgentDecision/AgentExecutionRecord
    (already shipped by F01/F04/F05), does not block or get blocked by F02-F13
```

---

## Feature Files (Agent Prompts)

| File | Feature | Capabilities | Complexity | Parallel OK after F01? |
|---|---|---|---|---|
| [F01](features/F01-backend-foundation.md) | Backend Foundation | A-H | High | No — ships first |
| [F02](features/F02-document-intelligence.md) | Document Intelligence | A-E | High | Yes |
| [F03](features/F03-shipment-workspace.md) | Shipment Workspace | A-F | Medium | After F02-C |
| [F04](features/F04-actions-workflow.md) | Actions & Workflow | A-G | High | Yes |
| [F05](features/F05-hts-classification.md) | HTS Classification | A-F | High | Yes |
| [F06](features/F06-origin-valuation-tariff.md) | Origin, Valuation & Tariff | A-E | High | Yes |
| [F07](features/F07-filing-entry.md) | Filing & Entry | A-F | High | After F03, F05, F06 |
| [F08](features/F08-audit-governance.md) | Audit & Governance | A-E | Medium | After F07 |
| [F09](features/F09-duty-recovery.md) | Duty Recovery & Drawback | A-E | High | Yes |
| [F10](features/F10-regulatory-tariff-intelligence.md) | Regulatory & Tariff Intelligence | A-D | Medium | Yes |
| [F11](features/F11-product-party-master.md) | Product & Party Master | A-C | Medium | Yes |
| [F12](features/F12-platform-foundation.md) | Platform Foundation | A-F | Medium | Yes |
| [F13](features/F13-chat-interface.md) | Chat Interface | A-D | High | Yes |
| [F15](features/F15-evals-ai-quality-intelligence.md) | Evals & AI Quality Intelligence | Phase 0-1 | Medium | Yes — independent of F02-F13 |

---

## Wave Plan (Recommended Merge Order)

### Wave 0 (Start immediately — blocks everything)
- **F01** Backend Foundation

### Wave 1 (Start after F01 merges — all parallel)
- **F02** Document Intelligence
- **F04** Actions & Workflow
- **F05** HTS Classification
- **F06** Origin, Valuation & Tariff
- **F09** Duty Recovery & Drawback
- **F10** Regulatory & Tariff Intelligence
- **F11** Product & Party Master
- **F12** Platform Foundation
- **F15** Evals & AI Quality Intelligence (Phase 0 has no dependency on F01 at all — it only reads existing `AgentDecision`/`AgentExecutionRecord` data — but is listed here for planning purposes)

### Wave 2 (Start after Wave 1 features merge)
- **F03** Shipment Workspace (after F02)
- **F07** Filing & Entry (after F03, F05, F06)
- **F13** Chat Interface (can start early, gains value as wave 1 APIs stabilize)

### Wave 3 (After Wave 2)
- **F08** Audit & Governance (after F07)

---

## Data Gap Summary (Requires External Action)

These are not code tasks — they require procurement, legal agreements, or data ingestion from external sources. They block specific capabilities but not the entire feature.

| Data Source | Blocks | Action Required |
|---|---|---|
| CBP ABI/ACE credentials | F07 real ACE filing | Broker licensing + ABI gateway enrollment |
| CROSS rulings database | F05-C ruling retrieval | CBP CROSS API access or bulk download |
| Real denied party lists (BIS CSL, OFAC SDN) | F11-C party screening | API integration (both are free public APIs) |
| USMCA tariff shift rules (machine-readable) | F06-B trade agreement | Manual data entry from USMCA Annex 4-B |
| AD/CVD orders and rates | F06-E scope screening | Commerce ITAD data parsing |
| Section 301 rates (Lists 1-4B) | F06-D duty stack | Federal Register annexes parsing |
| ACE port codes | F07-B validation | CBP publishes a downloadable port code list |
| CargoWise / SAP GTS connectors | F12-F ERP integration | Partner agreements and sandbox access |
| Claude API key (Anthropic) | F13 chat interface | Add `ANTHROPIC_API_KEY` to env |
| pgvector extension on Postgres | F05-C ruling similarity | Confirm with Neon/Supabase; likely already available |

---

## Quality Standards for Every Agent

These apply to every task in every feature file:

1. **No fake data, ever.** If real data isn't available, show an honest empty state. Return `[]` or `null`, never a hardcoded placeholder.
2. **Money is always Decimal.js.** Never use `number` for duty, drawback, customs value, or any currency field. Use `roundToCents()` before serialization.
3. **Tenant isolation is non-negotiable.** Every Prisma query that reads or writes account-scoped data must include `where: { accountId: ctx.accountId }`. Write a cross-tenant test.
4. **Write at least one Vitest test per capability.** The test covers the core business rule, not just the happy path. Include the failure case.
5. **Every write goes to `AuditLog`.** Every POST/PATCH/DELETE that changes domain data must write an audit row with `action`, `entity`, `entityId`, `metadata` (diff), and `requestId`.
6. **OpenAPI descriptions on every route.** Every Zod schema used in a route handler must have `.describe()` annotations. This is the source of truth for the chat tool definitions.
7. **No `any` types.** TypeScript strict mode. No `@ts-ignore` without a comment explaining why.
8. **Pagination on all list endpoints.** Default limit 50, max 200, cursor-based.
9. **Idempotency on all mutation endpoints.** `POST` routes that create or modify shared state must support the `Idempotency-Key` header.
10. **Performance.** Index every `(accountId, X)` pair that is a query hot path. Never do `findMany` without a `where` clause.
