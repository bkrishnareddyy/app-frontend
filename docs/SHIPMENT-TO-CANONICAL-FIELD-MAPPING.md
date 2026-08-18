# Shipment to Canonical Field Mapping

## Overview

This document defines the complete field mappings from the `Shipment` table and related entities to the Import/Export canonical schemas (`ImportDeclaration.schema.json` and `ExportDeclaration.schema.json`).

**Mapping Strategy**: Source code mappings in declaration builder (no database tables)

---

## Shipment Model Fields (from schema.prisma)

### Core Shipment Fields
```typescript
{
  id: string
  accountId: string
  shipmentNumber: string              // e.g., "SHP-2026-004872"
  importerName: string                // e.g., "ABC Manufacturing India Pvt Ltd"
  importerOfRecordId: string?
  clientId: string?
  assignedBrokerId: string?
  poReference: string?                // e.g., "PO-778899"
  entryType: string?                  // CBP entry type code (e.g., "01")
  incoterm: string?                   // e.g., "FOB", "CIF"
  portOfEntry: string?                // e.g., "USNYC" (port code)
  carrierName: string?                // e.g., "Maersk"
  countryOfExport: string?            // ISO 3166-1 alpha-2
  countryOfOrigin: string?            // ISO 3166-1 alpha-2
  destinationCountry: string?         // ISO 3166-1 alpha-2 (import into)
  estimatedArrival: DateTime?
  ladingDate: DateTime?               // On-board / ETD
  arrivalDate: DateTime?              // Actual arrival at first port
  transportMode: string?              // "Ocean" | "Air" | "Truck" | "Rail"
  filingDeadline: DateTime?
  status: string                      // "Draft" | "In Progress" | "Ready to File" | "Submitted" | "Completed"
  currentStage: string?               // "DOCUMENT_INTAKE" | "CLASSIFICATION" | "FILING_PREP" | etc.
  healthStatus: string?               // "Healthy" | "At Risk" | "Critical"
  readinessScore: Int?                // 0-100
  riskScore: Int?                     // 0-100
  ownerName: string?
  version: Int
  masterShipmentId: string?           // For house shipments
}
```

### Related Entities
- **ShipmentLineItem**: HTS code, description, quantity, value, origin
- **ShipmentParty**: Importer, exporter, declarant, etc. with legal entity data
- **ShipmentDocument**: Supporting documents (invoices, BL, certificates)
- **CustomsFiling**: Linked filing records

---

## Import Declaration Field Mappings

### Transaction Wrapper
**Path**: `ImportDeclaration.GoodsDeclaration.*`

### Header/Reference Fields

| Shipment Field | Import Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `filingId` | `GoodsDeclaration.ReferenceNumber` | Direct | **NEW FIELD** - Internal reference |
| `shipmentNumber` | `GoodsDeclaration.DeclarationNumber` | Direct | Declaration number |
| `entryType` | `GoodsDeclaration.Procedure` | Map via procedure mapping | CBP entry type → Country procedure |
| - | `GoodsDeclaration.FunctionCode` | Default: "9" | Original declaration |
| - | `GoodsDeclaration.KindOfDeclaration` | Default: "IM" | Import |
| - | `GoodsDeclaration.MessageRole` | Default: "EDI" | Electronic submission |

### Procedure & Administration

| Shipment Field | Import Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `entryType` | `GoodsDeclaration.Procedure` | Map to country-specific | E.g., "40" → "H1" for temp import |
| - | `GoodsDeclaration.SubProcedure` | Config-driven | Country/procedure specific |
| - | `GoodsDeclaration.Administration` | Config-driven | Customs office code |

### Financial Fields

| Shipment Field | Import Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `lineItems.sum(totalValue)` | `GoodsDeclaration.InvoiceAmount` | Sum all line items | Total invoice value |
| - | `GoodsDeclaration.InvoiceCurrency` | Default: "USD" | Or from shipment config |
| `lineItems.length` | `GoodsDeclaration.GoodsItemQuantity` | Count | Number of line items |

