# Qubere Billing, Costing, Invoicing & Profitability — Implementation Requirements

> Source of truth for [F14 · Billing, Costing, Invoicing & Profitability](../plans/features/F14-billing-costing-invoicing.md). Supplied by the account owner as a standalone spec, saved here verbatim so implementation work can cite section numbers without depending on chat history.

## 1. Objective

Build a complete billing, costing, invoicing, and profitability module for Qubere that allows a customs broker to:

- Upload or manually create customer rate cards.
- Map rate-card line items to Qubere APIs, capabilities, agents, functions, operational events, or outcomes.
- Define how each service is billed.
- Automatically track billable work as it occurs.
- Maintain a real-time financial ledger for every shipment.
- Calculate what the customer should be charged.
- Calculate the broker's internal cost of performing the work.
- Apply discounts, credits, waivers, surcharges, and adjustments.
- Generate invoices.
- Track unbilled, invoiced, outstanding, overdue, and paid amounts.
- Provide a complete audit trail.
- Report profitability at shipment, client, importer/account, broker/user, agent, service, and enterprise levels.
- Enforce billing-specific permissions and role-based access control.

The billing system must distinguish three separate financial layers:

1. Customs economics
2. Broker economics
3. Accounts receivable

These must never be conflated.

---

## 2. Core Financial Model

The core architecture should be:

Operational Event
→ Usage Event
→ Rate Rule
→ Cost Rule
→ Charge / Cost
→ Shipment Financial Ledger
→ Invoice
→ Payment / Accounts Receivable

The system must answer four independent questions:

1. What work occurred?
2. What did that work cost the broker?
3. What should the customer be charged?
4. Was the shipment, client, service, or account profitable?

Customer pricing and broker internal cost must be separate data models.

---

## 3. Core Terminology

### Brokerage Account
The customs broker or organization using Qubere. Example: ABC Customs Brokers

### Client
The brokerage's customer. Example: Acme Manufacturing

### Importer / Customer Account
A specific importer, business unit, subsidiary, or account belonging to a client.

### Shipment / Entry
The operational transaction against which costs, charges, duties, work, and revenue accumulate.

### Service
A commercially recognizable service the broker sells. Examples: Customs Entry, Additional Entry Line, HTS Classification, Human Classification Review, Document Processing, Reconciliation, PGA Processing, ISF Filing, ACE Filing, Exception Resolution, Duty Drawback, Post Summary Correction, Reconciliation Filing, Manual Review.

### Capability
A Qubere system function, agent, API, workflow, or operational capability. Examples: Document Intelligence, Product Normalization, HTS Classification, Origin Determination, Valuation, Compliance Review, Filing Readiness, ACE Submission, Exception Management.

### Usage Event
An immutable record that economically meaningful work occurred. Examples: 4 documents processed, 17 line items classified, 1 filing successfully completed, 2 exceptions manually resolved, 1 ACE transmission completed, 1 drawback claim prepared.

### Rate Rule
Defines how usage becomes a customer charge.

### Cost Rule
Defines how operational activity becomes an internal broker cost.

### Charge
The amount the broker intends to bill the customer.

### Cost
The amount incurred by the broker to perform the work.

### Invoice
A finalized grouping of customer charges for a billing period.

---

## 4. Billing Workspace

Create a top-level Billing workspace.

Suggested navigation:

Billing
├── Overview
├── Rate Cards
├── Usage
├── Shipments
├── Clients
├── Invoices
├── Reports
├── Exceptions
└── Settings

Access to Billing must be permission-controlled.

---

## 5. Billing Overview Dashboard

The Billing dashboard should show current financial metrics.

At minimum:

- Accrued charges
- Unbilled charges
- Draft invoice amount
- Approved invoice amount
- Outstanding receivables
- Overdue amount
- Paid amount
- Revenue this month
- Internal processing cost
- Gross profit
- Gross margin
- Number of shipments awaiting billing review
- Billing exceptions
- Revenue leakage alerts
- Negative-margin shipments

