# Shipment-Based Filing Creation - Country/Procedure/Message Selection

**Date**: 2026-08-16  
**Issue**: When creating a filing from a shipment, the system doesn't properly determine Country, Procedure Code, and Message Name

---

## 🚨 Current State (INCOMPLETE)

### What Happens Now

When you create a filing from a shipment (`POST /api/filing` with `shipmentId`):

**File**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 394-525)

```typescript
// 1. Get country from shipment
const destinationCountry = shipment.destinationCountry;  // ✅ Works

// 2. Get entry type from shipment
const declaredEntryType = entryType || shipment.entryType;  // ⚠️ US-centric legacy field

// 3. Create filing
filing = await db.customsFiling.create({
  data: {
    country: destinationCountry,           // ✅ Set
    procedureCode: null,                   // ❌ NULL
    messageName: null,                     // ❌ NULL
    entryType: entryTypeCode,              // ⚠️ Legacy US field
    transactionTypeId: null,               // ❌ NULL
    // ...
  }
});
```

---

## ❌ The Problem

### Missing Data

| Field | Current Value | What It Should Be |
|-------|--------------|-------------------|
| **country** | ✅ `shipment.destinationCountry` | Correct |
| **procedureCode** | ❌ `null` | Should be determined from shipment or config |
| **messageName** | ❌ `null` | Should be determined from procedure |
| **transactionTypeId** | ❌ `null` | Should be looked up from procedure |
| **entryType** | ⚠️ `shipment.entryType` (legacy) | Should be replaced by procedureCode |

### Impact

When a filing is created from a shipment:
1. ❌ **Cannot display Declaration form**: DynamicFormRenderer requires country + procedureCode + messageName
2. ❌ **Cannot transmit**: Transmission requires valid procedure configuration
3. ⚠️ **Manual workaround needed**: User must somehow set these values before proceeding

---

## 📋 TODO Comment from Code

**Line 446-455**:
```typescript
// ========================================================================
// TODO: MULTI-COUNTRY MIGRATION - This validation needs to be redesigned
// ========================================================================
// The old US-centric validation checked FilingProcedureMapping (dropped table)
// and FilingAuthorityConfig (dropped table). For now, we skip these checks
// to allow the server to start. Proper multi-country validation should:
// 1. Require transactionType, country, procedureCode in request
// 2. Validate against FilingProcedureConfig
// 3. Look up transactionTypeId from FilingTransactionType
// ========================================================================
```

---

## 🎯 What Should Happen

### Option 1: Store Procedure/Message on Shipment

Add fields to `Shipment` table:
```prisma
model Shipment {
  // ...existing fields...
  destinationCountry String?
  procedureCode      String?  // e.g., "5100", "4000", "H1"
  messageName        String?  // e.g., "IE015", "IE013"
}
```

**Flow**:
1. User creates/edits shipment
2. User selects destination country (already exists)
3. User selects procedure code (NEW - based on country)
4. User selects message name (NEW - based on procedure)
5. When creating filing from shipment, copy these values

**Pros**:
- ✅ Explicit user selection
- ✅ Stored at shipment level (reusable for multiple filings)
- ✅ User can change per shipment

**Cons**:
- ❌ Requires UI changes to shipment form
- ❌ Additional fields to maintain

---

### Option 2: Derive from Country + Default Rules

Use country to determine default procedure and message:

```typescript
// Get default procedure for country
const defaultProcedure = await db.filingProcedureConfig.findFirst({
  where: {
    country: destinationCountry,
    isActive: true,
    isDefault: true,  // ← NEW flag needed
  },
  include: {
    transactionType: true,
  },
});

filing = await db.customsFiling.create({
  data: {
    country: destinationCountry,
    procedureCode: defaultProcedure.procedureCode,
    messageName: defaultProcedure.messageName,
    transactionTypeId: defaultProcedure.transactionTypeId,
    // ...
  }
});
```

**Pros**:
- ✅ No shipment schema changes
- ✅ Automatic selection based on country
- ✅ Can be overridden later in filing UI

**Cons**:
- ❌ Requires `isDefault` flag in FilingProcedureConfig
- ❌ May not be correct default for all shipments
- ⚠️ User must manually change if wrong

---

### Option 3: Prompt User During Filing Creation

Show modal/wizard when creating filing from shipment:

```
User clicks "Create Filing" from shipment
  ↓
Modal opens:
  Country: [NL] (from shipment, read-only)
  Procedure: [Dropdown with procedures for NL]
  Message: [Dropdown with messages for selected procedure]
  [Cancel] [Create]
  ↓
Create filing with selected values
```

**Pros**:
- ✅ User explicitly chooses
- ✅ No shipment schema changes
- ✅ Always correct for user's intent

**Cons**:
- ❌ Extra step for user
- ❌ UI/UX changes needed

---

## 🔍 Current Workaround