### Party Mappings

#### Declarant
**Path**: `GoodsDeclaration.Declarant.*`

| Source | Target Path | Transformation | Notes |
|--------|------------|----------------|-------|
| ShipmentParty (role: "DECLARANT") | `Declarant.Name` | `legalEntity.legalName` | |
| ShipmentParty | `Declarant.Address.Street` | `legalEntity.address` | |
| ShipmentParty | `Declarant.Address.City` | `legalEntity.city` | |
| ShipmentParty | `Declarant.Address.PostCode` | `legalEntity.postalCode` | |
| ShipmentParty | `Declarant.Address.Country` | `legalEntity.country` | ISO alpha-2 |
| ShipmentParty | `Declarant.EORI` | `legalEntity.eoriNumber` | If available |
| ShipmentParty | `Declarant.Communication.Email` | `legalEntity.email` | |
| ShipmentParty | `Declarant.Communication.Phone` | `legalEntity.phone` | |

#### Importer
**Path**: `GoodsDeclaration.Parties.Importer.*` (or `GoodsDeclaration.Importer.*` depending on schema)

| Source | Target Path | Transformation | Notes |
|--------|------------|----------------|-------|
| ShipmentParty (role: "IMPORTER_OF_RECORD") | `Importer.Name` | `legalEntity.legalName` | |
| ShipmentParty | `Importer.Address.Street` | `legalEntity.address` | |
| ShipmentParty | `Importer.Address.City` | `legalEntity.city` | |
| ShipmentParty | `Importer.Address.PostCode` | `legalEntity.postalCode` | |
| ShipmentParty | `Importer.Address.Country` | `legalEntity.country` | ISO alpha-2 |
| ShipmentParty | `Importer.EORI` | `legalEntity.eoriNumber` | If available |
| ShipmentParty | `Importer.TIN` | `legalEntity.taxIdentifier` | Tax ID |
| ShipmentParty | `Importer.Communication.Email` | `legalEntity.email` | |

#### Exporter
**Path**: `GoodsDeclaration.Parties.Exporter.*` (or `GoodsDeclaration.Exporter.*`)

| Source | Target Path | Transformation | Notes |
|--------|------------|----------------|-------|
| ShipmentParty (role: "EXPORTER") | `Exporter.Name` | `legalEntity.legalName` | |
| ShipmentParty | `Exporter.Address.Street` | `legalEntity.address` | |
| ShipmentParty | `Exporter.Address.City` | `legalEntity.city` | |
| ShipmentParty | `Exporter.Address.PostCode` | `legalEntity.postalCode` | |
| ShipmentParty | `Exporter.Address.Country` | `legalEntity.country` | ISO alpha-2 |
| ShipmentParty | `Exporter.EORI` | `legalEntity.eoriNumber` | If available |
| ShipmentParty | `Exporter.TIN` | `legalEntity.taxIdentifier` | Tax ID |

### Transport/Consignment Fields

**Path**: `GoodsDeclaration.GoodsShipment.Consignment.*`

| Shipment Field | Import Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `transportMode` | `Consignment.TransportMeans.ModeCode` | Map: Ocean→1, Air→4, Truck→3, Rail→2 | UN/CEFACT codes |
| `carrierName` | `Consignment.Carrier.Name` | Direct | |
| `portOfEntry` | `Consignment.ArrivalTransportMeans.LocationOfGoods.Name` | Direct | Port code |
| `arrivalDate` | `Consignment.ArrivalTransportMeans.ArrivalDate` | Format ISO 8601 | |
| `incoterm` | `Consignment.DeliveryTerms.Code` | Direct | E.g., "FOB", "CIF" |
| - | `Consignment.ContainerIndicator` | Check if containerized | Boolean |

### Line Items (GoodsItem Array)

