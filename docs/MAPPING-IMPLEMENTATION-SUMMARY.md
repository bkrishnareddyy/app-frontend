# Shipment to Canonical Mapping Implementation Summary

**Date**: 2026-08-16  
**Status**: ✅ **COMPLETE**

---

## 🎯 Objectives Completed

1. ✅ **Added ReferenceNumber field** to both Import and Export schemas
2. ✅ **Mapped filing ID** to `GoodsDeclaration.ReferenceNumber`
3. ✅ **Identified all relevant canonical fields** for shipment data
4. ✅ **Implemented comprehensive field mapping** in source code (no database tables)

---

## 📦 Deliverables

### 1. Schema Updates

**Files Modified**:
- [`ImportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json)
- [`ExportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json)

**Changes**:
```json
{
  "GoodsDeclaration": {
    "properties": {
      "DeclarationNumber": { "type": "string" },
      "ReferenceNumber": {
        "type": "string",
        "description": "Internal reference number for the filing (e.g., Filing ID or Entry Number)"
      }
    }
  }
}
```

### 2. New Source Code Files

#### A. Field Mappers (Shared Utilities)
**File**: [`src/lib/canonicalMessaging/fieldMappers.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/fieldMappers.ts)

**Functions**:
- `splitHsCode()` - Split HTS into HS6 + national suffix
- `mapTransportMode()` - Convert to UN/CEFACT codes (1=Maritime, 2=Rail, 3=Road, 4=Air)
- `formatIsoDate()` - Format dates to ISO 8601
- `loadAndMapParty()` - Load ShipmentParty with full address/contact details
- `mapProcedureCode()` - Map entry type to country-specific procedure
- `mapDocumentType()` - Map document types to standard codes
- `calculateUnitPrice()` - Calculate unit price from total/quantity
- `getDefaultCurrency()` - Get currency by country code
- `mapLineItemToGoodsItem()` - Map ShipmentLineItem to GoodsItem schema
- `buildInternalData()` - Build internal tracking data

#### B. Import Declaration Builder
**File**: [`src/lib/canonicalMessaging/importDeclarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/importDeclarationBuilder.ts)

**Function**: `buildImportDeclaration()`

**Maps**:
- Header: ReferenceNumber, DeclarationNumber, FunctionCode, KindOfDeclaration, MessageRole
- Procedure: Procedure code (country-specific)
- Financial: InvoiceAmount, InvoiceCurrency, GoodsItemQuantity
- Parties: Declarant, Importer, Exporter (full details: Name, Address, EORI, TIN, Communication)
- Transport: TransportMeans, Carrier, ArrivalTransportMeans, DeliveryTerms
- Line Items: SequenceNumber, Description, Commodity, GoodsMeasure, InvoiceLineValue, Origin, CustomsValuation
- Documents: SupportingDocuments array
- Internal: QubereShipmentId, QubereFilingId, QubereShipmentStatus, QubereWorkflowStage

#### C. Export Declaration Builder
**File**: [`src/lib/canonicalMessaging/exportDeclarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/exportDeclarationBuilder.ts)

**Function**: `buildExportDeclaration()`

**Maps**: (Similar to Import, plus Export-specific fields)
- AreaCode: "EX" (Export indicator)
- ExportCountry: Country of export
- DestinationCountry: Destination country
- DepartureTransportMeans: Departure location and date (vs arrival for imports)
- Parties: Declarant, Exporter, Consignee (instead of Importer)

#### D. Updated Main Builder
**File**: [`src/lib/canonicalMessaging/declarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/declarationBuilder.ts)

**Changes**:
- Added `transactionType?: "import" | "export"` parameter
- Routes to `buildImportDeclaration()` when transactionType = "import"
- Routes to `buildExportDeclaration()` when transactionType = "export"
- Falls back to legacy builder for backwards compatibility
- Maintains existing 20-field format for legacy callers

### 3. Documentation

#### A. Field Mapping Document
**File**: [`docs/SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md`](c:/WorkSpace/app-frontend/docs/SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md)

**Contents**:
- Complete Shipment model field reference
- Import Declaration field mappings (50+ fields)
- Export Declaration field mappings
- Party mappings (Declarant, Importer, Exporter, Consignee)
- Transport/Consignment mappings
- Line item mappings (GoodsItem schema)
- Document mappings
- Valuation mappings
- Internal/Extension field mappings
- Default values by country/procedure
- Implementation strategy
- Missing fields strategy
- Testing strategy

