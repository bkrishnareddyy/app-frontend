# Shipment-to-Filing Workflow Analysis
# Qubere App-Frontend Codebase

## Executive Summary

This document provides comprehensive architectural analysis of the shipment-to-filing workflow in the Qubere app-frontend codebase, with detailed focus on filing configurations, state management, and canonical messaging architecture.

**Key Findings:**
- 23-state filing state machine with type-safe transitions
- 8 configuration tables enabling country-agnostic filing
- Event-sourced filing messages providing complete audit trail
- Canonical messaging system enabling zero-code country additions
- 8 mandatory readiness checks before filing creation

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Shipment-to-Filing Workflow](#shipment-to-filing-workflow)
3. [Filing Configuration Tables](#filing-configuration-tables)
4. [Filing State Machine](#filing-state-machine)
5. [Canonical Messaging System](#canonical-messaging-system)
6. [Filing Readiness Validation](#filing-readiness-validation)
7. [Form 7501 Generation](#form-7501-generation)
8. [API Endpoints](#api-endpoints)
9. [Key Technical Decisions](#key-technical-decisions)
10. [Recommended Enhancements](#recommended-enhancements)

---

## 1. Architecture Overview

### Technology Stack
- **Framework**: Next.js 16 (React 19, App Router)
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL via Supabase
- **ORM**: Prisma 6.19.3
- **Auth**: Clerk
- **AI/ML**: Claude 3.7, Google Gemini, IBM Docling
- **Financial**: Decimal.js (precise calculations)

### Core Architectural Patterns

#### Multi-Tenancy
- **Account Model**: Top-level tenant boundary
- **DataMode Isolation**: PRODUCTION / DEMO / SANDBOX data segregation
- **Automatic Filtering**: AsyncLocalStorage + Prisma middleware auto-injects dataMode

#### Dual RBAC
- **Platform Level**: User → PlatformRole → PlatformPermission
- **Account Level**: AccountMembership → AccountRole → AccountPermission
- **Just-in-Time Provisioning**: Users created from Clerk on first sign-in

#### Event Sourcing
- **FilingMessage**: Append-only audit trail for all filing state changes
- **Immutable Events**: Every status transition captured as message
- **Temporal Queries**: Reconstruct filing state at any point in time

---

## 2. Shipment-to-Filing Workflow

### Phase 1: Shipment Creation
1. User creates shipment with basic details
2. Uploads commercial invoice, packing list, BOL
3. AI document processing extracts structured data (IBM Docling)
4. ShipmentDocument records link files to shipment

### Phase 2: Filing Creation
1. User initiates "Create Filing" from shipment
2. System runs 8 mandatory readiness checks
3. If blocked: Returns error with specific issues
4. If ready: Creates CustomsFiling record in Draft status

### Phase 3: Duty Calculation & Form Generation
1. HTS codes determine duty rates
2. Decimal.js calculates: dutyAmount, mpfAmount, htsAmount
3. Form 7501 fields generated with provenance tracking
4. FilingSnapshot captures complete state

### Phase 4: State Progression
**Draft → Preparing → ReadyForBrokerReview → BrokerApproved → Transmitted**

- Draft: Initial creation
- Preparing: System preparing declaration
- ReadyForBrokerReview: Awaiting broker approval
- BrokerApproved: Cleared for transmission
- Transmitted: Sent to customs

### Phase 5: Customs Transmission
1. transmitFiling() called with filingId
2. Canonical message built from filing data
3. FilingMessage record created (action: SUBMIT)
4. Message published to queue
5. Third-party system transforms to country-specific format
6. Transmission to customs authority

### Phase 6: Response Processing
1. Inbound response received from customs
2. FilingResponseStatusMapping lookup determines transition
3. State machine validates and applies transition
4. FilingMessage created for response
5. UI notifications sent to user

---

## 3. Filing Configuration Tables

### 1. FilingProcedureMapping
**Purpose**: Map (entryType, country) → procedure code

**Example**:
\\\	ypescript
{
  countryCode: "US",
  entryType: "01", // Consumption Entry
  procedureCode: "C1"
}
\\\

### 2. FilingAuthorityConfig
**Purpose**: Define customs authority per country

**Example**:
\\\	ypescript
{
  countryCode: "US",
  authorityName: "U.S. Customs and Border Protection",
  systemLabel: "CBP"
}
\\\

### 3. FilingMessageCatalog
**Purpose**: Define available messages per action

**Wildcard Support**: country="*" for universal messages

**Example**:
\\\	ypescript
{
  messageName: "CUSTOMS_DECLARATION_SUBMIT",
  action: "SUBMIT",
  countryCode: "*", // All countries
  queueName: "customs-filing-outbound"
}
\\\

### 4. FilingResponseStatusMapping
**Purpose**: Map canonical response status → filing transition

**Example**:
\\\	ypescript
{
  countryCode: "*",
  canonicalStatus: "ACCEPTED",
  filingTransition: "customs.accept"
}
\\\

### 5. FilingActionRule
**Purpose**: Control whether filing can be updated after transmission

**Example**:
\\\	ypescript
{
  countryCode: "US",
  procedureCode: "C1",
  messageName: "CUSTOMS_DECLARATION_SUBMIT",
  messageStatus: "Transmitted",
  allowUpdates: false // US doesn't allow post-submission updates
}
\\\

### 6. FilingChildActionRule
**Purpose**: Determine available actions per filing status

**Example**:
\\\	ypescript
{
  filingStatus: "BrokerApproved",
  availableActions: ["TRANSMIT", "CANCEL", "EDIT"]
}
\\\

### 7. FilingMessageActionCatalog
**Purpose**: Master list of all possible actions

**Actions**: SUBMIT, AMENDMENT, CANCELLATION, RESUBMIT, STATUS_INQUIRY

### 8. FilingActionDataRequirement
**Purpose**: Country-specific extra data requirements

**Example**:
\\\	ypescript
{
  countryCode: "DE",
  action: "CANCELLATION",
  requiredFields: {
    guaranteeReference: "string"
  }
}
\\\

---

## 4. Filing State Machine

### 23 Filing States

**Initial States:**
- Draft
- Preparing
- ValidationFailed (blocked)

**Review States:**
- ReadyForBrokerReview
- BrokerApproved

**Transmission States:**
- TransmissionPending
- Transmitted

**Customs Processing:**
- Accepted
- Rejected
- DocumentsRequested
- CustomsHold
- PaymentDue

**Clearance:**
- Released
- PartiallyReleased

**Closure:**
- Closed (terminal)
- Cancelled (terminal)

**Special:**
- Simulation (practice mode, never progresses)

### Key Transitions

\\\	ypescript
const TRANSITIONS: Record<FilingTransition, TransitionRule> = {
  // Draft → Preparing
  "system.prepare": {
    from: ["Draft"],
    to: "Preparing"
  },
  
  // Preparing → Ready
  "system.ready": {
    from: ["Preparing"],
    to: "ReadyForBrokerReview"
  },
  
  // Ready → Approved
  "broker.approve": {
    from: ["ReadyForBrokerReview"],
    to: "BrokerApproved"
  },
  
  // Approved → Transmitted
  "system.transmit": {
    from: ["BrokerApproved", "TransmissionPending"],
    to: "Transmitted"
  },
  
  // Transmitted → Accepted
  "customs.accept": {
    from: ["Transmitted"],
    to: "Accepted"
  },
  
  // Accepted → Released
  "customs.release": {
    from: ["Accepted", "PaymentDue"],
    to: "Released"
  },
  
  // Released → Closed
  "system.close": {
    from: ["Released", "PartiallyReleased"],
    to: "Closed"
  },
  
  // Cancel transitions
  "cancel.request": {
    from: ["Draft", "Preparing", "ReadyForBrokerReview", "BrokerApproved", "Transmitted"],
    to: "CancellationRequested"
  },
  
  "cancel.complete": {
    from: ["CancellationRequested"],
    to: "Cancelled"
  }
}
\\\

### Illegal Transition Handling

\\\	ypescript
// Throws FilingTransitionError if invalid
applyTransition(currentStatus, transition)
\\\

---

## 5. Canonical Messaging System

### Message Structure

\\\	ypescript
interface CanonicalMessage<T> {
  metadata: {
    messageId: string
    filingId: string
    accountId: string
    action: FilingMessageAction
    countryCode: string
    timestamp: string
    correlationId?: string
  }
  payload: T
}
\\\

### CanonicalCustomsDeclaration Schema

\\\	ypescript
interface CanonicalCustomsDeclaration {
  // Header
  declarationNumber?: string
  declarationType: string // "IMPORT" | "EXPORT"
  procedureCode: string
  countryCode: string
  
  // Parties
  declarant: Party
  importer: Party
  exporter: Party
  broker?: Party
  
  // Transport
  transport: {
    modeOfTransport: string
    conveyanceReference: string
    arrivalDate: string
    portOfEntry: string
    portOfDischarge: string
  }
  
  // Line Items
  items: DeclarationItem[]
  
  // Totals
  totals: {
    totalDuty: Decimal
    totalTaxes: Decimal
    totalFees: Decimal
    totalValue: Decimal
  }
  
  // Documents
  supportingDocuments: Document[]
}
\\\

### Country-Agnostic Architecture

**Evidence**: Germany added with ZERO code changes

From docs/customs-filing-canonical-messaging-changelog.md:

\\\
## 2026-08-12: Germany Support Added

**Zero Code Changes Required**

1. Added FilingAuthorityConfig for DE
2. Added FilingProcedureMapping for DE entry types
3. Added FilingResponseStatusMapping for DE statuses
4. Configured message routing in FilingMessageCatalog

Result: Full Germany filing support operational without modifying application code.
\\\

---

## 6. Filing Readiness Validation

### 8 Mandatory Checks

\\\	ypescript
interface FilingReadinessResult {
  ready: boolean
  blockers: string[]
  checksPerformed: number
  checksPassed: number
  details: {
    hasLineItems: boolean
    hasValidHts: boolean
    hasCountryOfOrigin: boolean
    hasCommercialInvoice: boolean
    hasImporter: boolean
    hasEntryType: boolean
    noCriticalExceptions: boolean
    noCriticalReconciliation: boolean
  }
}
\\\

### Check Details

#### 1. At least one line item
- Filing must have shipmentItems with HTS codes

#### 2. 10-digit HTS codes
- **Current**: Hardcoded to 10 digits (US-specific)
- **Issue**: EU=8, China=10-13 digits
- **Recommendation**: Move to FilingHtsRequirement table

#### 3. Country of origin on every line
- Never inferred, must be explicit
- Prevents incorrect duty calculation

#### 4. Commercial invoice on file
- Required by 19 CFR 141.86
- Checked via ShipmentDocument.documentType

#### 5. Importer of record linked
- CustomsFiling.importerId must be set
- Links to Party model

#### 6. Entry type set
- CustomsFiling.entryType must be valid
- Determines duty calculation method

#### 7. No open critical/high exceptions
- Exception.severity = CRITICAL or HIGH
- Exception.status != RESOLVED

#### 8. No open critical reconciliation issues
- ReconciliationIssue.severity = CRITICAL
- ReconciliationIssue.status != RESOLVED

### Gaps & Missing Validations

**Not Currently Validated:**
- PGA requirements (FDA/USDA/EPA)
- Bond type per entry type (Type 23 TIB requires TIB bond)
- License/permit requirements
- Anti-dumping/CVD case presence
- HMF (Harbor Maintenance Fee) applicability

---

## 7. Form 7501 Generation

### Field Provenance Tracking

Every Form 7501 field carries complete audit trail:

\\\	ypescript
interface FieldProvenance {
  value: any
  sourceModel: string // "Shipment" | "ShipmentItem" | "Party"
  sourceId: string
  sourceField: string
  approvedBy?: string // userId
  approvedAt?: Date
}

interface Form7501FieldResult<T> {
  value: T
  status: "sourced_approved" | "sourced_unapproved" | "missing"
  provenance?: FieldProvenance
}
\\\

### Example Field Mapping

\\\	ypescript
{
  field: "importerOfRecord",
  value: "ACME Corp",
  status: "sourced_approved",
  provenance: {
    sourceModel: "Party",
    sourceId: "party_123",
    sourceField: "legalName",
    approvedBy: "user_456",
    approvedAt: "2026-08-15T10:30:00Z"
  }
}
\\\

### Decimal.js for Financial Precision

\\\	ypescript
// BAD: Floating point errors
0.1 + 0.2 // 0.30000000000000004

// GOOD: Decimal.js
new Decimal("0.1").plus("0.2") // Decimal("0.3")
\\\

**All financial fields use Decimal**:
- dutyAmount
- mpfAmount
- htsAmount
- totalValue
- unitPrice

---

## 8. API Endpoints

### Filing Operations

#### Create Filing
\\\
POST /api/filings
Body: { shipmentId, entryType, importerId }
Returns: { filingId, status: "Draft" }
\\\

#### Transmit Filing
\\\
POST /api/filings/:filingId/transmit
Returns: { filingId, status: "Transmitted", messageId }
\\\

#### Resubmit Filing
\\\
POST /api/filings/:filingId/resubmit
Body: { reason }
Returns: { filingId, messageId, priorMessageId }
\\\

#### Cancel Filing
\\\
POST /api/filings/:filingId/cancel
Body: { reason, extraData? }
Returns: { filingId, status: "CancellationRequested" }
\\\

### Configuration Management

#### List Configurations
\\\
GET /api/filing-config/:tableName
Returns: ConfigRecord[]
\\\

#### Create Configuration
\\\
POST /api/filing-config/:tableName
Body: { ...configFields }
Returns: ConfigRecord
\\\

---

## 9. Key Technical Decisions

### 1. DataMode Isolation via AsyncLocalStorage
**Decision**: Auto-inject dataMode filters at Prisma layer

**Rationale**:
- Prevents accidental PRODUCTION/DEMO data mixing
- No explicit filtering needed in application code
- Fail-safe: Missing context = error (no silent defaults)

\\\	ypescript
// Runs all queries with dataMode filter
runWithDataMode("PRODUCTION", async () => {
  // All Prisma queries auto-filtered to PRODUCTION
  const filings = await db.customsFiling.findMany()
})
\\\

### 2. Event Sourcing for Filing Messages
**Decision**: Append-only FilingMessage table

**Rationale**:
- Complete audit trail for compliance
- Temporal queries (state at any point in time)
- Event replay for debugging
- Immutability prevents tampering

### 3. Type-Safe State Machine
**Decision**: Explicit transition definitions with compile-time checks

**Rationale**:
- Illegal transitions caught at compile time
- Self-documenting state flow
- Prevents invalid state progression

### 4. Fail-Closed Configuration
**Decision**: Missing config = loud failure

**Rationale**:
- No silent defaults that could cause filing errors
- Forces explicit configuration per country
- Prevents accidental misconfiguration

### 5. Immutable FilingSnapshot
**Decision**: Capture complete filing state at transmission

**Rationale**:
- Preserves what was actually filed
- Shipment can be edited without affecting filed data
- Supports audit/legal requirements

### 6. Concurrency-Safe Shipment Numbering
**Decision**: ShipmentSequence table with atomic increment

**Rationale**:
- Prevents duplicate shipment numbers
- Race condition safe
- Supports high-concurrency environments

---

## 10. Recommended Enhancements

### HIGH Priority

#### 1. Add FilingHtsRequirement Table
**Current Issue**: HTS validation hardcoded to 10 digits (US-only)

**Solution**:
\\\	ypescript
model FilingHtsRequirement {
  id String @id @default(cuid())
  countryCode String
  minDigits Int
  maxDigits Int
  pattern String? // Regex for validation
  requireCheckDigit Boolean @default(false)
}
\\\

#### 2. Add FilingDocumentRequirement Table
**Current Issue**: Document requirements hardcoded

**Solution**:
\\\	ypescript
model FilingDocumentRequirement {
  id String @id @default(cuid())
  countryCode String
  entryType String
  documentType String // "COMMERCIAL_INVOICE" | "PACKING_LIST" | etc
  mandatory Boolean
  condition String? // JSON rule for conditional requirements
}
\\\

#### 3. Implement Transmission Provider Abstraction
**Current Issue**: Unclear how multiple providers integrated

**Solution**:
\\\	ypescript
interface TransmissionProvider {
  name: string
  transmit(message: CanonicalMessage): Promise<TransmissionResult>
  queryStatus(referenceId: string): Promise<StatusResult>
  cancel(referenceId: string): Promise<CancelResult>
}

// Providers: Descartes, Integration Point, ABI Direct
\\\

### MEDIUM Priority

#### 4. Add PGA Requirement Validation
**Issue**: FDA/USDA/EPA requirements not validated

**Solution**: Add PgaRequirement table with HTS-based triggers

#### 5. Add Bond Type Validation
**Issue**: Entry type 23 (TIB) requires TIB bond, not validated

**Solution**: Add BondRequirement table with entry type rules

#### 6. Expand Test Coverage
**Current**: Unknown coverage
**Target**: 80%+ coverage

**Focus Areas**:
- State machine transitions
- Filing readiness checks
- Canonical message transformation
- Configuration table lookups

### LOW Priority

#### 7. Add License/Permit Validation
**Issue**: licensesRequired field exists but not validated

#### 8. Add Anti-Dumping/CVD Case Detection
**Issue**: Cases not checked during duty calculation

#### 9. Add HMF Calculation Logic
**Issue**: Harbor Maintenance Fee not calculated

#### 10. Internationalize Date/Currency Formatting
**Issue**: US-centric formatting

---

## Conclusion

The Qubere app-frontend codebase demonstrates sophisticated architecture with:

✅ **Strong Points**:
- Type-safe state machine preventing invalid transitions
- Event-sourced filing messages providing complete audit trail
- Country-agnostic design enabling zero-code country additions
- DataMode isolation preventing data contamination
- Decimal.js ensuring financial calculation precision
- Comprehensive provenance tracking for compliance

⚠️ **Areas for Enhancement**:
- HTS validation needs country-specific configuration
- Document requirements should be data-driven
- PGA/bond/license validation gaps
- Test coverage should be increased
- Transmission provider abstraction needs clarification

**Overall Assessment**: Production-ready with identified enhancement opportunities for multi-country expansion.

---

*Document Generated: 2026-08-15*
*Analysis Scope: Shipment-to-Filing Workflow & Filing Configurations*
*Codebase: Qubere app-frontend (663 TypeScript files)*
