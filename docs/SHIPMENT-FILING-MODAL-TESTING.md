# ShipmentFilingModal Integration - Complete Testing Guide

**Date**: 2026-08-16

---

## ✅ What Was Implemented

### 1. **ShipmentFilingModal Component** (Already Created)
- **File**: [`src/app/app/filing/ShipmentFilingModal.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/ShipmentFilingModal.tsx)
- **Features**:
  - Country selection (pre-filled from shipment)
  - Procedure & Message selection (loaded from FilingProcedureConfig)
  - Visual summary of selected configuration
  - Error handling and validation

### 2. **CreateFilingPrompt Component** (Updated)
- **File**: [`src/app/app/filing/CreateFilingPrompt.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/CreateFilingPrompt.tsx)
- **Changes**:
  - Removed old entry type dropdown
  - Replaced with ShipmentFilingModal
  - Modal opens automatically when component loads
  - Shows shipment summary card

### 3. **Filing Dashboard Page** (Updated)
- **File**: [`src/app/app/filing/page.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/page.tsx)
- **Changes**:
  - Passes `destinationCountry` to CreateFilingPrompt component
  - Removed `entryTypeOptions` prop (no longer needed)

### 4. **API Route** (Updated)
- **File**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 394-550)
- **Changes**:
  - Accepts `country`, `procedureCode`, `messageName` from request body
  - Uses provided values OR falls back to shipment defaults
  - Looks up `transactionTypeId` from FilingProcedureConfig
  - Sets `localReferenceNumber` to `entryNumber` by default
  - Saves all fields to CustomsFiling table

---

## 🎯 Complete User Flow

### Before (Old Flow - BROKEN)
```
User clicks link to /app/filing?shipmentId=X
  ↓
CreateFilingPrompt shows entry type dropdown (US-only)
  ↓
User clicks "Create Filing"
  ↓
API creates filing with:
  - country: ✅ From shipment
  - procedureCode: ❌ NULL
  - messageName: ❌ NULL
  - transactionTypeId: ❌ NULL
  ↓
Filing created but declaration form CANNOT LOAD
(Missing required fields for DynamicFormRenderer)
```

### After (New Flow - FIXED)
```
User clicks link to /app/filing?shipmentId=X
  ↓
CreateFilingPrompt opens ShipmentFilingModal automatically
  ↓
Modal shows:
  - Shipment summary (line items, value)
  - Country field (pre-filled with NL)
  - Procedure & Message dropdown (5100 - IE015, etc.)
  ↓
User selects procedure/message
  ↓
Modal shows configuration summary
  ↓
User clicks "Create Filing"
  ↓
API receives:
  {
    shipmentId: "xxx",
    country: "NL",
    procedureCode: "5100",
    messageName: "IE015"
  }
  ↓
API creates filing with:
  - country: ✅ "NL"
  - procedureCode: ✅ "5100"
  - messageName: ✅ "IE015"
  - transactionTypeId: ✅ Looked up from FilingProcedureConfig
  - localReferenceNumber: ✅ Defaults to entryNumber
  ↓
Redirect to /app/filing/{id}
  ↓
Declaration form loads successfully ✅
```

---

## 🧪 Testing Checklist

### Test 1: Basic Shipment Filing Creation
**Steps**:
1. Create a shipment with `destinationCountry = "NL"`
2. Navigate to `/app/filing?shipmentId=<shipmentId>`
3. **Verify**: Modal opens automatically
4. **Verify**: Country field shows "NL" (pre-filled)
5. **Verify**: Procedure dropdown is populated
6. Select "5100 - IE015 (IMPORT)"
7. **Verify**: Configuration summary shows correct details
8. Click "Create Filing"
9. **Verify**: No errors in console
10. **Verify**: Redirects to `/app/filing/{id}`
11. **Verify**: Filing has:
    - `country = "NL"`
    - `procedureCode = "5100"`
    - `messageName = "IE015"`
    - `transactionTypeId` is set (not null)
    - `localReferenceNumber = entryNumber`
12. **Verify**: Declaration form loads without errors

**Expected Result**: ✅ Filing created successfully with all fields populated

---

### Test 2: Modal Cancel Behavior
**Steps**:
1. Navigate to `/app/filing?shipmentId=<shipmentId>`
2. Modal opens
3. Click "Cancel" button
4. **Verify**: Modal closes
5. **Verify**: Redirects to `/app/filing` dashboard

**Expected Result**: ✅ Modal closes and redirects to dashboard

---

### Test 3: Missing Destination Country
**Steps**:
1. Create a shipment with `destinationCountry = null`
2. Navigate to `/app/filing?shipmentId=<shipmentId>`
3. **Verify**: Shows error message (from page.tsx lines 37-50)
4. **Verify**: Does NOT open modal
5. **Verify**: Shows link to set destination country

**Expected Result**: ✅ Error shown before modal opens

---

### Test 4: No Procedures Available
**Steps**:
1. Create a shipment with `destinationCountry = "XX"` (invalid)
2. Navigate to `/app/filing?shipmentId=<shipmentId>`
3. Modal opens
4. **Verify**: Country field shows "XX"
5. **Verify**: Procedure dropdown is empty or shows "No procedures available"
6. **Verify**: "Create Filing" button is disabled

**Expected Result**: ✅ User cannot create filing without valid procedure

---

### Test 5: Change Country in Modal
**Steps**:
1. Create shipment with `destinationCountry = "NL"`
2. Navigate to `/app/filing?shipmentId=<shipmentId>`
3. Modal opens with country = "NL"
4. Change country dropdown to "GB"
5. **Verify**: Procedure dropdown reloads with GB procedures
6. Select a GB procedure
7. Click "Create Filing"
8. **Verify**: Filing created with country = "GB" (not "NL")

**Expected Result**: ✅ Modal allows overriding shipment's default country

---

### Test 6: Multiple Procedures for Same Country
**Steps**:
1. Ensure FilingProcedureConfig has multiple entries for country "NL":
   - NL - 5100 - IE015
   - NL - 5200 - IE016
2. Create shipment with `destinationCountry = "NL"`
3. Navigate to `/app/filing?shipmentId=<shipmentId>`
4. **Verify**: Procedure dropdown shows both options
5. Select each and verify configuration summary updates

**Expected Result**: ✅ All procedures for selected country are available

---

### Test 7: LocalReferenceNumber Default Value
**Steps**:
1. Create filing from shipment using modal
2. Navigate to filing detail page
3. **Verify**: LocalReferenceNumber field shows the entry number
4. **Verify**: LocalReferenceNumber field is editable
5. Edit LocalReferenceNumber to "CUSTOM-REF-123"
6. Click "Save Draft"
7. **Verify**: Filing saved with `localReferenceNumber = "CUSTOM-REF-123"`

**Expected Result**: ✅ LocalReferenceNumber defaults correctly and is editable

---

### Test 8: TransactionTypeId Lookup
**Steps**:
1. Create filing with country="NL", procedure="5100", message="IE015"
2. Query database:
   ```sql
   SELECT * FROM CustomsFiling WHERE country='NL' AND procedureCode='5100';
   ```
3. **Verify**: `transactionTypeId` is not null
4. Query:
   ```sql
   SELECT * FROM FilingProcedureConfig 
   WHERE country='NL' AND procedureCode='5100' AND messageName='IE015';
   ```
5. **Verify**: `transactionTypeId` matches the filing's transactionTypeId

**Expected Result**: ✅ TransactionTypeId correctly looked up and stored

---

### Test 9: API Direct Call (No Modal)
**Steps**:
1. Call API directly with curl:
   ```bash
   curl -X POST http://localhost:3000/api/filing \
     -H "Content-Type: application/json" \
     -d '{
       "shipmentId": "test-shipment-id",
       "country": "NL",
       "procedureCode": "5100",
       "messageName": "IE015"
     }'
   ```
2. **Verify**: Response status = 200
3. **Verify**: Response contains filing with correct fields
4. **Verify**: Filing created in database

**Expected Result**: ✅ API accepts new fields and creates filing

---

### Test 10: API Fallback to Shipment Defaults
**Steps**:
1. Call API without country/procedure/message:
   ```bash
   curl -X POST http://localhost:3000/api/filing \
     -H "Content-Type: application/json" \
     -d '{
       "shipmentId": "test-shipment-id"
     }'
   ```
2. **Verify**: Response status = 200 (if shipment has destinationCountry)
3. **Verify**: Filing created with:
   - `country = shipment.destinationCountry`
   - `procedureCode = null`
   - `messageName = null`
4. **Verify**: Old behavior still works (backwards compatible)

**Expected Result**: ✅ API is backwards compatible

---

## 🐛 Known Issues / Edge Cases

### 1. **Shipment Without Destination Country**
- **Status**: ✅ Handled
- **Location**: [`page.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/page.tsx) (lines 37-50)
- **Behavior**: Shows error message before modal opens