**Path**: `GoodsDeclaration.GoodsShipment.Consignment.GoodsItem[].*`

| ShipmentLineItem Field | Import Schema Path | Transformation | Notes |
|----------------------|-------------------|----------------|-------|
| `lineNumber` | `GoodsItem[].SequenceNumber` | Direct | 1-based |
| `description` | `GoodsItem[].Description` | Direct | Item description |
| `htsCode` | `GoodsItem[].Commodity.CommodityCode` | Split: first 6 digits | HS6 universal code |
| `htsCode` | `GoodsItem[].Commodity.NationalTariffSuffix` | Split: after 6 digits | Country-specific |
| `quantity` | `GoodsItem[].GoodsMeasure.GrossMass` | Direct | Gross weight |
| `quantity` | `GoodsItem[].GoodsMeasure.NetNetWeight` | Direct | Net weight |
| `uom` | `GoodsItem[].GoodsMeasure.UnitOfMeasure` | Direct | Unit code |
| `unitPrice` | Calculate | `totalValue / quantity` | Unit price |
| `totalValue` | `GoodsItem[].InvoiceLineValue` | Direct | Line total |
| `countryOfOrigin` | `GoodsItem[].Origin.CountryOfOrigin` | Direct | ISO alpha-2 |
| - | `GoodsItem[].StatisticalValue` | Same as InvoiceLineValue | For statistics |
| `customsValue` | `GoodsItem[].CustomsValuation.ChargeableAmount` | From tariff engine | Duty-eligible value |

### Documents

**Path**: `GoodsDeclaration.SupportingDocuments[].*` or `GoodsDeclaration.GoodsShipment.SupportingDocument[].*`

| ShipmentDocument Field | Import Schema Path | Transformation | Notes |
|-----------------------|-------------------|----------------|-------|
| `documentType` | `SupportingDocument[].Type` | Map to schema codes | E.g., "COMMERCIAL_INVOICE" → "380" |
| `documentNumber` | `SupportingDocument[].ReferenceNumber` | Direct | Invoice number, etc. |
| `documentDate` | `SupportingDocument[].Date` | Format ISO 8601 | |
| `fileName` | `SupportingDocument[].Name` | Direct | File name |
| `storageUrl` | Internal only | N/A | Not sent to customs |

### Valuation

**Path**: `GoodsDeclaration.ValuationAdjustment.*` or per `GoodsItem[].CustomsValuation.*`

| Source | Import Schema Path | Transformation | Notes |
|--------|-------------------|----------------|-------|
| TariffEngineResult | `GoodsItem[].CustomsValuation.ChargeableAmount` | From duty calculation | Customs value |
| - | `GoodsItem[].CustomsValuation.MethodCode` | Default: "1" | Transaction value (Method 1) |
| - | `ValuationAdjustment.AdditionCode` | Config-driven | Freight, insurance adjustments |

### Internal/Extension Fields

**Path**: `GoodsDeclaration.InternalData.*`

| Shipment Field | Import Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `id` | `InternalData.QubereShipmentId` | Direct | Internal tracking |
| `filingId` | `InternalData.QubereFilingId` | Direct | Internal filing ID |
| `status` | `InternalData.QubereShipmentStatus` | Direct | Workflow status |
| `currentStage` | `InternalData.QubereWorkflowStage` | Direct | Pipeline stage |

---

## Export Declaration Field Mappings

### Transaction Wrapper
**Path**: `ExportDeclaration.GoodsDeclaration.*`

**Note**: Most mappings are similar to Import, with these key differences:

| Shipment Field | Export Schema Path | Transformation | Notes |
|---------------|-------------------|----------------|-------|
| `filingId` | `GoodsDeclaration.ReferenceNumber` | Direct | **NEW FIELD** - Internal reference |
| `shipmentNumber` | `GoodsDeclaration.DeclarationNumber` | Direct | Declaration number |
| - | `GoodsDeclaration.AreaCode` | Default: "EX" | Export |
| - | `GoodsDeclaration.FunctionCode` | Default: "9" | Original |
| `destinationCountry` | `GoodsDeclaration.ExportCountry` | Direct | Destination country |
| `portOfEntry` → `portOfExit` | `Consignment.DepartureTransportMeans.Location` | Direct | Exit port |

