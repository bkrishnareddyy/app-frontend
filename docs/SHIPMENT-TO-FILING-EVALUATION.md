# System Evaluation: Shipment → Filing Flow with New Schema Structure

## Current Analysis Date: 2026-08-16

## Executive Summary

The system currently uses a **simplified canonical declaration format** in code (TypeScript types) that maps shipment data to a generic structure. However, the **new JSON schemas** (Import/Export) are far more comprehensive and country-specific. There's a **significant mismatch** that needs to be addressed.

---

## 1. Schema Structure Overview

### A. Header Schema (`envelope-header/Header.json`)
```json
{
  "messageId": "unique-message-id",
  "filingId": "filing-reference",
  "messageName": "IE501", 
  "direction": "OUTBOUND|INBOUND",
  "customer": { "accountId": "...", "accountName": "..." },
  "procedure": "H1",
  "country": "NL",
  "authority": "Dutch Customs",
  "dateTime": "2026-08-16T20:00:00Z",
  "schemaVersion": "1.0.0",
  "senderSystem": "Qubere"
}
```

**Purpose**: Envelope for all filing messages (request/response)

### B. Import Declaration Schema (`filing-schemas/import/1.0.0/ImportDeclaration.schema.json`)
**Root Structure**:
```json
{
  "ImportDeclaration": {
    "GoodsDeclaration": {
      // 150+ fields including:
      - "DeclarationNumber"
      - "Procedure", "SubProcedure"
      - "MRN", "TemporaryMRN"
      - "InvoiceAmount", "InvoiceCurrency"
      - "GoodsItemQuantity"
      - "Parties" (Declarant, Importer, Exporter, etc.)
      - "GoodsShipment" (lineItems)
      - "Response" section (with canonical fields + country-specific)
    }
  }
}
```

**Size**: 548.5 KB (extremely comprehensive)

### C. Export Declaration Schema (`filing-schemas/export/1.0.0/ExportDeclaration.schema.json`)
Similar structure but for exports

---

## 2. Current System Flow Analysis

### A. Shipment → Filing Creation

**Current Code Path**:
```
1. Shipment data → FilingService.transmitFiling()
2. FilingService → builds FilingSnapshotData (simplified)
3. FilingSnapshotData → buildCanonicalDeclaration()
4. Canonical Declaration → Published to message queue
```

**FilingSnapshotData Structure** (current):
```typescript
{
  shipment: {
    id, shipmentNumber, importerName, portOfEntry,
    carrierName, incoterm, entryType
  },
  lineItems: [{
    id, lineNumber, description, quantity,
    unitPrice, totalValue, htsCode, countryOfOrigin
  }],
  documents: [{ id, fileName, docType }],
  filingHeader: {
    entryNumber, entryType, totalValue,
    totalDuties, totalTaxes, totalAmount
  }
}
```

**CanonicalCustomsDeclaration** (current):
```typescript
{
  declarationId, entryType,
  importer?: { name, country, taxId },
  exporter?: { name, country, taxId },
  filer?: { name, country, taxId },
  transport?: { mode, carrierName, vessel, portOfEntry, arrivalDate },
  currency?, incoterm?,
  lineItems: [{ lineNumber, description, hsCode6, nationalTariffSuffix,
                originCountry, quantity, unitPrice, totalValue }],
  valuation?: { method, totalValue, adjustments },
  totals: { customsValue, dutyAmount, feesAmount },
  compliance?: { screeningCleared, licensesRequired, complianceFlags },
  evidence?: { sourceDocumentIds }
}
```

### B. The Problem

**Current canonical format has ~20 fields**
**New Import schema has ~200+ fields**

**Gap**:
- No mapping for country-specific fields (ProcedureType, Administration, etc.)
- No support for complex nested structures (Parties arrays, GoodsShipment hierarchy)
- No Response section handling
- No transaction-type awareness (Import vs Export)

---

## 3. Required Changes

### A. Update Canonical Types

**File**: `src/lib/canonicalMessaging/types.ts`

**Current**: Simple CanonicalCustomsDeclaration
**Needed**: Support for Import/Export specific structures

**Approach Options**:

**Option 1: Extend Current Structure** (Incremental)
```typescript
export interface CanonicalCustomsDeclaration {
  // Keep existing fields for backward compatibility
  declarationId: string;
  entryType: string;
  importer?: CanonicalParty;
  // ... existing fields

  // Add new comprehensive structure
  importDeclaration?: ImportDeclaration;  // For import filings
  exportDeclaration?: ExportDeclaration;  // For export filings
  
  // Extensions for unmapped fields
  extensions?: Record<string, unknown>;
}
```