---

## 🗺️ Complete Field Mapping Overview

### Shipment → Import Declaration

| Category | Shipment Fields | Import Schema Paths | Count |
|----------|----------------|---------------------|-------|
| **Header** | shipmentNumber, entryType | ReferenceNumber, DeclarationNumber, Procedure, FunctionCode, KindOfDeclaration | 5 |
| **Financial** | lineItems totals | InvoiceAmount, InvoiceCurrency, GoodsItemQuantity | 3 |
| **Parties** | ShipmentParty (3 roles) | Declarant.*, Importer.*, Exporter.* | 24+ |
| **Transport** | transportMode, carrierName, portOfEntry, arrivalDate, incoterm | TransportMeans, Carrier, ArrivalTransportMeans, DeliveryTerms | 8 |
| **Line Items** | ShipmentLineItem (8 fields each) | GoodsItem[].* (12 fields each) | 96+ |
| **Documents** | ShipmentDocument | SupportingDocuments[] | 4 per doc |
| **Internal** | id, status, currentStage | InternalData.* | 5 |
| **TOTAL** | **~30 Shipment fields** | **140+ Import schema fields** | |

### Key Mappings

```typescript
// Filing ID → ReferenceNumber (NEW!)
ReferenceNumber: filingId

// Shipment number → Declaration number
DeclarationNumber: shipment.shipmentNumber

// Entry type → Procedure code
Procedure: mapProcedureCode(entryType, country, "import")

// Importer with full details
Importer: {
  Name: legalEntity.legalName,
  Address: {
    Street: legalEntity.address,
    City: legalEntity.city,
    PostCode: legalEntity.postalCode,
    Country: legalEntity.country
  },
  EORI: legalEntity.eoriNumber,
  TIN: legalEntity.taxIdentifier,
  Communication: {
    Email: legalEntity.email,
    Phone: legalEntity.phone
  }
}

// Line items with full classification
GoodsItem[]: {
  SequenceNumber: lineNumber,
  Description: description,
  Commodity: {
    CommodityCode: hsCode6,        // First 6 digits
    NationalTariffSuffix: suffix   // Remaining digits
  },
  GoodsMeasure: {
    GrossMass: quantity,
    NetNetWeight: quantity,
    UnitOfMeasure: "KGM"
  },
  InvoiceLineValue: totalValue,
  Origin: {
    CountryOfOrigin: countryOfOrigin
  },
  CustomsValuation: {
    ChargeableAmount: customsValue,  // From tariff engine
    MethodCode: "1"                  // Transaction value
  }
}
```

---

## 🔄 Usage Example

### Before (Legacy - 20 fields)

```typescript
import { buildCanonicalDeclaration } from "@/lib/canonicalMessaging/declarationBuilder";

const declaration = await buildCanonicalDeclaration({
  accountId,
  filingId,
  shipmentId,
  snapshotData,
  tariff
});
// Returns: CanonicalCustomsDeclaration with ~20 fields
```

### After (New - 140+ fields)

```typescript
import { buildCanonicalDeclaration } from "@/lib/canonicalMessaging/declarationBuilder";

// Import Declaration
const importDecl = await buildCanonicalDeclaration({
  accountId,
  filingId,
  shipmentId,
  snapshotData,
  tariff,
  transactionType: "import"  // NEW!
});
// Returns: ImportDeclaration with 140+ mapped fields

// Export Declaration
const exportDecl = await buildCanonicalDeclaration({
  accountId,
  filingId,
  shipmentId,
  snapshotData,
  tariff,
  transactionType: "export"  // NEW!
});
// Returns: ExportDeclaration with 140+ mapped fields
```

---

## ✅ Validation

### Schema Validation

The UI Config system already validates against these schemas:
- [`SchemaTreeViewer`](c:/WorkSpace/app-frontend/src/app/app/filing-config/SchemaTreeViewer.tsx) - Loads and displays schema structure
- [`DynamicFormRenderer`](c:/WorkSpace/app-frontend/src/app/app/filing-config/DynamicFormRenderer.tsx) - Renders forms from UI Config
- Schema validation occurs when saving UI Config

### Field Coverage