**Party Differences**:
- Export focuses on **Exporter** as primary party
- **Consignee** (foreign buyer) instead of Importer
- **Declarant** still required

---

## Default Values by Country/Procedure

These values are required by schemas but not present in Shipment:

### Common Defaults

| Field Path | Default Value | Notes |
|-----------|--------------|-------|
| `FunctionCode` | "9" | Original declaration |
| `MessageRole` | "EDI" | Electronic submission |
| `DeclarantStatus` | "2" | Representative acting on behalf |
| `InvoiceCurrency` | "USD" | Override per shipment if needed |
| `ValuationMethodCode` | "1" | Transaction value (WTO Method 1) |

### Country-Specific

To be configured per country in UI Config or code constants:

- **Administration** codes (customs office)
- **SubProcedure** codes
- **LocalClearanceProcedure** codes
- **AdditionalProcedure** codes
- Document type codes
- Statistical procedure codes

---

## Implementation Strategy

### 1. Enhanced Declaration Builder

**New Files**:
- `src/lib/canonicalMessaging/importDeclarationBuilder.ts` - Import-specific mapping
- `src/lib/canonicalMessaging/exportDeclarationBuilder.ts` - Export-specific mapping
- `src/lib/canonicalMessaging/fieldMappers.ts` - Shared mapping utilities

**Updated Files**:
- `src/lib/canonicalMessaging/declarationBuilder.ts` - Route to transaction-specific builders

### 2. Mapping Functions

```typescript
// Party mapping
async function mapParty(
  shipmentId: string, 
  role: string
): Promise<PartySchema> {
  const party = await db.shipmentParty.findFirst({
    where: { shipmentId, role },
    include: { legalEntity: true }
  });
  
  return {
    Name: party.legalEntity.legalName,
    Address: {
      Street: party.legalEntity.address,
      City: party.legalEntity.city,
      PostCode: party.legalEntity.postalCode,
      Country: party.legalEntity.country
    },
    EORI: party.legalEntity.eoriNumber,
    TIN: party.legalEntity.taxIdentifier,
    Communication: {
      Email: party.legalEntity.email,
      Phone: party.legalEntity.phone
    }
  };
}

// Line item mapping
function mapGoodsItem(
  lineItem: ShipmentLineItem,
  tariffResult: TariffLineResult
): GoodsItemSchema {
  const { hsCode6, nationalSuffix } = splitHsCode(lineItem.htsCode);
  
  return {
    SequenceNumber: lineItem.lineNumber,
    Description: lineItem.description,
    Commodity: {
      CommodityCode: hsCode6,
      NationalTariffSuffix: nationalSuffix
    },
    GoodsMeasure: {
      GrossMass: lineItem.quantity,
      NetNetWeight: lineItem.netWeight || lineItem.quantity,
      UnitOfMeasure: lineItem.uom || "KGM"
    },
    InvoiceLineValue: lineItem.totalValue,
    StatisticalValue: lineItem.totalValue,
    Origin: {
      CountryOfOrigin: lineItem.countryOfOrigin
    },
    CustomsValuation: {
      ChargeableAmount: tariffResult.customsValue,
      MethodCode: "1"
    }
  };
}

// Transport mode mapping
function mapTransportMode(mode: string): string {
  const modeMap = {
    "Ocean": "1",
    "Rail": "2", 
    "Truck": "3",
    "Air": "4"
  };
  return modeMap[mode] || "1";
}
```

### 3. Transaction-Specific Builders