**Option 2: Replace with Full Schema** (Breaking)
```typescript
export type CanonicalCustomsDeclaration = 
  | { type: "import"; data: ImportDeclaration }
  | { type: "export"; data: ExportDeclaration };
```

**Recommendation**: **Option 1** - Extend gradually to avoid breaking existing code

### B. Update Declaration Builder

**File**: `src/lib/canonicalMessaging/declarationBuilder.ts`

**Current Logic**:
```typescript
buildCanonicalDeclaration(params) {
  // Maps only basic fields from snapshot
  return { declarationId, entryType, importer, exporter, ... };
}
```

**Required Logic**:
```typescript
buildCanonicalDeclaration(params) {
  const { transactionType, schemaVersion } = params;
  
  if (transactionType === "import") {
    return buildImportDeclaration(params);
  } else if (transactionType === "export") {
    return buildExportDeclaration(params);
  }
}

function buildImportDeclaration(params) {
  return {
    ImportDeclaration: {
      GoodsDeclaration: {
        // Map shipment fields to schema structure
        DeclarationNumber: params.entryNumber,
        Procedure: params.procedure,
        InvoiceAmount: params.totalValue, // converted to USD by ExchangeRateService before this point -- see src/modules/fx/exchangeRateService.ts
        InvoiceCurrency: params.currency || "USD",
        GoodsItemQuantity: params.lineItems.length,
        
        // Parties
        Declarant: mapParty(params.declarant),
        Importer: mapParty(params.importer),
        Exporter: mapParty(params.exporter),
        
        // Goods Shipment (line items)
        GoodsShipment: {
          Consignment: {
            GoodsItem: params.lineItems.map(mapLineItem)
          }
        },
        
        // Response section (empty for outbound)
        Response: {}
      }
    }
  };
}
```

### C. Update UI Config Schema Path

**Current Issue**: UI Config Editor loads schema per transaction type but needs to handle the deep nesting

**File**: `src/app/app/filing-config/UIConfigEditor.tsx`
**Current**: Loads schema, displays tree
**Required**: Handle ImportDeclaration wrapper level

**Schema Tree Path**:
```
ImportDeclaration
  └── GoodsDeclaration
        ├── DeclarationNumber
        ├── Procedure
        ├── Parties
        │     ├── Declarant
        │     ├── Importer
        │     └── Exporter
        ├── GoodsShipment
        │     └── Consignment
        │           └── GoodsItem (array)
        └── Response
```

**UI Config Field Paths**:
```
"ImportDeclaration.GoodsDeclaration.DeclarationNumber"
"ImportDeclaration.GoodsDeclaration.Procedure"
"ImportDeclaration.GoodsDeclaration.Parties.Importer.Name"
"ImportDeclaration.GoodsDeclaration.GoodsShipment.Consignment.GoodsItem[].ItemNumber"
```

### D. Update FilingUIConfig Table

**Current Schema** (database):
```prisma
model FilingUIConfig {
  fieldPath String  // e.g., "importer.name"
  // ...
}
```

**Required**: No changes needed - fieldPath can handle dot notation and arrays

**Example Configs**:
```json
[
  {
    "fieldPath": "ImportDeclaration.GoodsDeclaration.DeclarationNumber",
    "fieldLabel": "Declaration Number",
    "fieldType": "text",
    "section": "header"
  },
  {
    "fieldPath": "ImportDeclaration.GoodsDeclaration.GoodsShipment.Consignment.GoodsItem[].Description",
    "fieldLabel": "Item Description",
    "fieldType": "textarea",
    "section": "lineItems"
  }
]
```

---

## 4. Data Mapping Strategy

### A. Core Mapping Rules

**Shipment Field → Import Schema Field**:
```
shipment.entryType         → ImportDeclaration.GoodsDeclaration.Procedure
shipment.shipmentNumber    → ImportDeclaration.GoodsDeclaration.DeclarationNumber
shipment.importerName      → ImportDeclaration.GoodsDeclaration.Parties.Importer.Name
shipment.portOfEntry       → ImportDeclaration.GoodsDeclaration.GoodsShipment.Consignment.ArrivalTransportMeans.LocationOfGoods
shipment.carrierName       → ImportDeclaration.GoodsDeclaration.GoodsShipment.Consignment.CarrierName
shipment.incoterm          → ImportDeclaration.GoodsDeclaration.GoodsShipment.Consignment.DeliveryTerms.Code
shipment.totalValue        → ImportDeclaration.GoodsDeclaration.InvoiceAmount (already USD -- converted from invoiceCurrency by ExchangeRateService)
shipment.invoiceCurrency   → ImportDeclaration.GoodsDeclaration.InvoiceCurrency
lineItems.length           → ImportDeclaration.GoodsDeclaration.GoodsItemQuantity
```

