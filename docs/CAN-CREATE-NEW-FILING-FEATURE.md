# canCreateNewFiling Field - Filter Operational Messages

**Date**: 2026-08-16  
**Feature**: Distinguish between initial filing messages and operational messages (amendments, cancellations, etc.)

---

## 🎯 Problem Statement

Not all message names in FilingProcedureConfig should be available when creating a new declaration:

- **Initial Filing Messages**: IE015 (NCTS Declaration), IE615 (Import Declaration), etc.
  - Should appear in New Filing modal
  - Should appear in Shipment Filing modal
  - Used to create brand new declarations

- **Operational Messages**: IE013 (Amendment), IE014 (Cancellation), IE517-IE520 (Queries), etc.
  - Should NOT appear in New Filing modal
  - Should NOT appear in Shipment Filing modal
  - Only used on existing filings for specific actions

**Issue**: Before this change, all active messages appeared in the dropdowns, confusing users and potentially allowing invalid filing creation.

---

## ✅ Solution Implemented

Added a **`canCreateNewFiling`** boolean field to `FilingProcedureConfig`:
- `true` = Message can be used to create new declarations (default)
- `false` = Message is operational only (amendments, cancellations, etc.)

---

## 📁 Files Modified

### 1. **prisma/schema.prisma**
**Changes**: Added `canCreateNewFiling` field to FilingProcedureConfig model

```prisma
model FilingProcedureConfig {
  id                String                 @id @default(cuid())
  transactionTypeId String
  transactionType   FilingTransactionType  @relation(fields: [transactionTypeId], references: [id], onDelete: Cascade)
  country           String                 // ISO 3166-1 alpha-2 (NL, IE, FR, IN, etc.)
  procedureCode     String                 // Country-specific procedure code (5100, 4000, etc.)
  messageName       String                 // Official customs message code (IE015, IE013, ICEGATE_BOE, etc.)
  canCreateNewFiling Boolean               @default(true) // NEW FIELD
  isActive          Boolean                @default(true)
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @updatedAt
  createdBy         String?
  updatedBy         String?

  @@unique([country, procedureCode, messageName])
  @@index([country, procedureCode])
  @@index([transactionTypeId])
  @@index([isActive])
  @@index([canCreateNewFiling])  // NEW INDEX
}
```

---

### 2. **Migration SQL**
**File**: `prisma/migrations/20260816233017_add_can_create_new_filing_to_procedure_config/migration.sql`

```sql
-- AlterTable
ALTER TABLE "FilingProcedureConfig" 
ADD COLUMN "canCreateNewFiling" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "FilingProcedureConfig_canCreateNewFiling_idx" 
ON "FilingProcedureConfig"("canCreateNewFiling");

-- Update existing records: Set common amendment/cancellation messages to false
UPDATE "FilingProcedureConfig" SET "canCreateNewFiling" = false 
WHERE "messageName" IN ('IE013', 'IE014', 'IE517', 'IE518', 'IE519', 'IE520');
```

**Automatically Updated Messages**:
- `IE013` - Amendment message → `canCreateNewFiling = false`
- `IE014` - Cancellation message → `canCreateNewFiling = false`
- `IE517-IE520` - Query/Response messages → `canCreateNewFiling = false`

---

### 3. **API Endpoint**
**File**: `src/app/api/filing/procedures/route.ts`  
**Changes**: Added filter to only return procedures where `canCreateNewFiling = true`

**Before**:
```typescript
const procedures = await db.filingProcedureConfig.findMany({
  where: { isActive: true },  // Only checked if active
  // ...
});
```

**After**:
```typescript
const procedures = await db.filingProcedureConfig.findMany({
  where: { 
    isActive: true,
    canCreateNewFiling: true,  // NEW: Only include messages for new filings
  },
  // ...
});
```

---

## 🎨 User Impact