Allow filtering by: Date range, Client, Importer/account, Shipment, Entry type, Broker/user, Service, Agent, Invoice status.

---

## 6. Rate Card Management

Each brokerage must support one or more rate cards.

Rate cards must support: Brokerage default rate card, Client-specific rate card, Importer/account-specific rate card, Contract-specific rate card, Effective date, Expiration date, Currency, Minimum charges, Maximum charges, Negotiated overrides, Volume tiers, Bundled services, Discounts, Surcharges, Conditional pricing, Versioning, Draft/active/retired status.

Historical shipment charges must retain the exact rate-card version used at the time of calculation.

Changing a rate card must never retroactively change historical billing.

An activated rate card should become immutable.

Any commercial change creates a new version:

Rate Card v1 → Rate Card v2 → Rate Card v3

---

## 7. Rate Card Upload UI

Create: Billing → Rate Cards → Import Rate Card

Initial supported formats: XLSX, CSV. PDF extraction can be added later.

Upload workflow:

Upload file → Parse columns → Preview rows → Map source columns → Map commercial services → Map Qubere capabilities/events → Configure billing rules → Validate → User reviews → User approves → Create draft rate card → Activate rate card

The system must not automatically assume that a customer's wording maps directly to a Qubere capability.

Example uploaded rate card:

| Customer Description | Rate |
|---|---:|
| Entry Fee | $125 |
| Additional Line | $4 |
| HTS Classification | $12 |
| PGA Processing | $35 |

Qubere should allow the user to map each source line to a normalized service definition.

---

## 8. Manual Rate Card Builder

The broker must also be able to create a rate card without uploading a file.

Create: Billing → Rate Cards → Create Rate Card

Support: Add line item, Edit line item, Delete draft line item, Duplicate rate card, Duplicate from another client, Save draft, Preview, Validate, Activate, Retire, Create new version.

Each line item should include: Customer-facing description, Internal service name, Internal service code, Capability/event mappings, Billing basis, Rate, Currency, Unit, Minimum, Maximum, Discount, Surcharge, Conditions, Included quantity, Bundled capabilities, Effective dates, Billable yes/no.

---

## 9. Rate Card Line-Item Mapping UI

Create a dedicated mapping interface for each rate-card line item.

Example:

Customer Line Item: Additional HTS Classification
Qubere Capability: HTS Classification
Billing Event: HTS_CLASSIFICATION_COMPLETED
Billing Basis: Per Line
Rate: $4.00
Condition: Only charge after first 5 lines
Effective Date: 2026-01-01
End Date: Optional
Discount: Optional
Billable: Yes

The user must be able to search/select capabilities such as: Customs Entry Completed, Document Processed, HTS Classification, Human HTS Review, Product Normalization, Reconciliation, PGA Processing, Exception Resolution, ACE Filing, ISF Filing, Drawback Claim, PSC, Reconciliation Entry, Manual Review, Custom capability.

Support mapping: 1 commercial line item → 1 capability, or 1 commercial line item → many capabilities.

Example:

ENTRY PROCESSING — $125
├── document.processing
├── product.normalization
├── reconciliation
├── classification
├── filing.readiness
└── ace.filing

The customer may see a single $125 Entry Processing charge even though several internal Qubere functions occurred.

---

## 10. Stable Billing Event Architecture

Do not bind commercial billing directly to URL paths or HTTP endpoints. APIs and internal functions can change.

Instead use:

API / Function / Agent → Stable Billing Event Code → Rate Rule → Charge

Example:

POST /api/classification/classify emits HTS_CLASSIFICATION_COMPLETED

The rate card maps: HTS_CLASSIFICATION_COMPLETED → HTS Classification → $6/classification

The billing event code becomes the stable commercial contract between product functionality and billing.

---

## 11. Usage Event Ledger

Create an immutable UsageEvent ledger. Every relevant operation must be able to emit a UsageEvent.

Suggested fields: id, eventCode, occurredAt, accountId, clientId, importerId, shipmentId, entryId, userId, agentId, serviceCode, capabilityCode, operationCode, quantity, unit, sourceFunction, sourceApi, sourceAgent, success, outcome, retryIndicator, automated, manual, processingDuration, correlationId, idempotencyKey, metadata, createdAt.