### 2. **No FilingProcedureConfig for Country**
- **Status**: ✅ Handled
- **Location**: ShipmentFilingModal (lines 90-94)
- **Behavior**: Dropdown shows "No procedures available", button disabled

### 3. **TransactionTypeId Lookup Fails**
- **Status**: ⚠️ Logged as Warning
- **Location**: [`route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 426-437)
- **Behavior**: Console warning logged, filing still created with `transactionTypeId = null`
- **Impact**: Declaration form may fail to load if transactionTypeId is required

### 4. **Multiple Filings from Same Shipment**
- **Status**: ✅ Handled
- **Location**: [`page.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/page.tsx) (lines 25-29)
- **Behavior**: Redirects to existing non-terminal filing if one exists

---

## 📊 Database Verification Queries

### Check Filing Created with All Fields
```sql
SELECT 
  entryNumber,
  country,
  procedureCode,
  messageName,
  transactionTypeId,
  localReferenceNumber,
  filingStatus,
  createdAt
FROM CustomsFiling
WHERE shipmentId = '<your-shipment-id>'
ORDER BY createdAt DESC
LIMIT 1;
```

### Check Procedure Config Exists
```sql
SELECT 
  id,
  country,
  procedureCode,
  messageName,
  transactionTypeId,
  isActive
FROM FilingProcedureConfig
WHERE country = 'NL'
  AND procedureCode = '5100'
  AND messageName = 'IE015';
```

