# UI Config Grid Not Showing Records - Fix

**Date:** 2026-08-16  
**Issue:** UI Configuration grid showing "No rows" even though configs saved successfully in database

---

## 🐛 Root Cause

The **Filing Config Registry** was still using the OLD field-based schema structure, but we had migrated to a JSON-based structure. This caused a mismatch:

### Old Structure (What Registry Expected)
- One row per field configuration
- Direct columns: `section`, `displayOrder`, `fieldPath`, `fieldLabel`, etc.
- Registry tried to `ORDER BY section, displayOrder` (columns that no longer exist)

### New Structure (What Database Has)
- One row per complete configuration  
- Single `configData` JSON column containing all fields
- New columns: `transactionType`, `version`, `description`, `isActive`

---

## 🔧 Fix Applied

**File:** `src/modules/filingConfig/registry.ts`

### 1. Updated Field Definitions

**Before:**
```typescript
fields: [
  { key: "country", label: "Country", type: "text" },
  { key: "procedureCode", label: "Procedure Code", type: "text" },
  { key: "messageName", label: "Message Name", type: "text" },
  { key: "messageType", label: "Message Type", type: "text" },
  { key: "section", label: "Section", type: "text" },        // ❌ Doesn't exist
  { key: "fieldPath", label: "Field Path", type: "text" },   // ❌ Doesn't exist
  { key: "fieldLabel", label: "Field Label", type: "text" }, // ❌ Doesn't exist
  // ... 13 more old fields
]
```

**After:**
```typescript
fields: [
  { key: "country", label: "Country", type: "text" },
  { key: "procedureCode", label: "Procedure Code", type: "text" },
  { key: "messageName", label: "Message Name", type: "text" },
  { key: "messageType", label: "Message Type", type: "text" },
  { key: "transactionType", label: "Transaction Type", type: "text" }, // ✅ NEW
  { key: "version", label: "Version", type: "text" },                  // ✅ NEW
  { key: "description", label: "Description", type: "text" },          // ✅ NEW
  { key: "totalFields", label: "Total Fields", type: "text" },         // ✅ NEW (computed)
  { key: "isActive", label: "Active", type: "boolean" },               // ✅ NEW
  { key: "updatedAt", label: "Updated At", type: "text" },            // ✅ NEW
  { key: "createdBy", label: "Created By", type: "text" },            // ✅ NEW
  { key: "updatedBy", label: "Updated By", type: "text" },            // ✅ NEW
]
```

### 2. Fixed list() Function

**Before:**
```typescript
list: async () => {
  const rows = await db.filingUIConfig.findMany({
    orderBy: [
      { country: "asc" },
      { procedureCode: "asc" },
      { messageName: "asc" },
      { messageType: "asc" },
      { section: "asc" },      // ❌ Column doesn't exist - CRASH!
      { displayOrder: "asc" }, // ❌ Column doesn't exist - CRASH!
    ],
  });
  return rows; // ❌ Returns raw rows missing computed fields
}
```

**After:**
```typescript
list: async () => {
  const rows = await db.filingUIConfig.findMany({
    where: { isActive: true }, // ✅ Filter active only
    orderBy: [
      { country: "asc" },
      { procedureCode: "asc" },
      { messageName: "asc" },
      { messageType: "asc" },
      { transactionType: "asc" }, // ✅ Correct column
    ],
  });
  
  // ✅ Transform rows to include computed totalFields from JSON
  return rows.map(row => ({
    id: row.id,
    country: row.country,
    procedureCode: row.procedureCode,
    messageName: row.messageName,
    messageType: row.messageType,
    transactionType: row.transactionType,
    version: row.version,
    description: row.description,
    totalFields: (row.configData as any)?.fields?.length || 0, // ✅ Computed from JSON
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  }));
}
```

### 3. Updated create() Function

**Before:**
```typescript
create: (data) => db.filingUIConfig.create({ 
  data: {
    country: String(data.country || ""),
    // ...
    fieldPath: String(data.fieldPath || ""),       // ❌ Old field
    fieldLabel: String(data.fieldLabel || ""),     // ❌ Old field
    fieldType: String(data.fieldType || "text"),   // ❌ Old field
    section: String(data.section || "general"),    // ❌ Old field
    displayOrder: Number(data.displayOrder || 0),  // ❌ Old field
    // ... many more old fields
  } 
})
```

**After:**
```typescript
create: (data) => db.filingUIConfig.create({ 
  data: {
    country: String(data.country || ""),
    procedureCode: String(data.procedureCode || ""),
    messageName: String(data.messageName || ""),
    messageType: String(data.messageType || "request"),
    transactionType: String(data.transactionType || "import"),         // ✅ NEW
    configData: data.configData || { fields: [], totalFields: 0, sections: [] }, // ✅ JSON
    version: Number(data.version || 1),                                // ✅ NEW
    description: data.description ? String(data.description) : null,   // ✅ NEW
    isActive: data.isActive !== false,                                 // ✅ NEW
    createdBy: data.createdBy ? String(data.createdBy) : 'system',    // ✅ NEW
    updatedBy: data.updatedBy ? String(data.updatedBy) : 'system',    // ✅ NEW
  } 
})
```

### 4. Updated update() Function

**Before:**
```typescript
update: (id, data) => db.filingUIConfig.update({ 
  where: { id }, 
  data: {
    // ...
    fieldPath: data.fieldPath ? String(data.fieldPath) : undefined,     // ❌ Old
    fieldLabel: data.fieldLabel ? String(data.fieldLabel) : undefined,  // ❌ Old
    section: data.section ? String(data.section) : undefined,           // ❌ Old
    displayOrder: data.displayOrder !== undefined ? Number(data.displayOrder) : undefined, // ❌ Old
    // ... many more old fields
  } 
})
```

