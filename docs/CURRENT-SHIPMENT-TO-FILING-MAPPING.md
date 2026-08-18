# Current Shipment to Filing Mapping

## Date: 2026-08-16

This document shows **exactly how** shipment data currently flows to the canonical declaration, with actual field mappings from the code.

---

## Mapping Flow Overview

```
┌─────────────────┐
│   Shipment      │  (Database: Shipment table + related tables)
│   + LineItems   │
│   + Documents   │
│   + Parties     │
└────────┬────────┘
         │
         │ Step 1: FilingService.buildSnapshotAndPublish()
         │ File: src/modules/filings/filing.service.ts (lines 295-333)
         ▼
┌─────────────────┐
│ FilingSnapshot  │  (Frozen point-in-time snapshot)
│ Data            │
└────────┬────────┘
         │
         │ Step 2: buildCanonicalDeclaration()
         │ File: src/lib/canonicalMessaging/declarationBuilder.ts (lines 43-89)
         ▼
┌─────────────────┐
│   Canonical     │  (Simple ~20 field structure)
│   Declaration   │
└────────┬────────┘
         │
         │ Step 3: Published to message queue
         │ File: src/lib/canonicalMessaging/publisher.ts
         ▼
┌─────────────────┐
│  Third-Party    │  (External customs filing service)
│  Filing Service │
└─────────────────┘
```

---

## Step 1: Shipment → FilingSnapshot

**File**: `src/modules/filings/filing.service.ts` (lines 295-333)

### Snapshot Structure

```typescript
const snapshotData: FilingSnapshotData = {
  shipment: {
    id: filing.shipment.id,
    shipmentNumber: filing.shipment.shipmentNumber,
    importerName: filing.shipment.importerName,
    portOfEntry: filing.shipment.portOfEntry,
    carrierName: filing.shipment.carrierName,
    incoterm: filing.shipment.incoterm,
    entryType: filing.shipment.entryType,
  },
  lineItems: filing.shipment.lineItems.map(item => ({
    id: item.id,
    lineNumber: item.lineNumber,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    totalValue: Number(item.totalValue),
    htsCode: item.htsCode,
    countryOfOrigin: item.countryOfOrigin,
  })),
  documents: filing.shipment.documents.map(doc => ({
    id: doc.id,
    fileName: doc.fileName,
    docType: doc.docType,
  })),
  filingHeader: {
    entryNumber: filing.entryNumber,
    entryType: filing.entryType || "01",
    totalValue: Number(filing.totalValue),
    totalDuties: Number(filing.totalDuties),
    totalTaxes: Number(filing.totalTaxes),
    totalAmount: Number(filing.totalAmount),
  },
  metadata: {
    generator: "Qubere Compliance Snapshot Engine",
    version: filing.version,
    timestamp: new Date().toISOString(),
  }
};
```

### Field Mappings (Shipment → Snapshot)

| Source (Shipment Table) | Target (Snapshot) | Type | Notes |
|------------------------|-------------------|------|-------|
| `shipment.id` | `shipment.id` | string | Shipment UUID |
| `shipment.shipmentNumber` | `shipment.shipmentNumber` | string | e.g., "SHP-2026-001" |
| `shipment.importerName` | `shipment.importerName` | string | Plain text name |
| `shipment.portOfEntry` | `shipment.portOfEntry` | string? | e.g., "USJFK" |
| `shipment.carrierName` | `shipment.carrierName` | string? | e.g., "FedEx" |
| `shipment.incoterm` | `shipment.incoterm` | string? | e.g., "DDP", "FOB" |
| `shipment.entryType` | `shipment.entryType` | string? | e.g., "01", "11" |
| `filing.entryNumber` | `filingHeader.entryNumber` | string | Generated entry # |
| `filing.entryType` | `filingHeader.entryType` | string | Default "01" |
| `filing.totalValue` | `filingHeader.totalValue` | number | Total commercial value |
| `filing.totalDuties` | `filingHeader.totalDuties` | number | Calculated duties |
| `filing.totalTaxes` | `filingHeader.totalTaxes` | number | Calculated taxes |
| `filing.totalAmount` | `filingHeader.totalAmount` | number | Grand total |
| `lineItem.id` | `lineItems[].id` | string | Line UUID |
| `lineItem.lineNumber` | `lineItems[].lineNumber` | number | e.g., 1, 2, 3 |
| `lineItem.description` | `lineItems[].description` | string | Product description |
| `lineItem.quantity` | `lineItems[].quantity` | number | Quantity value |
| `lineItem.unitPrice` | `lineItems[].unitPrice` | number | Price per unit |
| `lineItem.totalValue` | `lineItems[].totalValue` | number | qty × unitPrice |
| `lineItem.htsCode` | `lineItems[].htsCode` | string | e.g., "8471.30.0100" |
| `lineItem.countryOfOrigin` | `lineItems[].countryOfOrigin` | string | ISO country code |
| `document.id` | `documents[].id` | string | Document UUID |
| `document.fileName` | `documents[].fileName` | string | e.g., "invoice.pdf" |
| `document.docType` | `documents[].docType` | string | e.g., "INVOICE" |

