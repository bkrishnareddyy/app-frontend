# Where to Add ShipmentFilingModal Integration

**Date**: 2026-08-16

---

## 🎯 Current Flow (What Happens Now)

When a user wants to create a filing from a shipment:

###Step 1: User clicks link with shipmentId
Somewhere in the app (likely shipment detail page), there's a link or button to:
```
/app/filing?shipmentId=<shipmentId>
```

### Step 2: Routing to CreateFilingPrompt
**File**: [`src/app/app/filing/page.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/page.tsx) (lines 18-92)

```typescript
// If shipmentId in query params
if (shipmentId) {
  // Load shipment
  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId: context.accountId },
  });
  
  // Show CreateFilingPrompt component
  return (
    <CreateFilingPrompt
      shipment={{...}}
      entryTypeOptions={ENTRY_TYPES}  // ← US-centric legacy list
      lineItemCount={shipment.lineItems.length}
      totalValue={totalValue}
    />
  );
}
```

### Step 3: User sees CreateFilingPrompt
**File**: [`src/app/app/filing/CreateFilingPrompt.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/CreateFilingPrompt.tsx)

**Current UI**:
```
┌─────────────────────────────────────┐
│ Start a Customs Filing              │
│ SHP-2026-004872 · ABC Corp         │
├─────────────────────────────────────┤
│ Line Items: 5                       │
│ Declared Value: $50,000             │
│                                     │
│ Entry Type: [Dropdown]              │  ← Only asks for Entry Type
│   01 — Consumption                  │
│   03 — Warehouse                    │
│   etc.                              │
│                                     │
│ [Create Filing]                     │
└─────────────────────────────────────┘
```

### Step 4: CreateFilingPrompt calls API
**Lines 45-61**:
```typescript
async function handleCreate() {
  const res = await fetch("/api/filing", {
    method: "POST",
    body: JSON.stringify({ 
      shipmentId: shipment.id,
      entryType  // ← Only sends entryType (legacy)
    }),
  });
  router.push(`/app/filing/${data.filing.id}`);
}
```

### Step 5: API creates filing with missing data
**File**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 491-517)

```typescript
filing = await db.customsFiling.create({
  data: {
    country: destinationCountry,    // ✅ From shipment
    procedureCode: null,            // ❌ NULL
    messageName: null,              // ❌ NULL
    entryType: entryTypeCode,       // ⚠️ Legacy
  }
});
```

---

## ✅ New Flow (What Should Happen)

### Option 1: Replace CreateFilingPrompt with ShipmentFilingModal

**Update**: [`src/app/app/filing/CreateFilingPrompt.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/CreateFilingPrompt.tsx)

```typescript
"use client";

import { useState } from "react";
import { ShipmentFilingModal } from "./ShipmentFilingModal";

interface CreateFilingPromptProps {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    destinationCountry: string | null;
  };
  lineItemCount: number;
  totalValue: number;
}

export function CreateFilingPrompt({ shipment, lineItemCount, totalValue }: CreateFilingPromptProps) {
  const [isModalOpen, setIsModalOpen] = useState(true);

  return (
    <div className="max-w-xl mx-auto py-12 space-y-6">
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-ink">Start a Customs Filing</h1>
        <p className="text-sm text-ink-muted">
          {shipment.shipmentNumber} · Line Items: {lineItemCount} · Value: ${totalValue.toLocaleString()}
        </p>
      </div>

      <ShipmentFilingModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          // Redirect back to somewhere
          window.location.href = "/app/filing";
        }}
        shipmentId={shipment.id}
        defaultCountry={shipment.destinationCountry}
      />
    </div>
  );
}
```

---

### Option 2: Keep CreateFilingPrompt, Show Modal from Shipment Page

**Better approach**: Don't route to `/app/filing?shipmentId=X`, instead show modal directly from shipment page.

**Update**: Create a "Create Filing" button on shipment detail page

**File**: [`src/app/app/shipments/[id]/page.tsx`](c:/WorkSpace/app-frontend/src/app/app/shipments/[id]/page.tsx)

1. Find where to add the button (likely in the filing section)
2. Add ShipmentFilingModal component
3. Show modal when button clicked

**Example integration**:
```typescript
// Add to shipments/[id]/page.tsx or a client component

"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShipmentFilingModal } from "@/app/app/filing/ShipmentFilingModal";

export function ShipmentFilingButton({ 
  shipmentId, 
  destinationCountry 
}: { 
  shipmentId: string; 
  destinationCountry: string | null; 
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)}>
        <FileText className="w-4 h-4 mr-2" />
        Create Filing
      </Button>

      <ShipmentFilingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        shipmentId={shipmentId}
        defaultCountry={destinationCountry}
      />
    </>
  );
}
```

---

## 📋 Recommended Implementation Steps

### Step 1: Update CreateFilingPrompt Component

**File**: `src/app/app/filing/CreateFilingPrompt.tsx`

Replace the entire component with the modal-based approach:

```typescript
"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ShipmentFilingModal } from "./ShipmentFilingModal";