**After:**
```typescript
update: (id, data) => db.filingUIConfig.update({ 
  where: { id }, 
  data: {
    country: data.country ? String(data.country) : undefined,
    procedureCode: data.procedureCode ? String(data.procedureCode) : undefined,
    messageName: data.messageName ? String(data.messageName) : undefined,
    messageType: data.messageType ? String(data.messageType) : undefined,
    transactionType: data.transactionType ? String(data.transactionType) : undefined, // ✅ NEW
    configData: data.configData || undefined,                                         // ✅ JSON
    version: data.version !== undefined ? Number(data.version) : undefined,           // ✅ NEW
    description: data.description !== undefined ? String(data.description) : undefined, // ✅ NEW
    isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,       // ✅ NEW
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,                   // ✅ NEW
  } 
})
```

### 5. Updated Schemas

**Before (createSchema):**
```typescript
createSchema: z.object({
  country: z.string(),
  procedureCode: z.string(),
  messageName: z.string(),
  messageType: z.enum(["request", "response"]),
  fieldPath: z.string(),       // ❌ Old field
  fieldLabel: z.string(),      // ❌ Old field
  fieldType: z.enum([...]),    // ❌ Old field
  section: z.string(),         // ❌ Old field
  displayOrder: z.number(),    // ❌ Old field
  // ... many more old fields
})
```

**After (createSchema):**
```typescript
createSchema: z.object({
  country: z.string(),
  procedureCode: z.string(),
  messageName: z.string(),
  messageType: z.enum(["request", "response"]),
  transactionType: z.enum(["import", "export"]).default("import"),  // ✅ NEW
  configData: z.object({                                             // ✅ JSON structure
    fields: z.array(z.any()),
    totalFields: z.number(),
    sections: z.array(z.string()),
  }),
  description: z.string().optional(),      // ✅ NEW
  isActive: z.boolean().default(true),     // ✅ NEW
  createdBy: z.string().optional(),        // ✅ NEW
  updatedBy: z.string().optional(),        // ✅ NEW
})
```

**Update Schema:** Similar transformation for `updateSchema`

---

## 📊 What This Fixes

### Grid Display

**Before:**
```
+--------+---------------+--------------+-------------+
| Column Headers (wrong fields)                      |
+--------+---------------+--------------+-------------+
|                    No rows.                        |  ❌ EMPTY
+----------------------------------------------------+
```

**After:**
```
+--------+-----------+-------------+----------+-----------+--------+----------+
| Country| Procedure | Message     | Message  | Trans     | Total  | Updated  |
|        | Code      | Name        | Type     | Type      | Fields | At       |
+--------+-----------+-------------+----------+-----------+--------+----------+
| NL     | H1        | IE501       | request  | import    | 3      | 2026...  | ✅ DATA!
| DE     | H7        | IE515       | response | export    | 5      | 2026...  |
+--------+-----------+-------------+----------+-----------+--------+----------+
```

### API Behavior

**Before:**
- ❌ Prisma error: "Unknown field 'section' in orderBy"
- ❌ Prisma error: "Unknown field 'displayOrder' in orderBy"  
- ❌ Returns empty array
- ❌ Grid shows "No rows"

**After:**
- ✅ Query succeeds with correct columns
- ✅ Returns transformed data with computed `totalFields`
- ✅ Grid populates with configuration rows
- ✅ Shows proper metadata (version, created by, updated by)

---

## ✅ Testing

### Verify in UI

1. Navigate to **Filing Config** → **UI Configuration** tab
2. ✅ Grid should now show all saved configurations
3. ✅ Columns display: Country, Procedure Code, Message Name, Message Type, Transaction Type, Total Fields, etc.
4. ✅ "Total Fields" shows count from JSON (e.g., "3 fields configured")
5. ✅ Created By / Updated By show user email
6. ✅ Updated At shows timestamp

### Verify in Database

```sql
-- Check actual data structure
SELECT 
  id,
  country,
  procedureCode,
  messageName,
  messageType,
  transactionType,
  version,
  (configData->'fields')::jsonb as fields,
  jsonb_array_length((configData->'fields')::jsonb) as total_fields,
  createdBy,
  updatedBy
FROM "FilingUIConfig"
ORDER BY updatedAt DESC;
```

**Expected Results:**
- ✅ All columns present (no "section", "fieldPath", etc.)
- ✅ `configData` is JSON with `fields` array
- ✅ `total_fields` computed correctly from JSON
- ✅ `createdBy`/`updatedBy` show user email (not "api")

---

## 🎯 Summary

**Root Cause:**  
Registry was using old field-based schema, but database had migrated to JSON-based schema.

**Fix:**  
- ✅ Updated field definitions to match new schema
- ✅ Fixed `list()` to query correct columns and compute `totalFields`
- ✅ Updated `create()` and `update()` to use JSON structure
- ✅ Updated Zod schemas for validation

**Result:**  
Grid now displays UI configurations correctly with proper column headers and data! 🎉

---

## 📝 Related Files

- `src/modules/filingConfig/registry.ts` - Fixed registry definition
- `prisma/schema.prisma` - Current schema (already correct)
- `src/app/app/filing-config/FilingConfigClient.tsx` - Grid component (no changes needed)
- `docs/UI-CONFIG-JSON-STRUCTURE.md` - JSON structure documentation
- `docs/UI-CONFIG-SAVE-FIXES.md` - Previous fixes for save functionality