### Parties Loaded Separately

Parties (importer, exporter, filer) are **NOT** in the snapshot - they're loaded directly in Step 2 from `ShipmentParty` table.

---

## Step 2: Snapshot → Canonical Declaration

**File**: `src/lib/canonicalMessaging/declarationBuilder.ts` (lines 43-89)

### Canonical Declaration Structure

```typescript
return {
  declarationId: params.filingId,
  entryType: snapshotData.filingHeader.entryType,
  importer,  // Loaded from ShipmentParty
  exporter,  // Loaded from ShipmentParty
  transport: {
    carrierName: snapshotData.shipment.carrierName ?? undefined,
    portOfEntry: snapshotData.shipment.portOfEntry ?? undefined,
  },
  incoterm: snapshotData.shipment.incoterm ?? undefined,
  lineItems,  // Transformed below
  valuation: {
    method: "Transaction Value (Method 1)",
    totalValue: tariff.totalCustomsValue,
  },
  totals: {
    customsValue: tariff.totalCustomsValue,
    dutyAmount: tariff.totalDuty,
    feesAmount: tariff.totalFees,
  },
  evidence: {
    sourceDocumentIds: snapshotData.documents.map((d) => d.id),
  },
};
```

### Field Mappings (Snapshot → Canonical)

| Source (Snapshot) | Target (Canonical) | Transformation | Notes |
|------------------|-------------------|----------------|-------|
| `params.filingId` | `declarationId` | Direct | Filing UUID |
| `filingHeader.entryType` | `entryType` | Direct | e.g., "01" |
| `ShipmentParty(IMPORTER_OF_RECORD)` | `importer` | Load from DB | `{ name, country, taxId }` |
| `ShipmentParty(EXPORTER)` | `exporter` | Load from DB | `{ name, country, taxId }` |
| `shipment.carrierName` | `transport.carrierName` | Direct (optional) | e.g., "FedEx" |
| `shipment.portOfEntry` | `transport.portOfEntry` | Direct (optional) | e.g., "USJFK" |
| `shipment.incoterm` | `incoterm` | Direct (optional) | e.g., "DDP" |
| `lineItems[].lineNumber` | `lineItems[].lineNumber` | Direct | Line sequence |
| `lineItems[].description` | `lineItems[].description` | Direct | Product description |
| `lineItems[].htsCode` | `lineItems[].hsCode6` | **Split** | First 6 digits only |
| `lineItems[].htsCode` | `lineItems[].nationalTariffSuffix` | **Split** | Remaining digits |
| `lineItems[].countryOfOrigin` | `lineItems[].originCountry` | Direct | ISO country |
| `lineItems[].quantity` | `lineItems[].quantity.value` | Wrap in object | Add `.uom: "PCS"` |
| `lineItems[].unitPrice` | `lineItems[].unitPrice` | Direct | Price per unit |
| `lineItems[].totalValue` | `lineItems[].totalValue` | Direct | Line total |
| `tariff.totalCustomsValue` | `valuation.totalValue` | From tariff engine | Calculated |
| `tariff.totalCustomsValue` | `totals.customsValue` | From tariff engine | Calculated |
| `tariff.totalDuty` | `totals.dutyAmount` | From tariff engine | Calculated |
| `tariff.totalFees` | `totals.feesAmount` | From tariff engine | Calculated |
| `documents[].id` | `evidence.sourceDocumentIds[]` | Array map | Document UUIDs |
| (hardcoded) | `valuation.method` | Constant | "Transaction Value (Method 1)" |

### Line Item Transformation

```typescript
const lineItems = snapshotData.lineItems.map((item) => {
  const { hsCode6, nationalTariffSuffix } = splitHsCode(item.htsCode);
  return {
    lineNumber: item.lineNumber,
    description: item.description,
    hsCode6,                    // e.g., "847130" (first 6 digits)
    nationalTariffSuffix,       // e.g., "0100" (remaining digits)
    originCountry: item.countryOfOrigin,
    quantity: { 
      value: item.quantity, 
      uom: "PCS"               // Hardcoded to "PCS"
    },
    unitPrice: item.unitPrice,
    totalValue: item.totalValue,
  };
});
```

### HTS Code Splitting Logic