```typescript
export async function buildImportDeclaration(
  params: BuildDeclarationParams
): Promise<ImportDeclaration> {
  const { shipment, filing, snapshotData, tariff } = params;
  
  // Load parties
  const declarant = await mapParty(shipment.id, "DECLARANT");
  const importer = await mapParty(shipment.id, "IMPORTER_OF_RECORD");
  const exporter = await mapParty(shipment.id, "EXPORTER");
  
  // Map line items
  const goodsItems = snapshotData.lineItems.map((item, idx) =>
    mapGoodsItem(item, tariff.lineResults[idx])
  );
  
  return {
    ImportDeclaration: {
      GoodsDeclaration: {
        // Reference fields
        ReferenceNumber: filing.id,
        DeclarationNumber: shipment.shipmentNumber,
        
        // Header
        FunctionCode: "9",
        KindOfDeclaration: "IM",
        MessageRole: "EDI",
        
        // Procedure
        Procedure: mapProcedure(shipment.entryType, shipment.destinationCountry),
        
        // Financial
        InvoiceAmount: tariff.totalCustomsValue,
        InvoiceCurrency: "USD",
        GoodsItemQuantity: goodsItems.length,
        
        // Parties
        Declarant: declarant,
        Importer: importer,
        Exporter: exporter,
        
        // Goods Shipment
        GoodsShipment: {
          Consignment: {
            TransportMeans: {
              ModeCode: mapTransportMode(shipment.transportMode)
            },
            Carrier: {
              Name: shipment.carrierName
            },
            ArrivalTransportMeans: {
              LocationOfGoods: {
                Name: shipment.portOfEntry
              },
              ArrivalDate: shipment.arrivalDate?.toISOString()
            },
            DeliveryTerms: {
              Code: shipment.incoterm
            },
            GoodsItem: goodsItems
          }
        },
        
        // Internal data
        InternalData: {
          QubereShipmentId: shipment.id,
          QubereFilingId: filing.id,
          QubereShipmentStatus: shipment.status,
          QubereWorkflowStage: shipment.currentStage
        },
        
        // Response section (empty for request)
        Response: {}
      }
    }
  };
}
```

---

## Missing Fields Strategy

### Required but Not Available in Shipment

These fields are required by canonical schemas but don't exist in our Shipment model:

1. **EORI Numbers** - Add to LegalEntity table (optional field)
2. **VAT/TIN Numbers** - Already exists as `taxIdentifier` in LegalEntity
3. **Container Details** - Consider adding ContainerInfo table if needed
4. **Package Details** - Consider adding PackageInfo table if needed
5. **License Numbers** - Track in ShipmentDocument with type "LICENSE"
6. **Seal Numbers** - Add to transport info if needed
7. **Warehouse Codes** - Add if warehousing procedures are used

### User Input Required

For country-specific fields not derivable from shipment:
- Prompt user during filing configuration
- Store in UI Config as defaults
- Allow override in filing form

### External Data Sources

Some fields may come from external systems:
- Currency exchange rates
- Tariff classifications (HTS codes)
- Duty calculations
- Port/location codes

---

## Testing Strategy

1. **Unit Tests**: Test each mapper function individually
2. **Integration Tests**: Full shipment → declaration flow
3. **Schema Validation**: Validate output against JSON schemas
4. **Country Tests**: Test with real country/procedure configurations

---

## Next Steps

1. ✅ Add `ReferenceNumber` field to schemas
2. ⏳ Implement `importDeclarationBuilder.ts`
3. ⏳ Implement `exportDeclarationBuilder.ts`
4. ⏳ Update `declarationBuilder.ts` to route by transaction type
5. ⏳ Create mapper utility functions
6. ⏳ Test with real shipment data
7. ⏳ Update UI Config to show all mapped fields

---

## References

- Shipment Schema: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (lines 392-466)
- Import Schema: [`public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json)
- Export Schema: [`public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`](c:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json)
- Current Builder: [`src/lib/canonicalMessaging/declarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/declarationBuilder.ts)