interface CreateFilingPromptProps {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    destinationCountry: string | null;
  };
  lineItemCount: number;
  totalValue: number;
}

export function CreateFilingPrompt({ shipment, lineItemCount, totalValue }: CreateFilingPromptProps) {
  const [isModalOpen, setIsModalOpen] = useState(true);

  return (
    <div className="max-w-xl mx-auto py-12">
      <Link href="/app/filing" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand mb-6">
        <ArrowLeft className="w-3.5 h-3.5" />
        All Filings
      </Link>

      <ShipmentFilingModal
        isOpen={isModalOpen}
        onClose={() => {
          // Redirect back to filing dashboard
          window.location.href = "/app/filing";
        }}
        shipmentId={shipment.id}
        defaultCountry={shipment.destinationCountry}
      />
    </div>
  );
}
```

### Step 2: Update API Route to Accept New Fields

**File**: `src/app/api/filing/route.ts` (lines 491-517)

```typescript
// Add to request body destructuring (line 308)
const { shipmentId, entryType, filingType, customEntryNumber, 
        standalone, country, procedureCode, messageName } = body;

// When creating shipment-based filing (line 491)
filing = await db.customsFiling.create({
  data: {
    shipmentId,
    accountId: ctx.accountId,
    entryNumber,
    // Use provided values or fall back to shipment values
    country: country || destinationCountry,
    procedureCode: procedureCode || null,
    messageName: messageName || null,
    entryType: entryTypeCode,
    transactionTypeId: null,  // TODO: Look up from procedureCode
    localReferenceNumber: entryNumber,  // Default to entry number
    filingType: filingType || "Standard",
    filingStatus: "Draft",
    preparedByUserId: ctx.userId,
    totalValue: calculatedValue,
    totalDuties: calculatedDuty,
    totalTaxes: null,
    totalAmount: calculatedTotal,
    dutyBreakdown,
  },
  include: {
    shipment: true,
    responses: true,
  },
});
```

### Step 3: Look up transactionTypeId from procedureCode

```typescript
// After getting country/procedureCode/messageName from request
if (procedureCode && messageName && country) {
  const procedureConfig = await db.filingProcedureConfig.findFirst({
    where: {
      country,
      procedureCode,
      messageName,
      isActive: true,
    },
    include: {
      transactionType: true,
    },
  });

  if (procedureConfig) {
    transactionTypeId = procedureConfig.transactionTypeId;
  }
}
```

---

## 🎨 Updated User Flow

```
User on Shipment Detail Page
  │
  ├─ Clicks "Create Filing" button OR
  ├─ Navigates to /app/filing?shipmentId=X
  │
  ↓
ShipmentFilingModal Opens
┌──────────────────────────────────────┐
│ Create Filing from Shipment         │
│                                      │
│ Country: [NL]         ← Pre-filled  │
│   (Defaulted to shipment's dest)    │
│                                      │
│ Procedure & Message:  ← User selects│
│   [5100 - IE015 (IMPORT)]           │
│   Options loaded from                │
│   FilingProcedureConfig              │
│                                      │
│ ✓ Selected Configuration:            │
│   Country: NL                        │
│   Procedure: 5100                    │
│   Message: IE015                     │
│   Transaction Type: IMPORT           │
│                                      │
│ [Cancel]     [Create Filing]        │
└──────────────────────────────────────┘
  │
  ↓
POST /api/filing {
  shipmentId,
  country: "NL",
  procedureCode: "5100",
  messageName: "IE015"
}
  │
  ↓
CustomsFiling Created:
  country: "NL"             ✅
  procedureCode: "5100"     ✅
  messageName: "IE015"      ✅
  transactionTypeId: "xxx"  ✅
  localReferenceNumber: entryNumber  ✅
  │
  ↓
Redirect to /app/filing/{id}
  │
  ↓
Declaration Form Loads Successfully ✅
(Has country, procedure, message)
```

---

## 📁 Files to Modify

1. ✅ **`src/app/app/filing/ShipmentFilingModal.tsx`** - Already created
2. **`src/app/app/filing/CreateFilingPrompt.tsx`** - Replace with modal approach
3. **`src/app/api/filing/route.ts`** - Accept country/procedure/message, look up transactionTypeId
4. **`src/app/app/filing/page.tsx`** - Pass destinationCountry to CreateFilingPrompt (already has it at line 86)

---

## 🧪 Testing

### Test Case 1: Create Filing from Shipment
1. Navigate to shipment with destinationCountry = "NL"
2. Click link to `/app/filing?shipmentId=X`
3. **Verify**: ShipmentFilingModal opens
4. **Verify**: Country field shows "NL" (pre-filled)
5. **Verify**: Procedure dropdown shows options for NL
6. Select "5100 - IE015"
7. Click "Create Filing"
8. **Verify**: Filing created with country=NL, procedureCode=5100, messageName=IE015
9. **Verify**: Redirects to filing detail page
10. **Verify**: Declaration form loads (has all required fields)

---

**Documentation Created**: 2026-08-16 23:35 IST