**Line Item Mapping**:
```
lineItem.lineNumber        → GoodsItem.SequenceNumber
lineItem.description       → GoodsItem.Description
lineItem.htsCode           → GoodsItem.Commodity.CommodityCode
lineItem.quantity          → GoodsItem.GoodsMeasure.GrossMass / NetNetWeight
lineItem.unitPrice         → GoodsItem.InvoiceLineValue / Quantity
lineItem.totalValue        → GoodsItem.InvoiceLineValue
lineItem.countryOfOrigin   → GoodsItem.Origin.CountryOfOrigin
```

### B. Default Values for Required Fields

Many schema fields are required but don't have shipment equivalents:

```typescript
const defaults = {
  FunctionCode: "9",  // Original declaration
  KindOfDeclaration: "IM",  // Import
  MessageRole: "EDI",
  DeclarantStatus: "2",  // Representative
  // ... many more
};
```

**Strategy**: Create a configuration table for default values per country/procedure

### C. Extension Fields

For unmapped shipment data:
```typescript
{
  ImportDeclaration: {
    GoodsDeclaration: {
      // ... mapped fields ...
      InternalData: {
        // Extension bucket for Qubere-specific data
        qubereShipmentId: "...",
        qubereFilingId: "...",
        originalEntryType: "01",
        // ... other unmapped fields
      }
    }
  }
}
```

---

## 5. Response Handling

### A. Inbound Message Processing

**Current**: Response messages update Filing.status based on ResponseStatusMapping
**Required**: Parse comprehensive Response section from Import/Export schema

**Response Section Structure** (after our changes):
```json
{
  "Response": {
    // === CANONICAL FIELDS (our additions) ===
    "status": "ACCEPTED",
    "authorityReference": "NL-2026-123456",
    "humanMessage": "Declaration accepted",
    "rawResponsePayload": { ... },
    
    // === COUNTRY-SPECIFIC FIELDS ===
    "CustomsStatus": "01",
    "DeclarationStatus": "Accepted",
    "MRN": "26NL0000001234567890",
    "AcceptanceDateTime": "2026-08-16T20:00:00Z",
    "RejectionDetail": [],
    // ... many more fields
  }
}
```

**Mapping Logic**:
```typescript
function processInboundResponse(message) {
  const response = message.data.ImportDeclaration.GoodsDeclaration.Response;
  
  // 1. Use canonical status
  const canonicalStatus = response.status;
  
  // 2. Extract authority reference (MRN, Entry Number, etc.)
  const authorityRef = response.authorityReference || response.MRN;
  
  // 3. Display human message
  const displayMessage = response.humanMessage || response.DeclarationStatus;
  
  // 4. Store complete raw response
  const rawResponse = response.rawResponsePayload;
  
  // 5. Update Filing record
  await db.customsFiling.update({
    where: { id: message.header.filingId },
    data: {
      status: mapCanonicalStatusToFilingStatus(canonicalStatus),
      authorityReference: authorityRef,
      responseMessage: displayMessage,
      responseData: rawResponse
    }
  });
}
```

---

## 6. Implementation Plan

### Phase 1: Schema Integration (Week 1)
- [ ] Create ImportDeclaration and ExportDeclaration TypeScript types from schemas
- [ ] Update CanonicalCustomsDeclaration to include new types (Option 1 approach)
- [ ] Update declarationBuilder.ts to support transaction-type routing

### Phase 2: Mapping Implementation (Week 2)
- [ ] Create comprehensive field mapping configuration table
- [ ] Implement buildImportDeclaration() function
- [ ] Implement buildExportDeclaration() function
- [ ] Add default value configuration per country/procedure
- [ ] Add extension field handling for unmapped data

### Phase 3: UI Config Updates (Week 3)
- [ ] Update SchemaTreeViewer to handle deep nesting (ImportDeclaration.GoodsDeclaration.*)
- [ ] Update FieldConfigPanel to support nested paths
- [ ] Seed UI configs for Import Declaration fields
- [ ] Seed UI configs for Export Declaration fields
- [ ] Test field configuration and save functionality

