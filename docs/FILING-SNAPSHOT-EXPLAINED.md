# FilingSnapshot: What It Is and Why It Exists

**Date**: 2026-08-16  
**Question**: What is FilingSnapshot?

---

## 📸 Overview

**FilingSnapshot** is a **point-in-time freeze** of all shipment data at the moment a filing is transmitted to customs.

### Core Concept

Think of it as a **"photograph"** of the shipment data that was used to create the customs declaration. Once taken, this snapshot never changes, even if the shipment data is later edited.

---

## 🗄️ Table Structure

### Schema Definition

**File**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (lines 2849-2859)

```prisma
model FilingSnapshot {
  id             String        @id @default(cuid())
  filingId       String        @unique              // 1:1 relationship
  filing         CustomsFiling @relation(...)
  snapshotData   Json                              // Frozen shipment data
  hasSection301  Boolean       @default(false)     // US-specific
  section301List String?                           // US-specific
  createdAt      DateTime      @default(now())
  
  @@index([filingId])
}
```

### Relationship

```
CustomsFiling (1) ←→ (1) FilingSnapshot
         └─ Has one snapshot (current effective state)
```

---

## 📦 What It Contains (snapshotData JSON)

### Type Definition

**File**: [`src/modules/filings/filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) (lines 12-51)

```typescript
type FilingSnapshotData = {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    portOfEntry: string | null;
    carrierName: string | null;
    incoterm: string | null;
    entryType: string | null;
  };
  
  lineItems: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    totalValue: number;
    htsCode: string;
    countryOfOrigin: string;
  }>;
  
  documents: Array<{
    id: string;
    fileName: string;
    docType: string;
  }>;
  
  filingHeader: {
    entryNumber: string;
    entryType: string;
    totalValue: number;
    totalDuties: number;
    totalTaxes: number;
    totalAmount: number;
  };
  
  metadata: {
    generator: string;
    version: number;
    timestamp: string;
  };
};
```

### Example Data

```json
{
  "shipment": {
    "id": "shp_12345",
    "shipmentNumber": "SHP-2026-004872",
    "importerName": "ABC Manufacturing India Pvt Ltd",
    "portOfEntry": "USNYC",
    "carrierName": "Maersk",
    "incoterm": "FOB",
    "entryType": "01"
  },
  "lineItems": [
    {
      "id": "item_001",
      "lineNumber": 1,
      "description": "Electronic Components",
      "quantity": 1000,
      "unitPrice": 50,
      "totalValue": 50000,
      "htsCode": "8517620090",
      "countryOfOrigin": "CN"
    }
  ],
  "documents": [
    {
      "id": "doc_001",
      "fileName": "commercial-invoice.pdf",
      "docType": "COMMERCIAL_INVOICE"
    }
  ],
  "filingHeader": {
    "entryNumber": "NL-5100-MSW257CL-1177FC",
    "entryType": "01",
    "totalValue": 50000,
    "totalDuties": 2500,
    "totalTaxes": 500,
    "totalAmount": 53000
  },
  "metadata": {
    "generator": "Qubere Filing Service",
    "version": 1,
    "timestamp": "2026-08-16T10:30:00Z"
  }
}
```

---

## ⏰ When It's Created

### Trigger: Transmission

**FilingSnapshot is created/updated when**:
1. User clicks **"Transmit to Customs"**
2. User clicks **"Save & Resubmit"**

**File**: [`filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) (lines 348-352)

```typescript
await db.filingSnapshot.upsert({
  where: { filingId },
  update: { snapshotData, hasSection301, section301List },
  create: { filingId, snapshotData, hasSection301, section301List },
});
```

**Note**: Uses `upsert` - creates new snapshot on first transmission, updates on resubmit.

---

## 🎯 Why It Exists: The Problem It Solves

### Problem: Data Changes After Transmission

**Scenario**:
```
Day 1, 10:00 AM - User transmits filing
  Shipment data:
    - Line 1: Quantity = 1000 units
    - Line 1: HTS Code = 8517620090
    - Total Value = $50,000

Day 1, 2:00 PM - User realizes error, edits shipment
  Shipment data NOW:
    - Line 1: Quantity = 1200 units  ← CHANGED
    - Line 1: HTS Code = 8517620095  ← CHANGED
    - Total Value = $60,000          ← CHANGED

Day 2 - Customs responds with questions about the filing
  
  ❓ Question: Which data did we actually send to customs?
  ✅ Answer: The FilingSnapshot has the exact data from Day 1, 10:00 AM
```

