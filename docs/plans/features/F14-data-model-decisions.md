# F14 · Billing Data Model — Design Decisions

> This document records the architectural decisions made during F14 completion regarding two data model questions raised by the spec (`docs/requirements/billing-costing-invoicing-profitability.md`). Both decisions are **settled** — no follow-up schema work is required unless the concrete conditions noted below are met.

---

## Decision 1 — Human Work Tracking (§14): No separate `HumanWorkActivity` entity

### What the spec asked for

§14 proposes a dedicated `HumanWorkActivity` table to record broker review time, outcome, and a taxonomy reason for each manual intervention.

### Why we declined

The combination of `UsageEvent` and `ShipmentCost` already captures everything §14 requires:

| §14 field | Where it lives today |
|---|---|
| Which user did the work | `UsageEvent.userId` |
| Which shipment | `UsageEvent.shipmentId` |
| Which client | `UsageEvent.clientId` / `importerId` |
| When it happened | `UsageEvent.occurredAt` |
| Whether automated | `UsageEvent.automated = false` |
| Duration | `UsageEvent.processingDuration` (ms) |
| Labor cost | `ShipmentCost` row where `costType = "LABOR"`, linked by `usageEventId` |
| Duration for cost accounting | `ShipmentCost.durationSec` |
| Internal cost amount | `ShipmentCost.amount` |
| Outcome / success | `UsageEvent.success` |
| Arbitrary taxonomy | `UsageEvent.metadata` (JSON, extensible) |

Adding `HumanWorkActivity` would create a parallel source of truth for the same review event. The reconciliation problem between two tables tracking the same occurrence is worse than any benefit from a dedicated type.

### Current gaps and how to close them — without a new table

1. **No client-side review timer**: `processingDuration` is only populated when the UI sends it. Until `POST /api/decisions` accepts a client-supplied `processingDuration` from a real timer started at decision-detail open and stopped at submit (Phase 1 Task B-3), `HTS_MANUAL_REVIEW_COMPLETED` events carry `processingDuration: null` and the costing engine logs `UNTRACKED_LABOR_DURATION` `BillingException`s. This is the honest behavior — the exceptions are visible in `Billing → Exceptions` and tell the broker exactly what's missing.

2. **Taxonomy beyond success/failure**: If a future need arises for freeform reason codes ("reclassification due to PGA flag", "manual override because confidence < 70%") beyond what the boolean `success` flag captures, extend `UsageEvent.metadata` with a documented JSON schema shape (e.g. `{ reason: string; category: "OVERRIDE" | "LOW_CONFIDENCE" | "COMPLIANCE_FLAG" }`), not a new table. A migration adding a `reason` column to `UsageEvent` is also acceptable if query performance on the reason field becomes important.

### Verdict

No new `HumanWorkActivity` entity. Close the timer gap in `POST /api/decisions` when prioritized.

---

## Decision 2 — `ServiceCatalogItem` / `BillingCapability` as Separate Entities (§44): Declined

### What the spec asked for

§44 proposes two new tables: `ServiceCatalogItem` (a named catalog of billable services, independent of rate cards) and `BillingCapability` (a mapping layer between platform capabilities and commercial services, separate from `RateRule.serviceCode`).

### Why the existing model already covers this

The spec's intent is to separate:
- **What the platform does** (capabilities/events): handled by `BillingEventDefinition` — the event catalog seeded at startup via `seedBillingEventDefinitions`, carrying `eventCode`, `displayName`, `category`, `unit`, and `description`.
- **What the broker sells** (commercial services): handled by `RateRule.serviceCode` — a free-form string on each rate rule that names the commercial service being sold (e.g. `"HTS_CLASSIFICATION"`, `"DOCUMENT_INTAKE"`, `"COMPLIANCE_REVIEW"`).
- **The mapping between them**: `RateRuleCapabilityMapping` — each `RateRule` can map to one or more `BillingEventDefinition` event codes.

This three-layer model (`BillingEventDefinition` → `RateRuleCapabilityMapping` → `RateRule`) directly expresses the spec's intent without two additional tables. Every service that is sold has at least one rate rule; every capability that is billed has at least one mapping.

### The one case the current model cannot express

A service that is sold without any billing-event mapping at all — for example, a flat annual software license fee that isn't triggered by any specific usage event. The current model requires every billable line item to be a `RateRule` with at least a `pricingModel`. A `FLAT_FEE` rule with `ONCE_PER_SHIPMENT` semantics can approximate this, but a true "invoice this account $X/year regardless of activity" subscription line cannot be expressed as a usage-event-triggered charge.

**If this requirement becomes real**: add a `subscriptionLine` flag (or a new `pricingModel: "SUBSCRIPTION"`) to `RateRule`, and wire a monthly/annual Inngest step that emits a synthetic `UsageEvent` with `eventCode: "SUBSCRIPTION_FEE"` per account per billing period. This extends the existing model with one column and one cron step — no new entity.

### `ServiceCatalogItem` specifically

`ServiceCatalogItem` as a separate table is only useful if:
1. A service can exist in the catalog before any rate card references it (i.e., the catalog is the source of truth, rate cards reference it by foreign key).
2. Multiple rate cards need to share the same canonical service definition.

Neither is true today: `RateRule.serviceCode` is a string that rate card authors control, and the services referenced across rate cards are not normalized or constrained by a FK. If service naming consistency across cards becomes a real operational pain (broker teams using different strings for the same service in different cards), the right fix is a validation step in `createRateCardAction` / `addDraftRateRuleAction` that checks `serviceCode` against a known set — implemented as a seeded lookup table (`BillingServiceCode`) with a constraint, not a full `ServiceCatalogItem` entity with its own lifecycle.

### Verdict

No new `ServiceCatalogItem` or `BillingCapability` entities. The three-layer `BillingEventDefinition → RateRuleCapabilityMapping → RateRule` model covers the spec's intent. Revisit only if subscription billing or multi-card service-name normalization becomes a concrete requirement.

---

## Summary

| Spec entity | Decision | Condition to revisit |
|---|---|---|
| `HumanWorkActivity` | **Declined** — `UsageEvent` + `ShipmentCost` covers it | Client-side timer lands and §14 fields exceed what `metadata` JSON can express cleanly |
| `ServiceCatalogItem` | **Declined** — `RateRule.serviceCode` string covers it | Subscription billing or cross-card service-name normalization becomes a real requirement |
| `BillingCapability` | **Declined** — `RateRuleCapabilityMapping` covers it | Same as above |
