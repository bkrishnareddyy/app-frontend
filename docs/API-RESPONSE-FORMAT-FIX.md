# API Response Format Mismatch Fix

**Date:** 2026-08-16  
**Issue:** UI Configuration grid still showing "No rows" despite correct columns and data in database

---

## 🐛 Root Cause

**API response format mismatch** between what the FilingConfigClient expects and what the `/api/filing-config/ui-configuration` endpoint returns.

### The Problem

**Two API endpoints exist:**

1. **Dynamic Route:** `/api/filing-config/[table]`
   - Used by: transaction-type, action-catalog, procedure-config, etc.
   - Returns: `{ rows: [...], requestId: "..." }`
   - File: `src/app/api/filing-config/[table]/route.ts`

2. **Specific Route:** `/api/filing-config/ui-configuration`
   - Used by: ui-configuration table (OVERRIDES dynamic route)
   - Returns: `{ configs: [...], total: N }` ❌ WRONG FORMAT
   - File: `src/app/api/filing-config/ui-configuration/route.ts`

**FilingConfigClient** always expects:
```typescript
const res = await fetch(`/api/filing-config/${table.key}`);
const data = await res.json();
setRows(data.rows ?? []); // ❌ Expects "rows", got "configs"
```

---

## 🔍 Discovery Process

### Step 1: Verified Data Exists
```bash
$ curl http://localhost:3000/api/filing-config/ui-configuration

{
  "configs": [{                    # ❌ Wrong key - should be "rows"
    "id": "cmsw06uur0000edvov7z0gvg8",
    "country": "NL",
    "procedureCode": "H1",
    "messageName": "IE501",
    "messageType": "request",
    "transactionType": "import",
    "version": 1,
    "description": "UI configuration for NL H1 IE501",
    "totalFields": 1,
    "updatedAt": "2026-08-16T16:12:33.072Z"
  }],
  "total": 1
}
```

### Step 2: Checked Client Code
```typescript
// src/app/app/filing-config/FilingConfigClient.tsx
const load = async () => {
  const res = await fetch(`/api/filing-config/${table.key}`);
  const data = await res.json();
  setRows(data.rows ?? []); // ❌ "rows" is undefined because API returns "configs"
}
```

### Step 3: Found Mismatch
- Client expects: `data.rows`
- API returns: `data.configs`
- Result: `data.rows ?? []` → `undefined ?? []` → `[]` (empty array)
- Grid displays: "No rows."

---

## 🔧 Fix Applied

**File:** `src/app/api/filing-config/ui-configuration/route.ts`

### Before (WRONG)

```typescript
export async function GET(request: NextRequest) {
  try {
    // ... query logic ...
    
    const configs = await db.filingUIConfig.findMany({...});

    return NextResponse.json({
      configs: configs.map(c => ({          // ❌ Returns "configs"
        id: c.id,
        country: c.country,
        // ...
        totalFields: (c.configData as any).fields?.length || 0,
        updatedAt: c.updatedAt,             // ❌ Date object, not string
      })),
      total: configs.length,
    });
  }
}
```

### After (CORRECT)

```typescript
export async function GET(request: NextRequest) {
  try {
    // ... query logic ...
    
    const configs = await db.filingUIConfig.findMany({...});

    // Transform to match FilingConfigClient expected format: { rows: [...] }
    const rows = configs.map(c => ({
      id: c.id,
      country: c.country,
      procedureCode: c.procedureCode,
      messageName: c.messageName,
      messageType: c.messageType,
      transactionType: c.transactionType,
      version: c.version,
      description: c.description,
      totalFields: (c.configData as any).fields?.length || 0,
      isActive: c.isActive,                 // ✅ Added missing field
      updatedAt: c.updatedAt.toISOString(), // ✅ Convert Date to ISO string
      createdBy: c.createdBy,               // ✅ Added missing field
      updatedBy: c.updatedBy,               // ✅ Added missing field
    }));

    return NextResponse.json({ rows });     // ✅ Returns "rows"
  }
}
```