### Without FilingSnapshot

```
Problem: Cannot reconstruct what was sent
  ├─ Shipment table has current data (after edits)
  ├─ FilingMessage has canonical format (transformed)
  └─ ❌ No way to see original shipment state at transmission time
```

### With FilingSnapshot

```
Solution: Frozen point-in-time record
  ├─ Shipment table = current/editable data
  ├─ FilingSnapshot = frozen data at transmission
  └─ ✅ Always know exactly what was sent to customs
```

---

## 🔄 Complete Flow

### Transmission Flow

```
Step 1: User clicks "Transmit to Customs"
        ↓
Step 2: Filing Service: buildSnapshotAndPublish()
        ↓
Step 3: Collect current shipment data
        ├─ Shipment details
        ├─ Line items
        ├─ Documents
        ├─ Party information
        └─ Calculated duties/taxes
        ↓
Step 4: Create FilingSnapshot
        ├─ Freeze data into snapshotData JSON
        ├─ Mark timestamp
        └─ Store in database
        ↓
Step 5: Build canonical declaration FROM snapshot
        ↓
Step 6: Publish to FilingMessage (OUTBOUND)
        ↓
Step 7: Transmit to customs

✅ SNAPSHOT IS NOW IMMUTABLE
   (even if shipment data changes later)
```

**File**: [`filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) (lines 295-352)

```typescript
private static async buildSnapshotAndPublish(...) {
  // Get current shipment data
  const filing = await db.customsFiling.findFirst({
    include: { shipment: { include: { documents: true, lineItems: true } } }
  });
  
  // Calculate duties
  const tariff = await computeFilingTariff(...);
  
  // Build snapshot data object
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
      entryType: filing.entryType,
      totalValue: Number(filing.totalValue),
      totalDuties: Number(filing.totalDuties),
      totalTaxes: Number(filing.totalTaxes),
      totalAmount: Number(filing.totalAmount),
    },
    metadata: {
      generator: "Qubere Filing Service",
      version: filing.version,
      timestamp: new Date().toISOString(),
    }
  };
  
  // Create or update snapshot
  await db.filingSnapshot.upsert({
    where: { filingId },
    update: { snapshotData, hasSection301, section301List },
    create: { filingId, snapshotData, hasSection301, section301List },
  });
  
  // Build declaration FROM snapshot
  const declaration = await buildCanonicalDeclaration({
    accountId,
    filingId,
    shipmentId: filing.shipment.id,
    snapshotData,  // ← Uses frozen data
    tariff,
  });
  
  // Publish to queue
  await publisher.publish("customs-filing-outbound", message);
}
```

---

## 🎭 Use Cases

### 1. **Audit Trail**

```
Scenario: Customs audit 6 months later
  ├─ Question: "What was the HTS code you declared?"
  └─ Answer: Check FilingSnapshot.snapshotData.lineItems[0].htsCode
             (shows exactly what was transmitted)
```

### 2. **Data Integrity**

```
Scenario: User edits shipment after transmission
  ├─ Current Shipment: Quantity = 1200 (edited)
  ├─ FilingSnapshot: Quantity = 1000 (original)
  └─ Declaration was based on snapshot (1000 units)
      → No confusion about what was filed
```

### 3. **Resubmission**

```
Scenario: Filing rejected, need to resubmit
  ├─ Option 1: Resubmit with current shipment data
  │   └─ Creates NEW snapshot with updated data
  └─ Option 2: Compare current vs original
      └─ View snapshot to see what customs saw originally
```

### 4. **Dispute Resolution**

```
Scenario: Customs claims declaration error
  ├─ Compare: FilingSnapshot vs FilingMessage
  ├─ Check: What we froze vs what we sent
  └─ Prove: Exact data used for declaration