### Phase 4: Response Processing (Week 4)
- [ ] Update inbound message consumer to parse Response section
- [ ] Implement canonical status → FilingStatus mapping
- [ ] Add authority reference extraction
- [ ] Add human message display in UI
- [ ] Store complete raw response for audit

### Phase 5: Testing & Validation (Week 5)
- [ ] Test shipment → Import filing flow
- [ ] Test shipment → Export filing flow
- [ ] Validate field mappings against country requirements
- [ ] Test UI configuration with real schemas
- [ ] End-to-end integration testing

---

## 7. Risks & Mitigation

### Risk 1: Breaking Changes
**Impact**: Existing filings may fail
**Mitigation**: Keep old canonical format, add new format alongside
**Strategy**: Use schemaVersion to determine which format to use

### Risk 2: Incomplete Mapping
**Impact**: Required schema fields not populated
**Mitigation**: Create comprehensive default value configuration
**Strategy**: Fail-fast validation before transmission

### Risk 3: Performance
**Impact**: Large schema (548 KB) may slow down UI
**Mitigation**: Lazy-load schema sections, pagination in tree viewer
**Strategy**: Only load visible tree nodes

### Risk 4: Country-Specific Variations
**Impact**: Each country has different required fields
**Mitigation**: Configuration-driven mapping per country/procedure
**Strategy**: FilingFieldMappingConfig table

---

## 8. Database Schema Changes Required

### A. New Table: FilingFieldMappingConfig
```prisma
model FilingFieldMappingConfig {
  id              String  @id @default(cuid())
  country         String
  procedureCode   String
  transactionType String  // import/export
  
  // Source (shipment field)
  sourceField     String
  sourceType      String  // shipment, lineItem, party, document
  
  // Target (schema field)
  targetPath      String  // e.g., "ImportDeclaration.GoodsDeclaration.DeclarationNumber"
  
  // Transformation
  transformType   String? // direct, calculated, lookup, constant
  transformValue  String? // For constant or lookup key
  
  isRequired      Boolean @default(false)
  defaultValue    String?
  
  @@unique([country, procedureCode, transactionType, targetPath])
}
```

### B. New Table: FilingDefaultValues
```prisma
model FilingDefaultValues {
  id              String @id @default(cuid())
  country         String
  procedureCode   String
  transactionType String
  
  fieldPath       String
  defaultValue    String
  valueType       String  // string, number, boolean, array
  
  isActive        Boolean @default(true)
  
  @@unique([country, procedureCode, transactionType, fieldPath])
}
```

---

## 9. Recommendations

### Immediate Actions:
1. ✅ **Schema structure is correct** - Import/Export separation done
2. ✅ **Response fields added** - Canonical fields in Response section
3. ⚠️ **Mapping layer missing** - Need comprehensive field mapping
4. ⚠️ **UI Config paths** - Need to handle deep nesting

### Short-term (This Sprint):
1. Create TypeScript types from JSON schemas (use codegen tool)
2. Update declarationBuilder to route by transaction type
3. Implement basic field mapping for critical fields
4. Update UI Config to display nested paths correctly

### Medium-term (Next Sprint):
1. Build comprehensive field mapping configuration
2. Create default value management UI
3. Test with real country submissions
4. Add validation rules per country/procedure

### Long-term (Future):
1. Auto-generate TypeScript types from JSON schemas (CI/CD integration)
2. Build mapping configuration UI (visual field mapper)
3. Support more transaction types (Transit, TIR, etc.)
4. Add schema version migration tools

---

## 10. Success Criteria

### MVP (Minimum Viable Product):
- [ ] Can create Import filing from shipment with 20+ mapped fields
- [ ] Can create Export filing from shipment with 20+ mapped fields
- [ ] Can receive and parse Response section (canonical + country-specific)
- [ ] UI Config works with new schema paths
- [ ] Filing status updates based on canonical response status

### Full Implementation:
- [ ] 100+ fields mapped per transaction type
- [ ] Country-specific configurations for NL, IE, FR, DE
- [ ] Visual field mapping configuration tool
- [ ] Schema validation before transmission
- [ ] Complete audit trail of raw requests/responses

---

## Conclusion

The new schema structure is **significantly more comprehensive** than the current implementation. The system needs a **mapping layer** between shipment data and the full schema structure. The recommended approach is **incremental migration** with backward compatibility, starting with critical fields and expanding coverage over time.

**Next Steps**: Implement Phase 1 (Schema Integration) to establish the foundation for the new structure.
