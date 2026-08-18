# EntryNumber Field Addition to Canonical Schemas

**Date**: 2026-08-16  
**Change**: Added `EntryNumber` field to canonical schemas and updated field mappings

---

## 🎯 What Changed

### 1. Added EntryNumber Field to Schemas

**Location**: Under `GoodsDeclaration` in both Import and Export schemas

**Files Modified**:
- `ImportDeclaration.schema.json` (line 21-24)
- `ExportDeclaration.schema.json` (line 515-518)

**Schema Definition**:
```json
{
  "EntryNumber": {
    "type": "string",
    "description": "Shipment entry number from the customs filing system"
  }
}
```

---

### 2. Updated Field Mappings

**Both EntryNumber and ReferenceNumber Now Map Entry Numbers**:

| Canonical Field | Source | Description |
|----------------|--------|-------------|
| **ReferenceNumber** | `filingId` | Internal filing ID (CUID) |
| **EntryNumber** | `snapshotData.filingHeader.entryNumber` | Customs entry number (e.g., NL-5100-MSW2QEA8-1D25C8) |
| **DeclarationNumber** | `shipment.shipmentNumber` | Shipment tracking number (e.g., SHP-2026-004872) |

---

## 📝 Field Mapping Details

### Import Declaration

**File**: `importDeclarationBuilder.ts` (lines 63-67)

**Before**:
```typescript
GoodsDeclaration: {
  ReferenceNumber: filingId,  // Internal filing reference
  DeclarationNumber: shipment.shipmentNumber,
```

**After**:
```typescript
GoodsDeclaration: {
  ReferenceNumber: filingId,  // Internal filing ID
  EntryNumber: snapshotData.filingHeader.entryNumber,  // Customs entry number
  DeclarationNumber: shipment.shipmentNumber,
```

---

### Export Declaration

**File**: `exportDeclarationBuilder.ts` (lines 63-67)

**Before**:
```typescript
GoodsDeclaration: {
  ReferenceNumber: filingId,  // Internal filing reference
  DeclarationNumber: shipment.shipmentNumber,
```

**After**:
```typescript
GoodsDeclaration: {
  ReferenceNumber: filingId,  // Internal filing ID
  EntryNumber: snapshotData.filingHeader.entryNumber,  // Customs entry number
  DeclarationNumber: shipment.shipmentNumber,
```

---

## 🎨 Visual Mapping

### Standalone Filing Example

```
CustomsFiling Record:
├─ id: "filing_abc123xyz"                    → ReferenceNumber
├─ entryNumber: "NL-5100-MSW2QEA8-1D25C8"    → EntryNumber ✨ NEW
└─ shipmentNumber: N/A (standalone)

Shipment Record (if exists):
└─ shipmentNumber: "SHP-2026-004872"         → DeclarationNumber
```

### Shipment-Based Filing Example

```
CustomsFiling Record:
├─ id: "filing_xyz789abc"                    → ReferenceNumber
├─ entryNumber: "DFT-SHP-2026-004872-A1B2C3" → EntryNumber ✨ NEW
└─ shipmentId: "shipment_456def"

Shipment Record:
└─ shipmentNumber: "SHP-2026-004872"         → DeclarationNumber
```

---

## 🔍 Entry Number Formats

### Standalone Filing Format
```
{country}-{procedure}-{timestamp36}-{random6}

Example: NL-5100-MSW2QEA8-1D25C8
         ││  │    │        └─ Random 6 chars
         ││  │    └────────── Timestamp (Base36)
         ││  └─────────────── Procedure code
         │└────────────────── Country code
```

### Shipment-Based Filing Format
```
DFT-{shipmentNumber}-{random8}

Example: DFT-SHP-2026-004872-A1B2C3D4
         │   │               └─ Random 8 chars
         │   └───────────────── Shipment number
         └───────────────────── Prefix
```

---

## 📊 Data Flow

### At Filing Creation

```
POST /api/filing
  ↓
CustomsFiling.create({
  entryNumber: generateEntryNumber(),  // Generated
  ...
})
  ↓
Filing record saved with entry number
```

