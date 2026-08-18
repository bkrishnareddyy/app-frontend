# Filing Auto-Save Fix - No More Automatic Creation

**Date**: 2026-08-16  
**Issue**: Filings were being created immediately on clicking "New Filing" wizard, appearing on dashboard before user filled out any data or clicked "Save Draft".

**Solution**: Changed behavior to ONLY create filing when user explicitly clicks "Save Draft" or "Transmit to Customs".

---

## 🎯 What Changed

### OLD Behavior (❌ Confusing)

```
User Journey:
1. Click "New Filing" button
2. Select Country, Procedure, Message
3. Click "Create"
   → 💾 Filing record CREATED in database immediately
   → Status: "Draft"
   → Appears on dashboard
   → Redirects to /app/filing/{id}
4. User sees empty declaration form
5. User fills in fields
6. User clicks "Save Draft"
   → 💾 Declaration data saved to existing filing
```

**Problem**: Filing appears on dashboard before user has entered ANY data!

---

### NEW Behavior (✅ Correct)

```
User Journey:
1. Click "New Filing" button
2. Select Country, Procedure, Message
3. Click "Create"
   → ⚡ NO database call
   → Redirects to /app/filing/new?country=X&procedure=Y&message=Z
4. User sees empty declaration form with "Draft (Unsaved)" badge
5. User fills in fields
6. User clicks "Save Draft" OR "Transmit to Customs"
   → 💾 Filing record CREATED with declaration data
   → Entry number generated
   → NOW appears on dashboard
   → Redirects to /app/filing/{id}
```

**Result**: Filing only appears on dashboard AFTER user explicitly saves!

---

## 📝 Files Changed

### 1. NewFilingModal.tsx

**Before**:
```typescript
async function handleCreate() {
  // POST /api/filing - creates filing immediately
  const res = await fetch("/api/filing", {
    method: "POST",
    body: JSON.stringify({
      country,
      procedureCode,
      messageName,
      standalone: true,
    }),
  });
  
  router.push(`/app/filing/${data.filing.id}`);
}
```

**After**:
```typescript
function handleCreate() {
  // No API call - just redirect with URL params
  const params = new URLSearchParams({
    country: selectedCountry,
    procedure: selectedOption.procedureCode,
    message: selectedOption.messageName,
    transactionType: selectedOption.transactionType || '',
  });

  router.push(`/app/filing/new?${params.toString()}`);
  onClose();
}
```

**Changes**:
- ✅ Removed `async` (no longer making API call)
- ✅ Removed `setSubmitting` state (no longer needed)
- ✅ Removed `try/catch` (no network request)
- ✅ Redirects to `/app/filing/new` with query params instead of `/app/filing/{id}`

---

### 2. NEW: /app/filing/new/page.tsx + FilingNewClient.tsx

**Purpose**: Display declaration form without creating database record yet.

**Key Features**:
- ✅ Reads country/procedure/message from URL params
- ✅ Shows "Draft (Unsaved)" badge (not just "Draft")
- ✅ Displays declaration form using DynamicFormRenderer
- ✅ Collects all form data in React state (no auto-save)
- ✅ "Save Draft" button creates filing with ALL data at once
- ✅ "Transmit to Customs" button creates filing AND transmits immediately

**Save Draft Handler**:
```typescript
async function handleSaveDraft() {
  // Create filing with declaration data in ONE API call
  const res = await fetch("/api/filing", {
    method: "POST",
    body: JSON.stringify({
      country,
      procedureCode: procedure,
      messageName: message,
      standalone: true,
      declarationData,  // ← All form data included
    }),
  });
  
  // Redirect to the created filing
  router.push(`/app/filing/${data.filing.id}`);
}
```

**Transmit Handler**:
```typescript
async function handleTransmit() {
  // Step 1: Create filing
  const createRes = await fetch("/api/filing", { ... });
  
  // Step 2: Transmit it
  const transmitRes = await fetch(`/api/filing/${createData.filing.id}/transmit`, { ... });
  
  // Redirect to the filing
  router.push(`/app/filing/${createData.filing.id}`);
}
```

---

### 3. POST /api/filing/route.ts

**Changes**: Now accepts optional `declarationData` parameter.

**Before**:
```typescript
const filing = await db.customsFiling.create({
  data: {
    accountId: ctx.accountId,
    entryNumber: standaloneEntryNumber,
    country,
    procedureCode,
    messageName,
    filingStatus: "Draft",
    // ... other fields
  },
});
```

**After**:
```typescript
const filing = await db.customsFiling.create({
  data: {
    accountId: ctx.accountId,
    entryNumber: standaloneEntryNumber,
    country,
    procedureCode,
    messageName,
    filingStatus: "Draft",
    // ... other fields
    // If declarationData is provided, save it immediately
    dutyBreakdown: declarationData ? { declarationDraft: declarationData } : null,
  },
});
```

**Why**: Allows filing to be created with declaration data in ONE database transaction.

---

## 🎨 Visual Comparison

### OLD Flow (Confusing)

```
┌─────────────────────────┐
│ Click "New Filing"      │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ Select Options          │
│ Click "Create"          │
└───────────┬─────────────┘
            │
            │ 📡 POST /api/filing
            │
┌───────────▼─────────────┐
│ 💾 Filing Created       │  ← PROBLEM: Created before user enters data
│ Entry: NL-5100-XXX      │
│ Status: Draft           │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ ✅ Shows on Dashboard   │  ← Appears immediately!
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ Declaration Form        │
│ (Empty - not saved yet) │
└─────────────────────────┘
```

### NEW Flow (Correct)