Usage events must be append-only. Do not update or delete historical usage records to correct billing. Corrections must use reversal or adjustment records.

---

## 12. Idempotency and Duplicate Protection

Billable events must support idempotency. Retries must not accidentally create duplicate customer charges. Every event should contain an idempotency key.

The billing engine must guarantee: Same economic event → Same idempotency key → At most one billable event.

Technical retries can be recorded for observability without becoming duplicate charges.

---

## 13. Supported Billing Models

Each rate-card line item must support multiple pricing models: Per Transaction, Per Unit, Per Shipment, Per Entry, Per Document, Per API Event, Per Successful Outcome (retries/failed attempts should not generate additional charges unless configured), Flat Fee, Tiered, Time Based, Percentage Based, Minimum/Maximum, Bundled, Conditional (e.g. charge $20 only when AI confidence is below a threshold and a human reviews the classification).

---

## 14. Human Work Tracking

Billing must not be limited to APIs. Human work is a critical component of broker cost and customer billing.

Track activities such as: Manual document review, Exception resolution, Classification override, Manual HTS review, Filing correction, Customer communication, Supervisor approval, Post-entry work, Document correction, Compliance review.

Capture: User, Role, Shipment, Client, Activity, Start time, End time, Duration, Automated/manual, Reason for intervention, Outcome, Billable yes/no.

This supports both customer billing and internal labor costing.

---

## 15. Internal Cost Model

Broker internal cost must be calculated independently from customer pricing.

Supported costs should include:

**Technology Cost**: AI model usage, OCR, Document processing, External APIs, ACE connectivity, Storage, Communications, Third-party data providers.

**Labor Cost**: Allow authorized administrators to configure loaded hourly employee cost. Example: Broker loaded labor cost $72/hour; Manual exception handling 12 minutes; Internal labor cost $14.40.

**Third-Party Costs**: Filing network fees, Courier fees, Inspection fees, Outside classification services, Partner fees, Government service fees that are broker-borne.

Cost information should only be visible to users with explicit cost/margin permissions.

---

## 16. Shipment Financial Ledger

Every shipment must have a financial ledger. Create a Costs & Billing section inside the shipment/entry workspace.

The ledger must separate:

**Customer Charges** — e.g. Entry Processing $125, Additional Lines (7 × $4) $28, PGA Processing $35, Manual Review $20 → Total Revenue $208.

**Broker Costs** — e.g. AI/API $3.42, ACE/External $4.00, Broker Labor $18.25, Supervisor Review $6.75 → Operating Cost $32.42.

**Profitability** — Revenue $208.00, Internal Cost $32.42, Gross Profit $175.58, Gross Margin 84.4%.

**Customs / Pass-Through Economics** — Display separately: Merchandise value, Freight, Insurance, Entered value, Duty, Taxes, MPF, HMF, PGA fees, Other government charges, Customs bond related charges, Other pass-through amounts. Do not count duties or government charges as broker revenue unless explicitly configured as a broker markup or service charge.

---

## 17. Real-Time Billing Tracking

Billing must update as operational events occur. The billing engine should: Record the UsageEvent → Resolve the active rate card → Evaluate the applicable rule → Create a charge → Update the shipment financial ledger → Update client/account billing totals → Make the new amount visible immediately. No user should need to manually recalculate the shipment.

---

## 18. Amount Definitions

Do not use a single generic field called amountDue. Maintain separate concepts: Accrued Charges, Unbilled Amount, Draft Invoice Amount, Invoiced Amount, Outstanding Amount, Overdue Amount, Paid Amount.

---

## 19. Discounts, Credits, Waivers, Adjustments and Surcharges

Support: Rate Card Discount, Conditional Discount, Manual Discount (amount/percentage, reason, user, timestamp, approval status), Credits, Waivers, Promotional Rates, Volume Discounts, Surcharges (rush fee, after-hours fee, complex entry surcharge, manual intervention surcharge), One-Time Adjustments.