```typescript
function splitHsCode(htsCode: string): { hsCode6: string; nationalTariffSuffix?: string } {
  const digits = htsCode.replace(/\D/g, "");  // Remove non-digits
  const hsCode6 = digits.slice(0, 6).padEnd(6, "0");  // First 6, pad if short
  const rest = digits.slice(6);  // Remaining
  return rest.length > 0 
    ? { hsCode6, nationalTariffSuffix: rest } 
    : { hsCode6 };
}
```

**Example**:
- Input: `"8471.30.0100"`
- Output: `{ hsCode6: "847130", nationalTariffSuffix: "0100" }`

---

## Step 3: Message Envelope

The canonical declaration is wrapped in a message envelope with header metadata:

**File**: `src/modules/filings/filing.service.ts` (line 378)

```typescript
const message = await FilingService.buildMessage(
  accountId, 
  filingId, 
  filing.authority || "Customs", 
  context,  // Contains country, procedure, messageName
  declaration,  // The canonical declaration from above
  priorMessageId
);
```

### Message Structure

```typescript
{
  header: {
    messageId: "uuid",
    filingId: "uuid",
    messageName: "IE501",  // From procedure config
    direction: "OUTBOUND",
    customer: { accountId, accountName },
    procedure: "H1",  // Procedure code
    country: "NL",  // ISO country code
    authority: "Dutch Customs",
    dateTime: "2026-08-16T20:00:00Z",
    schemaVersion: "1.0.0",
    senderSystem: "Qubere"
  },
  data: {
    declaration: {
      // ... canonical declaration from Step 2
    }
  }
}
```

---

## Current Field Count: **~20 fields**

### Fields Included:
1. `declarationId`
2. `entryType`
3. `importer.name`
4. `importer.country`
5. `importer.taxId`
6. `exporter.name`
7. `exporter.country`
8. `exporter.taxId`
9. `transport.carrierName`
10. `transport.portOfEntry`
11. `incoterm`
12. `lineItems[].lineNumber`
13. `lineItems[].description`
14. `lineItems[].hsCode6`
15. `lineItems[].nationalTariffSuffix`
16. `lineItems[].originCountry`
17. `lineItems[].quantity.value`
18. `lineItems[].unitPrice`
19. `lineItems[].totalValue`
20. `valuation.method`
21. `valuation.totalValue`
22. `totals.customsValue`
23. `totals.dutyAmount`
24. `totals.feesAmount`
25. `evidence.sourceDocumentIds`

---

## The Gap: Current vs. New Schema

### Current Canonical Declaration: ~25 fields
```
{
  declarationId, entryType,
  importer: { name, country, taxId },
  exporter: { name, country, taxId },
  transport: { carrierName, portOfEntry },
  incoterm,
  lineItems: [...],
  valuation: { method, totalValue },
  totals: { customsValue, dutyAmount, feesAmount },
  evidence: { sourceDocumentIds }
}
```

### New Import Schema: **200+ fields**
```
{
  ImportDeclaration: {
    GoodsDeclaration: {
      // Core fields
      DeclarationNumber, FunctionCode, TypeCode, GoodsItemQuantity,
      InvoiceAmount, InvoiceCurrency, Procedure, SubProcedure,
      
      // Parties (complex nested structure)
      Declarant: { Name, Address, ContactPerson, EORI, ... },
      Importer: { Name, Address, EORI, VATNumber, ... },
      Exporter: { ... },
      Representative: { ... },
      Consignor: { ... },
      Consignee: { ... },
      
      // Goods Shipment (deep nesting)
      GoodsShipment: {
        Consignment: {
          GoodsItem: [{
            SequenceNumber, Description, CommodityCode,
            GoodsMeasure: { GrossMass, NetNetWeight, SupplementaryUnits },
            InvoiceLineValue, StatisticalValue,
            Origin: { CountryOfOrigin, ... },
            ValuationAdjustment: { ... },
            Packaging: [ { Type, Quantity, ... } ],
            Documents: [ { Type, Reference, ... } ],
            AdditionalInformation: [ { Code, Text, ... } ],
            ...
          }],
          TransportEquipment: [ { ContainerNumber, ... } ],
          ArrivalTransportMeans: { ... },
          DepartureTransportMeans: { ... },
          ...
        }
      },
      
      // Response section
      Response: {
        status, authorityReference, humanMessage,
        MRN, AcceptanceDateTime,
        CustomsStatus, DeclarationStatus,
        RejectionDetail: [ ... ],
        ...
      },
      
      // Many more fields...
      Administration: { ... },
      BorderTransportMeans: { ... },
      Amendment: { ... },
      ...
    }
  }
}
```

---

## What's Missing

### Critical Fields Not Mapped:

**Declaration Metadata**:
- FunctionCode (9=Original, 13=Amendment)
- TypeCode / KindOfDeclaration
- MessageRole
- GoodsItemQuantity ✅ (Can calculate from lineItems.length)
- InvoiceAmount ✅ (Exists as totalValue)
- InvoiceCurrency ❌ (Not captured)
- Procedure / SubProcedure ✅ (Exists at message level, not in declaration)

**Extended Party Information**:
- EORI numbers ❌
- VAT numbers ❌
- Full addresses ❌
- Contact persons ❌
- Party roles (Declarant, Representative, Consignor, Consignee) ❌

**Extended Transport**:
- Transport mode ❌
- Vessel name ❌
- Voyage number ❌
- Departure/Arrival dates ❌
- Container numbers ❌
- Seal numbers ❌

**Extended Line Item Details**:
- GoodsMeasure (gross mass, net weight, supplementary units) ❌
- StatisticalValue ❌
- Packaging details ❌
- Line-item specific documents ❌
- AdditionalInformation codes ❌
- ValuationAdjustment details ❌
- Preference (GSP, FTA) ❌

**Valuation Extended**:
- Currency conversion ❌
- Valuation adjustments (freight, insurance, royalties) ❌
- Transaction nature code ❌

**Compliance**:
- Licenses and permits ❌
- Previous documents (if amendment) ❌
- Warehouse details ❌
- Guarantee information ❌

**Location Details**:
- Location of goods ❌
- Office of exit/entry codes ❌
- Customs office references ❌

---

## Why The Gap Matters

### For Outbound Messages (Request):
1. **Third-party services expect comprehensive schemas**
   - EU ICS2, Customs Declarations Service (CDS) require 100+ mandatory fields
   - Missing fields = rejected submissions

2. **Different countries need different fields**
   - EU: EORI, VAT, MRN tracking
   - India: GSTIN, IGST calculations
   - US: SSN/EIN, ACE manifest numbers

3. **Procedure-specific requirements**
   - Standard import (H1): Basic fields sufficient
   - Transit (T1): Additional transport/route fields
   - Customs warehousing: Warehouse authorization, storage location

### For Inbound Messages (Response):
1. **Current handling is basic**
   - Only checks `status` field
   - Missing: MRN extraction, detailed errors, assessment breakdowns

2. **New Response section has**:
   - Canonical status (for all countries)
   - Country-specific status codes
   - Detailed rejection reasons
   - Release information
   - Assessment breakdowns

---

## Solution: Comprehensive Field Mapping

**See**: `docs/ACTION-PLAN-SCHEMA-INTEGRATION.md` for complete implementation plan

### Phase 1: Core Mapping (Week 1)
Map 20 most critical fields from shipment to Import/Export schemas

### Phase 2: Default Values (Week 2)
Configure defaults for required schema fields without shipment equivalents

### Phase 3: Extended Mapping (Week 3-4)
Map remaining 180+ fields using configuration tables

### Phase 4: Response Processing (Week 5)
Parse and handle comprehensive response structures

---

## Comparison Table

| Aspect | Current (Canonical) | New (Import/Export Schemas) | Gap |
|--------|--------------------|-----------------------------|-----|
| **Total Fields** | ~25 fields | 200+ fields | 175+ missing |
| **Party Info** | Name, country, taxId | EORI, VAT, address, contact, roles | Missing 80% |
| **Transport** | Carrier, port | Mode, vessel, voyage, containers, seals | Missing 90% |
| **Line Items** | Basic (description, HS6, qty, value) | Extended (measures, packaging, docs, valuation adjustments) | Missing 70% |
| **Valuation** | Method, total | Currency, adjustments, transaction nature | Missing 60% |
| **Compliance** | None | Licenses, permits, preferences, warehouse | Missing 100% |
| **Response** | Simple status | Canonical + country-specific + detailed errors | Missing 95% |
| **Transaction Types** | Generic | Import/Export specific structures | No separation |

---

## Next Steps

1. ✅ **UI Config infrastructure ready** - Can configure any field from schema
2. ⏭ **Add transactionType to database** - Distinguish Import vs Export configs
3. ⏭ **Implement field mapping layer** - Bridge between shipment data and comprehensive schemas
4. ⏭ **Configure default values** - For required fields without shipment equivalents
5. ⏭ **Test with real country submissions** - Validate mappings work

**Estimated effort**: 4-5 weeks for full implementation across all phases

---

## Conclusion

**Current state**: Simple, US-centric canonical format suitable for basic submissions

**New requirement**: Comprehensive, country-specific schemas for professional multi-country operations

**Status**: ✅ UI infrastructure ready, ⚠️ Data mapping layer needed

The gap is significant but manageable with the phased approach outlined in `ACTION-PLAN-SCHEMA-INTEGRATION.md`.