### At Transmission

```
filing.service.ts → buildSnapshotAndPublish()
  ↓
snapshotData = {
  filingHeader: {
    entryNumber: filing.entryNumber,  // From CustomsFiling
    ...
  },
  ...
}
  ↓
importDeclarationBuilder.ts / exportDeclarationBuilder.ts
  ↓
GoodsDeclaration: {
  ReferenceNumber: filingId,
  EntryNumber: snapshotData.filingHeader.entryNumber,  ← Maps here
  DeclarationNumber: shipment.shipmentNumber,
}
  ↓
Canonical message transmitted to customs
```

---

## ✅ Benefits

### 1. Clear Separation of Concerns
- **ReferenceNumber**: Internal system ID (for database lookups)
- **EntryNumber**: Human-readable customs entry number (for user communication)
- **DeclarationNumber**: Shipment tracking number (for logistics)

### 2. Traceability
- Customs can reference the entry number in their responses
- Users can search by entry number (easier than CUID)
- Audit logs show meaningful entry numbers

### 3. Compliance
- Entry number visible to customs authorities
- Matches format expectations for each country
- Contains metadata (country, procedure) in the number itself

### 4. Backwards Compatible
- ReferenceNumber still contains filing ID
- No breaking changes to existing code
- EntryNumber is additional data, not replacement

---

## 🧪 Testing

### Test Case 1: Standalone Filing
1. Create standalone filing: NL / 5100 / IE015
2. Entry number generated: `NL-5100-MSW2QEA8-1D25C8`
3. Transmit filing
4. **Verify canonical message**:
   ```json
   {
     "ImportDeclaration": {
       "GoodsDeclaration": {
         "ReferenceNumber": "filing_abc123xyz",
         "EntryNumber": "NL-5100-MSW2QEA8-1D25C8",
         "DeclarationNumber": null
       }
     }
   }
   ```

### Test Case 2: Shipment-Based Filing
1. Create shipment: SHP-2026-004872
2. Create filing from shipment
3. Entry number generated: `DFT-SHP-2026-004872-A1B2C3D4`
4. Transmit filing
5. **Verify canonical message**:
   ```json
   {
     "ImportDeclaration": {
       "GoodsDeclaration": {
         "ReferenceNumber": "filing_xyz789abc",
         "EntryNumber": "DFT-SHP-2026-004872-A1B2C3D4",
         "DeclarationNumber": "SHP-2026-004872"
       }
     }
   }
   ```

---

## 📋 Checklist

- [x] Added EntryNumber to ImportDeclaration.schema.json
- [x] Added EntryNumber to ExportDeclaration.schema.json
- [x] Updated importDeclarationBuilder.ts to map EntryNumber
- [x] Updated exportDeclarationBuilder.ts to map EntryNumber
- [x] Updated field descriptions for clarity
- [x] Documented change

---

## 🔗 Related Files

- **Schemas**:
  - [`ImportDeclaration.schema.json`](C:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json) (line 21-24)
  - [`ExportDeclaration.schema.json`](C:/WorkSpace/app-frontend/public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json) (line 515-518)

- **Builders**:
  - [`importDeclarationBuilder.ts`](C:/WorkSpace/app-frontend/src/lib/canonicalMessaging/importDeclarationBuilder.ts) (line 63-67)
  - [`exportDeclarationBuilder.ts`](C:/WorkSpace/app-frontend/src/lib/canonicalMessaging/exportDeclarationBuilder.ts) (line 63-67)

- **Service**:
  - [`filing.service.ts`](C:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) (line 320-327)

- **API**:
  - [`POST /api/filing/route.ts`](C:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (line 341-344)

---

## 📖 Related Documentation

- [Entry Number Generation](./ENTRY-NUMBER-GENERATION-EXPLAINED.md)
- [Shipment to Canonical Field Mapping](./SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md)
- [Mapping Implementation Summary](./MAPPING-IMPLEMENTATION-SUMMARY.md)

---

**Documentation Created**: 2026-08-16 23:08 IST