Every adjustment must remain visible in the audit trail. Never silently overwrite the original calculated charge.

---

## 20. Approval Rules for Adjustments

Allow configurable approval thresholds, e.g. Discount ≤5% → Billing User allowed; >5% and ≤10% → Billing Manager approval; >10% → Billing Admin approval. Similar thresholds for Credits, Waivers, Write-offs, Manual charge overrides, Invoice voids.

---

## 21. Billing Charge Lifecycle

Suggested charge states: Pending → Rated → Reviewed → Approved → Invoiced → Paid. Additional: Waived, Credited, Disputed, Written Off, Reversed, Voided.

Once invoiced, the original charge must be locked. Corrections must occur through adjustment, credit, reversal, or replacement records.

---

## 22. Invoice Management UI

Create: Billing → Invoices

Suggested invoice statuses: Draft → Pending Approval → Approved → Sent → Partially Paid → Paid. Additional: Overdue, Void, Disputed, Credited.

---

## 23. Invoice Generation Workflow

Create Invoice should support: Select Client, Select Importer/account, Select billing period, Select eligible shipments, Include all eligible unbilled charges, Exclude selected charges, Add manual invoice lines, Add discount, Add surcharge, Add credit, Add notes, Preview invoice, Submit for approval, Approve, Generate, Send, Export.

The user must be able to drill down: Invoice → Invoice Line → Shipment → Charge → Usage Event → Original Operational Event.

---

## 24. Invoice Output

Support: PDF, CSV, XLSX. Future integration targets: QuickBooks, NetSuite, Sage, SAP, Accounting APIs, Broker-specific accounting systems.

Support: Summary Invoice (aggregated service totals), Detailed Invoice (shipment-level detail), Fully Detailed Invoice (shipment + service + transaction-level detail).

---

## 25. Payments and Accounts Receivable

Support payment tracking. At minimum: Invoice total, Payment received, Payment date, Payment reference, Remaining balance, Partial payment, Paid status, Overdue status. Future: Payment processor integration, Automatic reconciliation, ERP/accounting sync.

---

## 26. Billing Auditability

Billing calculations must be fully reproducible. For every charge Qubere must be able to answer "Why is this amount $28?"

Example: Acme Rate Card v7 charges $4 for each entry line after the first five. Shipment SHP-2026-000001 contained 12 billable lines. 7 additional lines × $4 = $28.

Persist the relationship: Usage Event → Rate Card Version → Rate Rule → Calculation → Charge → Adjustment if any → Invoice Line.

Audit fields should include: Original value, New value, User, Role, Timestamp, Reason, Approval, Source, Rate-card version, Calculation inputs, Calculation result.

Audit records and billing usage records are separate concepts. Audit log = who changed something. Usage ledger = what economically meaningful work occurred.

---

## 27. Billing Exceptions

Create Billing Exceptions, e.g.: Activity occurred but no rate exists, Rate card expired, Capability not mapped, Duplicate usage event, Duplicate charge, Missing client, Missing shipment, Unmapped customer rate-card line, Negative-margin shipment, Charge below expected rate, Manual override requires approval, Unusually high charge, Unusually high internal cost, Service performed but not billed.

Provide: Billing → Exceptions, with Assign, Resolve, Ignore with reason, Escalate, Filter, Audit.

---

## 28. Revenue Leakage Detection

Automatically identify: Work performed but not billed, Charge generated below contract rate, Missing rate mappings, Expired rate cards, Duplicate discounts, Duplicate charges, Unbilled manual work, Services with zero rates, Shipments closed without billing completion, Negative-margin shipments, High-cost low-revenue customers.

---

## 29. Customer-Specific Billing Rules

Support conditions based on: Client, Importer, Entry type, Shipment type, Mode, Port, Country, HTS code, PGA, Merchandise value, Line count, Document count, Manual intervention, Exception type, Service, Outcome, Confidence threshold, User role, Time of day, Urgency, Volume, Contract.

---

