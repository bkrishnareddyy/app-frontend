# Local Reference Number and Registration Number Fields

**Date**: 2026-08-16  
**Feature**: Added LocalReferenceNumber and RegistrationNumber fields to CustomsFiling with UI and canonical schema mapping

---

## 🎯 What Was Added

### 1. **Database Fields**

Added two new fields to `CustomsFiling` table:

```prisma
model CustomsFiling {
  // ...existing fields...
  
  /// Local Reference Number - User-provided reference for this filing (mandatory)
  localReferenceNumber String?
  
  /// Registration Number - User-provided registration/license number
  registrationNumber String?
}
```

**Migration**: `20260816231102_add_local_reference_and_registration_number`

---

### 2. **UI Fields**

Added input fields below Filing Information section and above the tabs in Filing Detail page.

**Location**: [`FilingDetailClient.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/[id]/FilingDetailClient.tsx)

**Features**:
- ✅ **Local Reference Number**: Mandatory field (marked with red asterisk)
- ✅ **Registration Number**: Optional field
- ✅ **Default Value**: LocalReferenceNumber defaults to `entryNumber`
- ✅ **Editable**: User can change the default value
- ✅ **Disabled State**: Fields disabled when filing is Transmitted or Accepted
- ✅ **Validation**: LocalReferenceNumber required for Save Draft and Transmit

**UI Screenshot Layout**:
```
┌─────────────────────────────────────────────────────┐
│ Filing Information                                  │
│ Country: NL │ Procedure: 5100 │ Message: IE015     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Local Reference Number *    │ Registration Number  │
│ [NL-5100-MSW2QEA8-1D25C8]   │ [                  ] │
│ Defaults to entry number.    │ Optional registration│
│ Required for save/transmit.  │ or license number.  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ [Overview] [Declaration] [Response]                 │
└─────────────────────────────────────────────────────┘
```

---

### 3. **Validation**

**Save Draft** and **Transmit** handlers now validate:
- LocalReferenceNumber must not be empty
- Shows error: "Local Reference Number is required"

**Code**:
```typescript
// Validate local reference number is provided
if (!localReferenceNumber || localReferenceNumber.trim() === '') {
  setError('Local Reference Number is required');
  return;
}
```

---

### 4. **API Updates**

**PATCH /api/filing/[id]** now accepts and saves these fields:

```typescript
const { localReferenceNumber, registrationNumber } = body;

// Update fields
if (localReferenceNumber !== undefined) {
  updateData.localReferenceNumber = localReferenceNumber;
}

if (registrationNumber !== undefined) {
  updateData.registrationNumber = registrationNumber;
}
```

---

### 5. **Canonical Schema Mapping**

Both Import and Export declarations now map these fields:

**Import Declaration**:
```typescript
{
  "ImportDeclaration": {
    "GoodsDeclaration": {
      "ReferenceNumber": localReferenceNumber || filingId,
      "EntryNumber": entryNumber,
      "DeclarationNumber": shipmentNumber,
      "RegistrationNumber": registrationNumber
    }
  }
}
```

**Export Declaration**:
```typescript
{
  "ExportDeclaration": {
    "GoodsDeclaration": {
      "ReferenceNumber": localReferenceNumber || filingId,
      "EntryNumber": entryNumber,
      "DeclarationNumber": shipmentNumber,
      "RegistrationNumber": registrationNumber
    }
  }
}
```

---

## 📊 Field Mapping Summary

| Canonical Field | Source | Default | User Editable | Required |
|----------------|--------|---------|---------------|----------|
| **ReferenceNumber** | `localReferenceNumber` or `filingId` | `entryNumber` | Yes | Yes (for save/transmit) |
| **EntryNumber** | `entryNumber` | Auto-generated | No | Yes (system-generated) |
| **DeclarationNumber** | `shipmentNumber` | From shipment | No | No (null for standalone) |
| **RegistrationNumber** | `registrationNumber` | Empty | Yes | No |

---

## 🎨 User Flow

### Creating New Filing

1. User clicks "New Filing" → Selects country/procedure/message
2. Redirects to `/app/filing/new` (no DB record yet)
3. User sees empty declaration form
4. User clicks "Save Draft"
   - LocalReferenceNumber defaults to entryNumber (e.g., `NL-5100-MSW2QEA8-1D25C8`)
   - User can change it before saving
   - Validation: LocalReferenceNumber required
   - Filing created with localReferenceNumber

### Editing Existing Filing

1. User opens existing filing at `/app/filing/{id}`
2. LocalReferenceNumber field shows:
   - Saved value if previously set
   - Entry number if never set
3. User can edit LocalReferenceNumber
4. User can edit RegistrationNumber
5. Click "Save Draft" → Validates and saves
6. Click "Transmit" → Validates, saves, and transmits

---

## 🔍 Data Flow

### At Save Draft

```
User enters/edits fields
  ↓
Validation: LocalReferenceNumber required
  ↓
PATCH /api/filing/{id}
  {
    localReferenceNumber: "NL-5100-MSW2QEA8-1D25C8",
    registrationNumber: "REG123456"
  }
  ↓
CustomsFiling.update()
  ↓
Success: "Declaration draft saved successfully!"
```

### At Transmission

```
User clicks "Transmit to Customs"
  ↓
Validation: LocalReferenceNumber required
  ↓
1. Save reference numbers (PATCH /api/filing/{id})
  ↓
2. Transmit filing (POST /api/filing/{id}/transmit)
  ↓
Filing.service.ts → buildSnapshotAndPublish()
  ↓
buildCanonicalDeclaration() called with:
  {
    filingId,
    snapshotData,
    localReferenceNumber: filing.localReferenceNumber,  ← From CustomsFiling record
    registrationNumber: filing.registrationNumber       ← From CustomsFiling record
  }
  ↓
importDeclarationBuilder.ts / exportDeclarationBuilder.ts
  ↓
GoodsDeclaration: {
  ReferenceNumber: localReferenceNumber || filingId,
  EntryNumber: entryNumber,
  DeclarationNumber: shipmentNumber,
  RegistrationNumber: registrationNumber
}
  ↓
Canonical message transmitted to customs
```

**Note**: LocalReferenceNumber and RegistrationNumber are stored in `CustomsFiling` table, NOT in `FilingSnapshot`. They are passed directly to the builders from the filing record at transmission time.

---

## ✅ Examples

### Example 1: Standalone Filing with Default LocalReference

**Filing Created**:
```json
{
  "entryNumber": "NL-5100-MSW2QEA8-1D25C8",
  "localReferenceNumber": null,
  "registrationNumber": null
}
```

**User Saves** (default used):
```json
{
  "localReferenceNumber": "NL-5100-MSW2QEA8-1D25C8",
  "registrationNumber": ""
}
```

**Canonical Message**:
```json
{
  "ImportDeclaration": {
    "GoodsDeclaration": {
      "ReferenceNumber": "NL-5100-MSW2QEA8-1D25C8",
      "EntryNumber": "NL-5100-MSW2QEA8-1D25C8",
      "DeclarationNumber": null,
      "RegistrationNumber": null
    }
  }
}
```

---

### Example 2: User Changes LocalReference

**User Edits**:
```json
{
  "localReferenceNumber": "MY-CUSTOM-REF-2024-001",
  "registrationNumber": "REG-987654"
}
```

**Canonical Message**:
```json
{
  "ImportDeclaration": {
    "GoodsDeclaration": {
      "ReferenceNumber": "MY-CUSTOM-REF-2024-001",
      "EntryNumber": "NL-5100-MSW2QEA8-1D25C8",
      "DeclarationNumber": null,
      "RegistrationNumber": "REG-987654"
    }
  }
}
```

---

## 📝 Files Modified

### 1. Database Schema
- **prisma/schema.prisma** (lines 869-873)
  - Added `localReferenceNumber` field
  - Added `registrationNumber` field

### 2. Migration
- **prisma/migrations/20260816231102_add_local_reference_and_registration_number/migration.sql**
  ```sql
  ALTER TABLE "CustomsFiling" 
  ADD COLUMN "localReferenceNumber" TEXT,
  ADD COLUMN "registrationNumber" TEXT;
  ```

### 3. UI Component
- **src/app/app/filing/[id]/FilingDetailClient.tsx**
  - Added interface props (lines 32-33)
  - Added state management (lines 527-532)
  - Added UI fields (lines 962-988)
  - Updated save handlers (lines 721-754, 700-738)

### 4. API Route
- **src/app/api/filing/[id]/route.ts**
  - Added request body destructuring (line 227)
  - Added update logic (lines 251-257)

### 5. Service Layer
- **src/modules/filings/filing.service.ts**
  - Pass localReferenceNumber and registrationNumber to buildCanonicalDeclaration (lines 365-366)
  - Values loaded from filing record, NOT from snapshot

### 6. Builder Interfaces
- **src/lib/canonicalMessaging/declarationBuilder.ts**
  - Added localReferenceNumber and registrationNumber to BuildDeclarationParams
- **src/lib/canonicalMessaging/importDeclarationBuilder.ts**
  - Added parameters to BuildImportDeclarationParams interface
  - Map localReferenceNumber → ReferenceNumber (line 66)
  - Map registrationNumber → RegistrationNumber (line 69)
- **src/lib/canonicalMessaging/exportDeclarationBuilder.ts**
  - Added parameters to BuildExportDeclarationParams interface
  - Map localReferenceNumber → ReferenceNumber (line 66)
  - Map registrationNumber → RegistrationNumber (line 69)

---

## 🧪 Testing Checklist

### Test Case 1: Default Behavior
1. Create new filing
2. **Verify**: LocalReferenceNumber shows entry number by default
3. **Verify**: RegistrationNumber is empty
4. Save without changes
5. **Verify**: Saves successfully with default values

### Test Case 2: Custom Values
1. Create new filing
2. Change LocalReferenceNumber to custom value
3. Enter RegistrationNumber
4. Save draft
5. **Verify**: Custom values saved
6. Refresh page
7. **Verify**: Custom values persist

### Test Case 3: Validation
1. Create new filing
2. Clear LocalReferenceNumber
3. Click "Save Draft"
4. **Verify**: Error: "Local Reference Number is required"
5. Click "Transmit"
6. **Verify**: Error: "Local Reference Number is required for transmission"

### Test Case 4: Disabled State
1. Transmit a filing
2. **Verify**: LocalReferenceNumber and RegistrationNumber fields are disabled
3. Cannot edit after transmission

### Test Case 5: Canonical Mapping
1. Create filing with custom LocalReference and Registration
2. Transmit filing
3. Check buildCanonicalDeclaration call
4. **Verify**: localReferenceNumber and registrationNumber passed as parameters
5. Check canonical message
6. **Verify**: Mapped to GoodsDeclaration.ReferenceNumber and RegistrationNumber
7. **Verify**: FilingSnapshot does NOT contain these fields (they're from CustomsFiling)

---

## 🔗 Related Documentation

- [Entry Number Field Addition](./ENTRY-NUMBER-FIELD-ADDITION.md)
- [Entry Number Generation](./ENTRY-NUMBER-GENERATION-EXPLAINED.md)
- [Shipment to Canonical Field Mapping](./SHIPMENT-TO-CANONICAL-FIELD-MAPPING.md)

---

**Documentation Created**: 2026-08-16 23:15 IST