### Before (All Messages Shown)
```
New Filing Modal - Select Procedure & Message:
┌────────────────────────────────────────┐
│ Country: NL                            │
│                                        │
│ Procedure & Message:                   │
│ ┌────────────────────────────────────┐ │
│ │ 5100 - IE015 (IMPORT)             │ │ ✅ Valid
│ │ 5100 - IE013 (IMPORT)             │ │ ❌ Amendment only!
│ │ 5100 - IE014 (IMPORT)             │ │ ❌ Cancellation only!
│ │ 5100 - IE517 (IMPORT)             │ │ ❌ Query only!
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### After (Filtered Messages)
```
New Filing Modal - Select Procedure & Message:
┌────────────────────────────────────────┐
│ Country: NL                            │
│                                        │
│ Procedure & Message:                   │
│ ┌────────────────────────────────────┐ │
│ │ 5100 - IE015 (IMPORT)             │ │ ✅ Valid
│ │ 5200 - IE615 (IMPORT)             │ │ ✅ Valid
│ └────────────────────────────────────┘ │
│                                        │
│ (Amendment/Cancellation messages       │
│  are hidden from this list)            │
└────────────────────────────────────────┘
```

---

## 🗄️ Database Configuration

### Setting canCreateNewFiling for New Messages

When adding new messages to FilingProcedureConfig, set `canCreateNewFiling` appropriately:

**Initial Filing Messages** (set `true`):
```sql
INSERT INTO "FilingProcedureConfig" (
  "transactionTypeId", 
  "country", 
  "procedureCode", 
  "messageName", 
  "canCreateNewFiling",  -- ✅ true for initial filings
  "isActive"
)
VALUES (
  '<transaction-type-id>',
  'NL',
  '5100',
  'IE015',
  true,  -- Can create new filing
  true
);
```

**Operational Messages** (set `false`):
```sql
INSERT INTO "FilingProcedureConfig" (
  "transactionTypeId", 
  "country", 
  "procedureCode", 
  "messageName", 
  "canCreateNewFiling",  -- ❌ false for amendments/cancellations
  "isActive"
)
VALUES (
  '<transaction-type-id>',
  'NL',
  '5100',
  'IE013',  -- Amendment message
  false,     -- Cannot create new filing
  true
);
```

---

## 📊 Common Message Types

### Initial Filing Messages (canCreateNewFiling = true)

| Message | Description | Country | Procedure |
|---------|-------------|---------|-----------|
| IE015 | NCTS Declaration | EU | 5100 |
| IE615 | Import Declaration | EU | Various |
| ICEGATE_BOE | Bill of Entry | IN | 4000 |
| CHIEF_C1600 | Import Entry | GB | 1200 |

### Operational Messages (canCreateNewFiling = false)

| Message | Description | Purpose |
|---------|-------------|---------|
| IE013 | Amendment | Modify existing filing |
| IE014 | Cancellation | Cancel existing filing |
| IE517 | Query Request | Request information |
| IE518 | Query Response | Provide information |
| IE519 | Status Request | Request status |
| IE520 | Status Response | Provide status |

---

## 🔄 Migration Applied

**Migration**: `20260816233017_add_can_create_new_filing_to_procedure_config`  
**Status**: ✅ Applied successfully  
**Date**: 2026-08-16 23:30 IST

**Changes**:
1. ✅ Added `canCreateNewFiling` column (default: `true`)
2. ✅ Created index on `canCreateNewFiling`
3. ✅ Updated existing amendment/cancellation messages to `false`
4. ✅ Generated Prisma client with new field

---

## 🧪 Testing

### Test 1: New Filing Modal Shows Only Valid Messages
**Steps**:
1. Open New Filing modal
2. Select country "NL"
3. View procedure & message dropdown
4. **Verify**: Only shows IE015, IE615, etc. (initial filing messages)
5. **Verify**: Does NOT show IE013, IE014, IE517-520 (operational messages)

### Test 2: Shipment Filing Modal Shows Only Valid Messages
**Steps**:
1. Navigate to `/app/filing?shipmentId=X`
2. Modal opens with country pre-filled
3. View procedure & message dropdown
4. **Verify**: Only shows initial filing messages
5. **Verify**: Does NOT show operational messages

### Test 3: API Returns Filtered Messages
**Steps**:
1. Call `GET /api/filing/procedures`
2. **Verify**: Response only contains procedures with `canCreateNewFiling = true`
3. **Verify**: IE013, IE014, IE517-520 are NOT in response

### Test 4: Database Configuration
**Steps**:
```sql
-- Check that operational messages have canCreateNewFiling = false
SELECT messageName, canCreateNewFiling, isActive
FROM "FilingProcedureConfig"
WHERE messageName IN ('IE013', 'IE014', 'IE517', 'IE518', 'IE519', 'IE520');

-- Expected: All should have canCreateNewFiling = false
```

### Test 5: Manual Configuration Update
**Steps**:
```sql
-- Add a new operational message
INSERT INTO "FilingProcedureConfig" (
  "id", "transactionTypeId", "country", "procedureCode", 
  "messageName", "canCreateNewFiling", "isActive"
)
VALUES (
  'test-id', 'some-transaction-type', 'NL', '5100',
  'IE999',  -- Test message
  false,    -- Operational only
  true
);

-- Verify it doesn't appear in New Filing modal
```

---

## 🎉 Success Criteria

Feature is complete when:

1. ✅ `canCreateNewFiling` field added to FilingProcedureConfig
2. ✅ Migration applied successfully
3. ✅ API filters by `canCreateNewFiling = true`
4. ✅ NewFilingModal shows only valid initial filing messages
5. ✅ ShipmentFilingModal shows only valid initial filing messages
6. ✅ Operational messages (IE013, IE014, etc.) are hidden
7. ✅ Database has correct values for existing messages

---

## 📝 Configuration Guide for Admins

### When to Set canCreateNewFiling = true
- Message is used to create a brand new declaration
- Examples: IE015 (NCTS), IE615 (Import), ICEGATE_BOE

### When to Set canCreateNewFiling = false
- Message is used for actions on existing filings
- Examples:
  - Amendments (IE013)
  - Cancellations (IE014)
  - Queries (IE517-520)
  - Status requests
  - Notifications
  - Acknowledgements

### Default Behavior
- New messages default to `canCreateNewFiling = true`
- Explicitly set to `false` for operational messages

---

**Documentation Created**: 2026-08-16 23:35 IST  
**Implementation Status**: ✅ Complete  
**Testing Status**: Ready for QA