## 30. Reporting

Create Billing & Profitability reporting. Support reporting by: Shipment, Entry, Client, Importer/account, Broker/user, Team, Agent, Service, Capability, Entry type, Port, Country, Date, Rate card, Invoice, Billing status.

---

## 31. Shipment Reporting

Show: Revenue, Cost, Profit, Margin, Billable activities, Human work, Automated work, Discounts, Government/pass-through amounts, Invoice status.

---

## 32. Client Reporting

Example: Acme Manufacturing — Entries 1,421; Revenue $218,400; Cost $71,200; Gross Profit $147,200; Margin 67%. Additional metrics: Average revenue per entry, Average cost per entry, Human-touch rate, Automation rate, Exception frequency, Average handling time, Discounts granted, Unbilled amount, Outstanding receivables, Overdue balance.

---

## 33. Broker/User Reporting

Measure: Shipments handled, Entries handled, Manual interventions, Hours, Internal labor cost, Revenue supported, Average handling time, Exception resolution time, Automation-assisted rate.

Do not design this only as employee productivity monitoring. Its primary use should be operational efficiency, workload visibility, automation opportunity, and costing.

---

## 34. AI Agent Reporting

Show agent economics, e.g.:

| Agent | Executions | Cost | Revenue Attributed | Human Escalation |
|---|---:|---:|---:|---:|
| Document Agent | 21,420 | $412 | $8,200 | 2% |
| Classification Agent | 8,221 | $741 | $17,810 | 8% |
| Compliance Agent | 6,201 | $328 | $11,400 | 4% |

Additional metrics: Cost per execution, Cost per successful outcome, Revenue attributed, Human escalation rate, Failure rate, Retry rate, Average processing time.

---

## 35. Profitability Analytics

The broker should be able to answer: Which clients are most profitable? Which clients generate the most revenue? Which customers generate the most manual work? Which shipment types have poor margins? Which customers produce the most exceptions? Which services are underpriced? Which users spend the most time on manual intervention? Which AI agents produce the most savings? What does an average entry cost? What does an average entry generate in revenue? What is the automation rate? What is the human-touch rate? How much labor has automation eliminated? Where is revenue leaking? Which rate cards should be renegotiated? Which services consistently lose money?

---

## 36. Rate Simulation

Allow the broker to test a proposed rate card against historical shipments without changing historical billing.

Example: Apply proposed Acme 2027 rate card to the previous 12 months. Output: Current Revenue $1.42M, Proposed Revenue $1.56M, Difference +$140K; Current Gross Margin 61%, Proposed Gross Margin 66%.

Allow comparison of: Current vs proposed rate card, Multiple proposed rate cards, Revenue impact, Margin impact, Client impact, Service impact.

---

## 37. Billing Permissions

Use granular permissions under predefined roles. Suggested default roles: Billing Admin, Billing Manager, Billing User, Billing Read Only. Roles should be bundles of permissions, not hard-coded application logic.

---

## 38. Billing Admin

Full billing control: upload/create rate cards, edit all billing configuration fields, map APIs/capabilities/events, define billing rules/rates/cost models, configure employee labor costs, configure discounts/surcharges, override charges, create credits/waivers, approve adjustments, create/approve/send/void invoices, view internal cost/profitability/margins, configure billing settings/integrations/permissions, view complete billing audit history.

Billing Admin can edit all active billing configuration. However, historical invoiced financial records must remain immutable. Admin corrections to invoiced history must use: Credit, Adjustment, Reversal, Replacement, Void/reissue workflow.

---

## 39. Billing Manager

Can: manage client rate cards, prepare rate-card changes, review billing, make permitted adjustments, approve adjustments within configured thresholds, create invoices, approve invoices if permitted, generate reports, see profitability, see costs if permitted.

Cannot by default: change platform-level billing event definitions, change billing permissions, modify system integrations, override immutable historical records.

---

## 40. Billing User

Can: view permitted billing data, review shipment charges, investigate usage, prepare invoices, add permitted manual adjustments, generate reports, export permitted data.