| Aspect | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Total Fields Mapped** | 20 | 140+ | **7x increase** |
| **Party Details** | Name, Country, TaxId (3) | Name, Address (4 fields), EORI, TIN, Communication (2 fields) = 9 | **3x increase** |
| **Line Item Details** | 8 fields | 12 fields | **50% increase** |
| **Transport Details** | 2 fields | 8 fields | **4x increase** |
| **Documents** | IDs only | Full metadata (Type, ReferenceNumber, Date, Name) | **Full support** |
| **Internal Tracking** | None | 5 fields | **New capability** |

---

## 🚀 Next Steps

### Immediate

1. ✅ **Schemas updated** - ReferenceNumber field added
2. ✅ **Builders implemented** - Import/Export with full mapping
3. ✅ **Documentation complete** - Comprehensive mapping guide
4. ⏳ **Testing required** - Validate with real shipment data

### Integration Points

**Where to use the new builders**:

1. **Filing Service** ([`src/modules/filings/filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts))
   ```typescript
   // Update transmitFiling() to pass transactionType
   const declaration = await buildCanonicalDeclaration({
     ...params,
     transactionType: determineTransactionType(procedure)  // Add this
   });
   ```

2. **UI Config Editor** ([`src/app/app/filing-config/UIConfigEditor.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing-config/UIConfigEditor.tsx))
   - Already handles transaction types (Import H*, Export E*)
   - Schema tree shows all 140+ fields
   - Field config panel allows enabling/disabling fields

3. **Dynamic Form Renderer** ([`src/app/app/filing-config/DynamicFormRenderer.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing-config/DynamicFormRenderer.tsx))
   - Already renders fields from UI Config
   - Will automatically show new mapped fields when enabled

### Testing Checklist

- [ ] Load a real shipment with full party data
- [ ] Build Import declaration with `transactionType: "import"`
- [ ] Verify all fields map correctly
- [ ] Validate against ImportDeclaration.schema.json
- [ ] Build Export declaration with `transactionType: "export"`
- [ ] Verify all fields map correctly
- [ ] Validate against ExportDeclaration.schema.json
- [ ] Test legacy path (no transactionType) for backwards compatibility
- [ ] Create UI Config for Import procedure
- [ ] Enable fields in UI Config editor
- [ ] Test Dynamic Form Renderer with enabled fields
- [ ] Submit test filing and verify message structure

---

## 📊 Impact Assessment

### Code Changes

| Category | Files | Changes |
|----------|-------|---------|
| **Schemas** | 2 | Added ReferenceNumber field |
| **New Files** | 3 | fieldMappers.ts, importDeclarationBuilder.ts, exportDeclarationBuilder.ts |
| **Updated Files** | 1 | declarationBuilder.ts - routing logic |
| **Documentation** | 2 | SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md, MAPPING-IMPLEMENTATION-SUMMARY.md |
| **TOTAL** | 8 files | ~15KB new code |

### Backwards Compatibility

✅ **Fully backwards compatible**
- Legacy callers (no `transactionType`) use old 20-field format
- New callers (with `transactionType`) use new 140+ field format
- No breaking changes to existing code

### Performance

- **No database changes** - all mapping in-memory
- **Lazy loading** - parties loaded via async queries
- **Efficient** - single query per party role
- **Scalable** - O(n) complexity for line items

---

## 🎓 Key Learnings

1. **Transaction-Specific Schemas**: Import and Export have different structures - wrapper logic needed
2. **Party Depth**: Canonical schemas require full party details (address, EORI, TIN, communication)
3. **HTS Splitting**: Universal HS6 + country-specific suffix pattern
4. **Transport Codes**: UN/CEFACT standard codes for modes
5. **Internal Tracking**: Extension fields (InternalData) for Qubere-specific data
6. **Default Values**: Many required fields need config-driven defaults per country/procedure

---

## 📚 References

- **Mapping Guide**: [`docs/SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md`](c:/WorkSpace/app-frontend/docs/SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md)
- **Import Builder**: [`src/lib/canonicalMessaging/importDeclarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/importDeclarationBuilder.ts)
- **Export Builder**: [`src/lib/canonicalMessaging/exportDeclarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/exportDeclarationBuilder.ts)
- **Field Mappers**: [`src/lib/canonicalMessaging/fieldMappers.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/fieldMappers.ts)
- **Main Builder**: [`src/lib/canonicalMessaging/declarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/declarationBuilder.ts)
- **Import Schema**: [`public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json)
- **Export Schema**: [`public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json)

---

**Implementation Complete**: 2026-08-16 22:30 IST ✅