```

---

## 🔍 Key Differences

### FilingSnapshot vs FilingMessage

| Aspect | FilingSnapshot | FilingMessage |
|--------|---------------|---------------|
| **What** | Raw shipment data (frozen) | Canonical message (transformed) |
| **Format** | Simple JSON (shipment structure) | Canonical schema (ImportDeclaration) |
| **When** | Created at transmission | Created for EVERY message |
| **Count** | 1 per filing | Many per filing (request, response, amendments) |
| **Purpose** | Audit trail of source data | Message queue + communication log |
| **Mutability** | Replaced on resubmit | Immutable once created |

### Example Comparison

**FilingSnapshot**:
```json
{
  "lineItems": [
    {
      "htsCode": "8517620090",
      "description": "Electronic Components",
      "quantity": 1000
    }
  ]
}
```

**FilingMessage (OUTBOUND)**:
```json
{
  "envelope": {
    "data": {
      "declaration": {
        "ImportDeclaration": {
          "GoodsDeclaration": {
            "GoodsShipment": {
              "Consignment": {
                "GoodsItem": [{
                  "Commodity": {
                    "CommodityCode": "851762",
                    "NationalTariffSuffix": "0090"
                  },
                  "Description": "Electronic Components",
                  "GoodsMeasure": {
                    "GrossMass": 1000
                  }
                }]
              }
            }
          }
        }
      }
    }
  }
}
```

**Key Difference**: 
- FilingSnapshot = **Source data** (as-is from Shipment table)
- FilingMessage = **Transformed data** (canonical schema format)

---

## 📊 Relationship Diagram

```
┌─────────────────┐
│ Shipment        │  ← Current/editable data
│ - Quantity: 1200│     (may change after filing)
└────────┬────────┘
         │
         │ Read at transmission
         ↓
┌─────────────────────────────┐
│ FilingSnapshot              │
│ - snapshotData: {           │  ← Frozen data
│     lineItems: [{           │     (immutable record)
│       quantity: 1000        │
│     }]                      │
│   }                         │
└────────┬────────────────────┘
         │
         │ Used to build
         ↓
┌─────────────────────────────┐
│ FilingMessage (OUTBOUND)    │
│ - envelope: {               │  ← Canonical message
│     ImportDeclaration: {...}│     (transformed format)
│   }                         │
└────────┬────────────────────┘
         │
         │ Transmitted to
         ↓
┌─────────────────┐
│ Customs         │
│ Authority       │
└─────────────────┘
```

---

## 🔄 Update Behavior

### On Resubmit

```typescript
// FilingSnapshot.filingId is UNIQUE (1:1 relationship)
// On resubmit, the snapshot is UPDATED, not duplicated

await db.filingSnapshot.upsert({
  where: { filingId },
  update: { snapshotData },  // ← Replaces old snapshot
  create: { filingId, snapshotData },
});
```

**Why update instead of archive?**

Comment in code (lines 335-339):
> "FilingSnapshot.filingId is unique (one snapshot per filing, 'current effective state'), so a resubmit updates it rather than creating a second row. The full history of what was actually sent at each point in time still lives in FilingMessage.envelope, one immutable row per message -- this snapshot is deliberately 'latest,' not an archive."

**Translation**: 
- FilingSnapshot = **Current** frozen state (updated on resubmit)
- FilingMessage = **Historical** archive (one row per transmission)

---

## 💡 Key Insights

### 1. **Point-in-Time Freeze**
FilingSnapshot captures the exact state of shipment data at transmission moment, preventing confusion from later edits.

### 2. **Source of Truth for Declaration**
The canonical declaration is built FROM the snapshot, not from current shipment data, ensuring consistency.

### 3. **Audit Compliance**
Customs authorities require proof of what was declared. FilingSnapshot provides that evidence.

### 4. **1:1 Relationship**
Each filing has exactly ONE snapshot (current state), but many messages (historical log).

### 5. **Simplified Format**
Snapshot stores data in simple shipment structure, not complex canonical schema, making it easier to understand and query.

---

## 🎯 Summary

| Aspect | Answer |
|--------|--------|
| **What is it?** | Frozen point-in-time copy of shipment data |
| **When created?** | At transmission (Transmit or Resubmit) |
| **Why exists?** | Prevent confusion from post-transmission edits |
| **What contains?** | Shipment details, line items, documents, duties, metadata |
| **Relationship?** | 1:1 with CustomsFiling (one per filing) |
| **Format?** | Simple JSON (shipment structure), not canonical schema |
| **Mutable?** | Updated on resubmit (not archived) |
| **Purpose?** | Audit trail, data integrity, source of truth for declaration |

---

## 📚 Related Files

- **Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (line 2849)
- **Service**: [`filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) (lines 12-51, 295-352)
- **Declaration Builder**: [`declarationBuilder.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/declarationBuilder.ts) (uses snapshot as input)

---

**Documentation Created**: 2026-08-16 22:55 IST