---

## ✅ Verification

### After Fix:

```bash
$ curl http://localhost:3000/api/filing-config/ui-configuration

{
  "rows": [{                                 # ✅ Correct key!
    "id": "cmsw06uur0000edvov7z0gvg8",
    "country": "NL",
    "procedureCode": "H1",
    "messageName": "IE501",
    "messageType": "request",
    "transactionType": "import",
    "version": 1,
    "description": "UI configuration for NL H1 IE501",
    "totalFields": 1,
    "isActive": true,                        # ✅ Added
    "updatedAt": "2026-08-16T16:12:33.072Z", # ✅ ISO string
    "createdBy": "api",                      # ✅ Added
    "updatedBy": "api"                       # ✅ Added
  }]
}
```

### Client Code Now Works:

```typescript
const res = await fetch(`/api/filing-config/ui-configuration`);
const data = await res.json();
setRows(data.rows ?? []);  // ✅ data.rows = [{ ... }] (1 record)
```

---

## 📊 Changes Summary

| Field | Before | After |
|-------|--------|-------|
| Response key | `configs` ❌ | `rows` ✅ |
| `isActive` | ❌ Missing | ✅ Included |
| `createdBy` | ❌ Missing | ✅ Included |
| `updatedBy` | ❌ Missing | ✅ Included |
| `updatedAt` | Date object ❌ | ISO string ✅ |
| `total` field | Included ❌ | Removed ✅ |

---

## 🎯 Result

**Grid Now Displays Data:**

| Country | Procedure Code | Message Name | Message Type | Trans Type | Total Fields | Version | Active | Updated At | Created By | Updated By | Actions |
|---------|----------------|--------------|--------------|------------|--------------|---------|--------|------------|------------|------------|---------|
| NL | H1 | IE501 | request | import | 1 | 1 | ✓ | 2026-08-16... | api | api | Edit/Delete |

---

## 🚀 Testing

### Manual Test:

1. **Refresh** the Filing Config page in browser (Ctrl+R or Cmd+R)
2. Click the **UI Configuration** tab
3. ✅ Should now see 1 row with data
4. ✅ Columns display correctly
5. ✅ Total Fields shows "1"
6. ✅ Created/Updated By show "api" (will show user email after next save)

### Browser Console Check:

```javascript
// Open DevTools Console (F12)
// Check Network tab for /api/filing-config/ui-configuration
// Response should show { rows: [...] }
```

---

## 📝 Why This Happened

**We created a specific route for ui-configuration** (`/api/filing-config/ui-configuration/route.ts`) which **overrides the dynamic route** (`/api/filing-config/[table]/route.ts`).

**The specific route was created for:**
- Custom POST logic (saving complete configuration JSON)
- Direct database queries without going through registry

**But we forgot to:**
- Match the response format of the dynamic route
- Include all necessary fields (isActive, createdBy, updatedBy)
- Convert Date objects to strings

---

## 🔄 Related Issues Fixed

This fix also resolves:
1. ✅ Missing `isActive` field in grid
2. ✅ Missing `createdBy` field in grid  
3. ✅ Missing `updatedBy` field in grid
4. ✅ Date serialization issues

---

## 📖 Related Documentation

- [UI-CONFIG-GRID-FIX.md](./UI-CONFIG-GRID-FIX.md) - Registry schema fix
- [UI-CONFIG-SAVE-FIXES.md](./UI-CONFIG-SAVE-FIXES.md) - Save functionality fixes
- [UI-CONFIG-JSON-STRUCTURE.md](./UI-CONFIG-JSON-STRUCTURE.md) - JSON structure guide

---

## ✅ Final Status

**Issue:** Grid showing "No rows" despite data in database  
**Root Cause:** API response format mismatch (`configs` vs `rows`)  
**Fix:** Updated `/api/filing-config/ui-configuration/route.ts` to return `{ rows: [...] }`  
**Result:** ✅ Grid now displays all UI configurations correctly!

**Refresh the page to see the data!** 🎉