Cannot by default: activate rate cards, approve high-value discounts, approve invoices, configure cost models, configure permissions, view confidential internal margins unless explicitly granted.

---

## 41. Billing Read Only

Can: view permitted billing pages, invoices, reports, shipment billing, export permitted data.

Cannot: create, edit, approve, delete, adjust, send, void.

---

## 42. Granular Billing Permissions

Implement permission codes such as:

```
billing.view
billing.cost.view
billing.margin.view
billing.ratecard.view
billing.ratecard.create
billing.ratecard.upload
billing.ratecard.edit
billing.ratecard.activate
billing.ratecard.retire
billing.mapping.view
billing.mapping.edit
billing.usage.view
billing.charge.view
billing.charge.adjust
billing.charge.waive
billing.discount.create
billing.discount.approve
billing.credit.create
billing.credit.approve
billing.invoice.view
billing.invoice.create
billing.invoice.edit
billing.invoice.approve
billing.invoice.send
billing.invoice.void
billing.payment.view
billing.payment.record
billing.report.view
billing.report.export
billing.settings.manage
billing.permissions.manage
billing.audit.view
```

Roles should map to permission bundles. Allow future custom roles.

---

## 43. Sensitive Financial Visibility

Do not assume all billing users can see internal broker economics. Separate permission controls for: Customer charge, Internal technology cost, Employee labor cost, Gross profit, Gross margin, Client profitability.

Example: An account manager may see Customer Charge: $208, but may not see Internal Cost: $32.42, Gross Profit: $175.58, Gross Margin: 84.4%.

---

## 44. Core Data Model

Recommended entities: ServiceCatalogItem, BillingCapability, BillingEventDefinition, RateCard, RateCardVersion, RateRule, RateRuleCondition, RateRuleCapabilityMapping, CostProfile, CostRule, UsageEvent, ShipmentCharge, ShipmentCost, ChargeAdjustment, BillingException, Invoice, InvoiceLine, Payment, BillingPermission, BillingRole, BillingRolePermission.

Suggested relationships:

```
Account
└── Clients
    └── Importers
        └── Rate Cards

Shipment
├── Usage Events
├── Costs
├── Charges
├── Adjustments
└── Invoice Lines

Usage Event
└── Rate Rule
    └── Charge

Charge
└── Invoice Line
    └── Invoice
        └── Payment
```

---

## 45. Three Financial Layers

Every shipment must present three clearly separated layers.

**Customs Economics**: Merchandise Value, Freight, Insurance, Entered Value, Duty, Taxes, MPF, HMF, Government Fees, Other pass-through amounts.

**Broker Economics**: Customer Charges, Discounts, Surcharges, Broker Revenue, Labor Cost, Technology Cost, Third-Party Cost, Gross Profit, Gross Margin.

**Accounts Receivable**: Accrued, Unbilled, Draft Invoice, Invoiced, Paid, Outstanding, Overdue, Credits.

---

## 46. Critical Architecture Requirement

Do not calculate billing retrospectively by inspecting application tables and guessing what happened.

Bad pattern: "There are 12 AgentDecision records. Therefore bill 12 classifications."

Required pattern: Classification Agent → Classification Completed → Emit UsageEvent → Billing Engine → Resolve Rate Card → Evaluate Rate Rule → Create ShipmentCharge.

Billing telemetry must be a first-class platform primitive. Audit logging is not a substitute for usage metering.

---

## 47. Recalculation and Rate Changes

Before invoice: authorized users may rerun rating using the applicable rate-card version if data changed. After invoice: do not mutate historical invoice amounts — use Adjustment, Credit, Debit, Reversal, Replacement invoice. All recalculation activity must be audited.

---

## 48. Export Requirements

Allow exporting: Shipment billing details, Usage ledger, Client billing summary, Rate cards, Invoice detail, Profitability reports, Billing exceptions, Adjustments, Audit records. Formats: CSV, XLSX. Invoices additionally support PDF.

---

## 49. Search and Filtering