**For Standalone Filings** (no shipment):
- ✅ User selects Country, Procedure, Message in NewFilingModal
- ✅ Filing created with all values
- ✅ Declaration form works immediately

**For Shipment-Based Filings**:
- ❌ Filing created with null procedureCode/messageName
- ❌ Declaration form cannot load
- ⚠️ **Workaround**: User must manually update filing record in database or via API

---

## 💡 Recommended Solution

**Hybrid Approach**: Option 2 + Manual Override

### Phase 1: Auto-Select Default
1. Add `isDefault` flag to `FilingProcedureConfig`
2. When creating filing from shipment, look up default procedure for country
3. Set procedureCode, messageName, transactionTypeId from default
4. User can proceed immediately with declaration form

### Phase 2: Allow Override
1. Add UI in Filing Detail page to change procedure/message
2. User can override if default is wrong
3. Re-generate declaration form with new schema

### Implementation Steps

**1. Update Schema**:
```sql
ALTER TABLE "FilingProcedureConfig" 
ADD COLUMN "isDefault" BOOLEAN DEFAULT false;

-- Set defaults (example)
UPDATE "FilingProcedureConfig" 
SET "isDefault" = true 
WHERE country = 'NL' AND procedureCode = '5100';
```

**2. Update Filing Creation** (`src/app/api/filing/route.ts`):
```typescript
// After getting destinationCountry
const defaultConfig = await db.filingProcedureConfig.findFirst({
  where: {
    country: destinationCountry,
    isActive: true,
    isDefault: true,
  },
  include: { transactionType: true },
});

if (!defaultConfig) {
  return NextResponse.json({
    error: `No default filing procedure configured for ${destinationCountry}. Please configure a default procedure first.`
  }, { status: 400 });
}

filing = await db.customsFiling.create({
  data: {
    // ...
    country: destinationCountry,
    procedureCode: defaultConfig.procedureCode,
    messageName: defaultConfig.messageName,
    transactionTypeId: defaultConfig.transactionTypeId,
    localReferenceNumber: entryNumber,  // ← Default to entry number
    // ...
  }
});
```

**3. Add UI Override** (Future):
```typescript
// In FilingDetailClient.tsx
<Select
  label="Procedure Code"
  value={filing.procedureCode}
  onChange={handleProcedureChange}
  disabled={filing.filingStatus !== "Draft"}
>
  {procedures.map(proc => (
    <option value={proc.procedureCode}>{proc.procedureCode}</option>
  ))}
</Select>
```

---

## 📊 Comparison: Standalone vs Shipment-Based

| Aspect | Standalone Filing | Shipment-Based Filing |
|--------|------------------|---------------------|
| **Country** | User selects in modal | ✅ From `shipment.destinationCountry` |
| **Procedure** | User selects in modal | ❌ **NULL** (needs fix) |
| **Message** | User selects in modal | ❌ **NULL** (needs fix) |
| **Entry Number** | Auto-generated | Auto-generated from shipment |
| **LocalReferenceNumber** | Defaults to entry number | Should default to entry number |
| **Declaration Form** | ✅ Works immediately | ❌ Cannot load (missing procedure/message) |

---

## 🧪 Test Scenarios

### Test Case 1: Create Filing from Shipment (Current State)
1. Create shipment with `destinationCountry = "NL"`
2. Click "Create Filing"
3. Filing created
4. **Verify**: `country = "NL"`, `procedureCode = null`, `messageName = null`
5. Open filing detail page
6. **Verify**: Declaration tab shows error: "Unable to load declaration form"

### Test Case 2: Create Filing from Shipment (After Fix)
1. Add default procedure: NL → 5100 → IE015
2. Create shipment with `destinationCountry = "NL"`
3. Click "Create Filing"
4. Filing created
5. **Verify**: `country = "NL"`, `procedureCode = "5100"`, `messageName = "IE015"`
6. Open filing detail page
7. **Verify**: Declaration form loads successfully
8. **Verify**: LocalReferenceNumber defaults to entry number

---

## 🔗 Related Files

- **API Route**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 394-525)
- **Shipment Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (line 392)
- **Filing Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (line 857)
- **Procedure Config**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (search for FilingProcedureConfig)

---

## 📖 Related Documentation

- [Local Reference Number Feature](./LOCAL-REFERENCE-NUMBER-FEATURE.md)
- [Entry Number Generation](./ENTRY-NUMBER-GENERATION-EXPLAINED.md)
- [Filing Auto-Save Fix](./FILING-AUTO-SAVE-FIX.md)

---

**Documentation Created**: 2026-08-16 23:25 IST

## Summary

**Current Issue**: When creating a filing from a shipment, `procedureCode` and `messageName` are set to NULL, making the declaration form unusable.

**Recommended Fix**: Add `isDefault` flag to `FilingProcedureConfig` and auto-select default procedure based on country.