```
┌─────────────────────────┐
│ Click "New Filing"      │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ Select Options          │
│ Click "Create"          │
└───────────┬─────────────┘
            │
            │ ⚡ NO API call
            │
┌───────────▼─────────────┐
│ Redirect to /new        │
│ with URL params         │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ Declaration Form        │
│ Badge: "Draft (Unsaved)"│  ← Clear indicator: not saved yet
│ User fills fields       │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ Click "Save Draft"      │
└───────────┬─────────────┘
            │
            │ 📡 POST /api/filing
            │ (with declarationData)
            │
┌───────────▼─────────────┐
│ 💾 Filing Created       │  ← Created WITH data
│ Entry: NL-5100-XXX      │
│ Status: Draft           │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ ✅ NOW Shows on Dashboard│  ← Only appears AFTER save
└─────────────────────────┘
```

---

## ✅ Benefits

### 1. No "Ghost" Filings
- **Before**: User creates filing, doesn't fill form, closes browser → Empty draft on dashboard
- **After**: User can't create filing without explicitly saving → Clean dashboard

### 2. Clear Status
- **Before**: Badge says "Draft" even when nothing is saved
- **After**: Badge says "Draft (Unsaved)" until user clicks Save Draft

### 3. Intentional Action
- **Before**: Clicking "Create" in wizard saves to database (unexpected)
- **After**: Only "Save Draft" and "Transmit" create database records (expected)

### 4. Atomic Creation
- **Before**: Filing created without data, data saved separately (2 operations)
- **After**: Filing created WITH data in one transaction (1 operation)

---

## 🔧 Technical Details

### URL Parameter Format

```
/app/filing/new?country=NL&procedure=5100&message=IE015&transactionType=import
```

**Parameters**:
- `country`: ISO country code (e.g., "NL", "US", "GB")
- `procedure`: Procedure code (e.g., "5100", "E1", "H4")
- `message`: Message name (e.g., "IE015", "IE013")
- `transactionType`: Optional transaction type ("import" or "export")

### Database Transaction

**Single CREATE Operation**:
```sql
INSERT INTO "CustomsFiling" (
  accountId,
  entryNumber,
  country,
  procedureCode,
  messageName,
  filingStatus,
  dutyBreakdown,  -- Contains declarationDraft
  ...
) VALUES (
  'acc_123',
  'NL-5100-MSW2QEA8-1D25C8',
  'NL',
  '5100',
  'IE015',
  'Draft',
  '{"declarationDraft": {...}}',  -- ← Data included on creation
  ...
);
```

**Benefits**:
- ✅ Atomic: Filing and data created together
- ✅ Consistent: No partial state (filing without data)
- ✅ Efficient: One database round-trip instead of two

---

## 🧪 Testing Checklist

### Test Case 1: Create and Save Draft
1. Click "New Filing"
2. Select NL / 5100 / IE015
3. Click "Create"
4. **Verify**: Redirects to `/app/filing/new?country=NL&procedure=5100&message=IE015`
5. **Verify**: Badge shows "Draft (Unsaved)"
6. **Verify**: Dashboard shows NO new filing yet
7. Fill in declaration fields
8. Click "Save Draft"
9. **Verify**: Success message shows with entry number
10. **Verify**: Redirects to `/app/filing/{id}`
11. **Verify**: Dashboard NOW shows the filing
12. **Verify**: Filing status is "Draft"
13. **Verify**: Declaration data is saved

### Test Case 2: Create and Transmit
1. Click "New Filing"
2. Select NL / 5100 / IE015
3. Click "Create"
4. Fill in declaration fields
5. Click "Transmit to Customs"
6. **Verify**: Confirmation modal appears
7. Click "Confirm & Transmit"
8. **Verify**: Filing created AND transmitted
9. **Verify**: Status is "Submitted" (not "Draft")
10. **Verify**: Dashboard shows the filing

### Test Case 3: Abandon Without Saving
1. Click "New Filing"
2. Select options
3. Click "Create"
4. Fill in some fields
5. Click "Back to Filings" (without saving)
6. **Verify**: Dashboard shows NO new filing
7. **Verify**: No database record created
8. **Verify**: Clean state - no orphaned data

### Test Case 4: Missing URL Params
1. Navigate directly to `/app/filing/new` (no params)
2. **Verify**: Redirects to `/app/filing`
3. **Verify**: No error thrown
4. **Verify**: Clean redirect

---

## 📊 Impact Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Database writes on "Create"** | 1 (filing record) | 0 |
| **Dashboard pollution** | Immediate | Only after save |
| **Empty drafts created** | Yes | No |
| **User confusion** | High | Low |
| **Intentional save required** | No | Yes |
| **Status clarity** | "Draft" | "Draft (Unsaved)" |
| **API calls for new filing** | 2 (create + save) | 1 (create with data) |

---

## 🎓 Key Takeaways

1. **Wizard ≠ Save**: Clicking through a wizard should NOT persist data
2. **Explicit is Better**: User must explicitly click "Save" to persist
3. **Clear Indicators**: "Unsaved" badge makes state obvious
4. **Atomic Operations**: Create filing with data in one transaction
5. **URL as State**: Query params hold pre-save context without database

---

## 🔗 Related Files

- **NewFilingModal.tsx**: Updated to redirect instead of POST
- **NEW: /app/filing/new/page.tsx**: New route for unsaved drafts
- **NEW: /app/filing/new/FilingNewClient.tsx**: Form component for unsaved state
- **POST /api/filing/route.ts**: Updated to accept declarationData parameter

---

**Documentation Created**: 2026-08-16 23:05 IST