Billing screens should support searching and filtering by: Shipment number, Entry number, Client, Importer, Invoice number, Service, Rate card, User, Agent, Status, Date range, Amount, Margin, Exception type.

---

## 50. MVP Delivery Phases

**Phase 1 — Metering Foundation**: Service Catalog, Billing Capability catalog, Billing Event definitions, UsageEvent ledger, Shipment/Client/User/agent association, API/function/agent → billing-event mapping, Event idempotency, Auditability, Basic permissions.

**Phase 2 — Rate Cards and Shipment Economics**: Rate Card UI, XLSX/CSV upload, Manual Rate Card Builder, Line-item mapping UI, Rate-card versions, Per transaction/unit/outcome pricing, Flat shipment/entry pricing, Bundling, Customer charges, Internal costs, Shipment financial ledger, Real-time accumulated billing, Margin calculation.

**Phase 3 — Billing Operations**: Discounts, Credits, Waivers, Surcharges, Adjustment approval, Billing exceptions, Billing dashboard, Client/account summaries, Billing roles and granular permissions.

**Phase 4 — Invoicing**: Invoice generation, preview, approval, PDF generation, CSV/XLSX export, Invoice locking, Payment tracking, Outstanding/overdue balances.

**Phase 5 — Reporting and Intelligence**: Shipment/client/account/broker-user/agent/service profitability, Revenue leakage, Negative-margin alerts, Rate simulation, Pricing analytics, Automation ROI.

---

## 51. Acceptance Scenario

Broker configures Client "Acme" with Rate Card: Entry $125, First 5 lines included, Additional Lines $4/line, Human Classification Review $20, PGA Processing $35.

Shipment SHP-001 contains: 12 lines, 6 documents, 12 automated classifications, 1 human classification review, 1 PGA, 1 successful filing.

Customer charges: Entry Processing $125, 7 Additional Lines $28, Human Classification Review $20, PGA Processing $35 → Customer Charge $208.

Internal telemetry: AI/API Cost $3.42, External Filing Cost $4.00, Human Labor $18.25, Other Processing $6.75 → Broker Cost $32.42.

Revenue $208.00, Gross Profit $175.58, Gross Margin 84.4%.

If an authorized user applies a $10 discount: Original Charge $208, Discount -$10, Current Billable $198. The discount must store: User, Timestamp, Reason, Approval status, Original value, New value.

If not yet invoiced: Unbilled $198. Once on an invoice: Unbilled $0, Invoiced $198. If $100 is paid: Paid $100, Outstanding $98.

The user must be able to click any amount and trace: Invoice → Invoice Line → Shipment → Charge → Rate Rule → Rate Card Version → Usage Event → Original Operational Event.

---

## 52. Definition of Done

The billing module is functionally complete when:

1. A Billing Admin can upload or manually create a customer rate card.
2. The Admin can map every rate-card line item to Qubere capabilities or billing events.
3. The Admin can configure per-transaction, per-unit, flat, outcome-based, bundled, percentage, tiered, and conditional pricing.
4. Operational functions emit immutable usage events.
5. Usage events automatically create charges using the correct active rate card.
6. Shipment-level charges update in near real time.
7. Each shipment shows customer charges, internal costs, profit, margin, customs economics, and AR status separately.
8. Authorized users can create discounts, credits, waivers, surcharges, and adjustments.
9. All financial changes are fully auditable.
10. Billing permissions prevent unauthorized users from viewing or editing financial data.
11. Billing Admin can edit all active billing configuration.
12. Invoiced history cannot be silently modified.
13. Users can generate invoices from eligible unbilled charges.
14. Users can export invoices to PDF, CSV, and XLSX.
15. Payments, outstanding balances, and overdue balances can be tracked.
16. Users can report at shipment, client, importer/account, broker/user, service, and agent levels.
17. The system can identify revenue leakage and billing exceptions.
18. The system can explain exactly how every customer charge was calculated.

The defining principle of Qubere Billing should be: Every operational action is measurable. Every commercial charge is explainable. Every shipment has observable unit economics. Every invoice is traceable back to the work that created it.