### Check Transaction Type
```sql
SELECT 
  fpc.country,
  fpc.procedureCode,
  fpc.messageName,
  ftt.code AS transactionTypeCode,
  ftt.name AS transactionTypeName
FROM FilingProcedureConfig fpc
JOIN FilingTransactionType ftt ON fpc.transactionTypeId = ftt.id
WHERE fpc.country = 'NL';
```

---

## 🎉 Success Criteria

All tests pass when:

1. ✅ Modal opens automatically when navigating to `/app/filing?shipmentId=X`
2. ✅ Country is pre-filled from shipment's destinationCountry
3. ✅ Procedure dropdown loads options from FilingProcedureConfig
4. ✅ Configuration summary shows selected values correctly
5. ✅ Filing is created with country, procedureCode, messageName, transactionTypeId
6. ✅ LocalReferenceNumber defaults to entryNumber
7. ✅ Declaration form loads successfully after filing creation
8. ✅ Modal can be cancelled, redirects to dashboard
9. ✅ API is backwards compatible (works without new fields)
10. ✅ Error handling works for missing data

---

## 📝 Files Modified Summary

| File | Changes | Status |
|------|---------|--------|
| ShipmentFilingModal.tsx | Created new modal component | ✅ Complete |
| CreateFilingPrompt.tsx | Replaced entry type dropdown with modal | ✅ Complete |
| page.tsx | Pass destinationCountry to component | ✅ Complete |
| route.ts (POST /api/filing) | Accept and use country/procedure/message | ✅ Complete |

---

**Testing Document Created**: 2026-08-16 23:45 IST
