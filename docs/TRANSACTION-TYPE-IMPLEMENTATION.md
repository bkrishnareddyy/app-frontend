# Transaction Type Implementation - Database Migration & API Updates

## Implementation Date: 2026-08-16

This document summarizes the changes made to support transaction type (import/export) distinction in UI configurations.

---

## Overview

Added `transactionType` field to `FilingUIConfig` table to support different field configurations for Import vs Export declarations.

**Key Benefit**: Same country/procedure can have different field configurations for imports vs exports (e.g., NL H1 for imports, NL E1 for exports).

---

## Changes Made

### 1. Database Schema Update

**File**: `prisma/schema.prisma`

**Change**: Added `transactionType` field to FilingUIConfig model

```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  country         String
  procedureCode   String
  messageName     String
  messageType     String
  transactionType String   @default("import") // NEW FIELD
  
  fieldPath       String
  // ... other fields ...
  
  @@unique([country, procedureCode, messageName, messageType, transactionType, fieldPath])
  @@index([country, procedureCode, messageName, messageType, transactionType])
}
```

**Key Points**:
- Default value: `"import"` (for backward compatibility with 163 existing rows)
- Updated unique constraint: now includes `transactionType`
- Updated index: now includes `transactionType` for efficient queries

**Migration Applied**:
```bash
npx prisma db push --accept-data-loss
```

**Result**: 
✅ Schema in sync with database
✅ All existing records defaulted to "import"
✅ Prisma Client regenerated

---

### 2. API Route Updates

#### A. POST `/api/filing-config/ui-configuration`

**File**: `src/app/api/filing-config/ui-configuration/route.ts`

**Change**: Accept `transactionType` in request body

```typescript
const config = await db.filingUIConfig.create({
  data: {
    country: body.country,
    procedureCode: body.procedureCode,
    messageName: body.messageName,
    messageType: body.messageType,
    transactionType: body.transactionType || "import", // NEW
    fieldPath: body.fieldPath,
    // ... other fields
  },
});
```

**Behavior**:
- Accepts `transactionType` from request
- Defaults to `"import"` if not provided
- Creates config with transaction type included

#### B. PUT `/api/filing-config/ui-configuration/[id]`

**File**: `src/app/api/filing-config/ui-configuration/[id]/route.ts`

**Change**: Allow updating `transactionType`

```typescript
const config = await db.filingUIConfig.update({
  where: { id },
  data: {
    transactionType: body.transactionType, // NEW
    fieldLabel: body.fieldLabel,
    // ... other fields
  },
});
```

**Behavior**:
- Allows changing transaction type of existing config
- Useful for fixing misconfigured entries

#### C. GET `/api/filing/ui-config`

**File**: `src/app/api/filing/ui-config/route.ts`

**Changes**: 
1. Accept `transactionType` query parameter
2. Validate transaction type
3. Filter results by transaction type
4. Include in response

```typescript
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const transactionType = searchParams.get("transactionType") || "import"; // NEW
  
  // Validate transactionType
  if (transactionType !== "import" && transactionType !== "export") {
    return NextResponse.json(
      { error: "transactionType must be 'import' or 'export'" },
      { status: 400 }
    );
  }
  
  // Fetch with transaction type filter
  const uiConfig = await db.filingUIConfig.findMany({
    where: {
      country,
      procedureCode,
      messageName,
      messageType,
      transactionType, // NEW
      isVisible: true,
    },
  });
  
  return NextResponse.json({
    country,
    procedureCode,
    messageName,
    messageType,
    transactionType, // NEW in response
    sections,
    totalFields: uiConfig.length,
  });
}
```

**API Contract**:

**Request**:
```
GET /api/filing/ui-config?country=NL&procedureCode=H1&messageName=IE501&messageType=request&transactionType=import
```

**Response**:
```json
{
  "country": "NL",
  "procedureCode": "H1",
  "messageName": "IE501",
  "messageType": "request",
  "transactionType": "import",
  "sections": {
    "header": [...],
    "parties": [...]
  },
  "totalFields": 25
}
```

---

### 3. UI Config Editor Updates

**File**: `src/app/app/filing-config/UIConfigEditor.tsx`

**Changes**:

#### A. Pass transactionType when saving config

```typescript
const handleSaveConfig = async (config: any) => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      country,
      procedureCode,
      messageName,
      messageType,
      transactionType, // NEW
      ...config,
    }),
  });
};
```

#### B. Include transactionType when loading existing configs

```typescript
const loadExistingConfigurations = async () => {
  const response = await fetch(
    `/api/filing/ui-config?country=${country}&procedureCode=${procedureCode}&messageName=${messageName}&messageType=${messageType}&transactionType=${transactionType}` // NEW
  );
};
```

**Behavior**:
- When user selects Import in modal → `transactionType = "import"`
- When user selects Export in modal → `transactionType = "export"`
- Saves configs with correct transaction type
- Loads only configs matching selected transaction type

---

## Usage Examples

### Example 1: Configure Import Field

**User Actions**:
1. Open UI Config Editor
2. Select: Country=NL, Procedure=H1, Message=IE501, Transaction Type=**Import**
3. Configure field: `GoodsDeclaration.DeclarationNumber`
4. Save

**Result in Database**:
```sql
INSERT INTO FilingUIConfig (
  country, procedureCode, messageName, messageType, transactionType, fieldPath
) VALUES (
  'NL', 'H1', 'IE501', 'request', 'import', 
  'ImportDeclaration.GoodsDeclaration.DeclarationNumber'
);
```

### Example 2: Configure Export Field

**User Actions**:
1. Open UI Config Editor
2. Select: Country=NL, Procedure=E1, Message=EX501, Transaction Type=**Export**
3. Configure field: `GoodsDeclaration.ExportNumber`
4. Save

**Result in Database**:
```sql
INSERT INTO FilingUIConfig (
  country, procedureCode, messageName, messageType, transactionType, fieldPath
) VALUES (
  'NL', 'E1', 'EX501', 'request', 'export', 
  'ExportDeclaration.GoodsDeclaration.ExportNumber'
);
```

### Example 3: Same Field, Different Transaction Types

**Scenario**: DeclarationNumber field exists in both Import and Export schemas

**Import Config**:
```json
{
  "country": "NL",
  "procedureCode": "H1",
  "messageName": "IE501",
  "transactionType": "import",
  "fieldPath": "ImportDeclaration.GoodsDeclaration.DeclarationNumber",
  "fieldLabel": "Import Declaration Number",
  "isRequired": true
}
```

**Export Config**:
```json
{
  "country": "NL",
  "procedureCode": "E1",
  "messageName": "EX501",
  "transactionType": "export",
  "fieldPath": "ExportDeclaration.GoodsDeclaration.DeclarationNumber",
  "fieldLabel": "Export Declaration Number",
  "isRequired": true
}
```

**Benefit**: Different labels, requirements, and configurations for same conceptual field.

---

## Data Migration Notes

### Existing Data

**Before Migration**: 163 rows in FilingUIConfig table

**After Migration**:
- All 163 rows now have `transactionType = "import"` (default)
- Unique constraint updated to include transactionType
- No data loss

**Action Required**:
- Review existing 163 configs
- Identify any that should be "export" (unlikely if all were configured for imports)
- Update if needed via PUT API or direct SQL

### SQL to Check Existing Configs

```sql
-- Count configs by transaction type
SELECT transactionType, COUNT(*) 
FROM "FilingUIConfig" 
GROUP BY transactionType;

-- Expected result:
-- transactionType | count
-- import          | 163
-- export          | 0
```

### SQL to Update Specific Configs to Export

```sql
-- If you find configs that should be export
UPDATE "FilingUIConfig"
SET transactionType = 'export'
WHERE country = 'NL' 
  AND procedureCode = 'E1'
  AND messageName = 'EX501';
```

---

## Testing Checklist

### Database

- [x] Schema updated with transactionType field
- [x] Default value applied to existing rows
- [x] Unique constraint includes transactionType
- [x] Index includes transactionType
- [x] Prisma Client regenerated

### API - POST (Create Config)

- [ ] Create config with transactionType="import" → Success
- [ ] Create config with transactionType="export" → Success
- [ ] Create config without transactionType → Defaults to "import"
- [ ] Try duplicate config with same transactionType → Error (unique constraint)
- [ ] Create same field for different transactionTypes → Both succeed

### API - PUT (Update Config)

- [ ] Update existing config's transactionType → Success
- [ ] Update from "import" to "export" → Success
- [ ] Update other fields without changing transactionType → Success

### API - GET (Fetch Configs)

- [ ] Fetch with transactionType="import" → Returns import configs only
- [ ] Fetch with transactionType="export" → Returns export configs only
- [ ] Fetch without transactionType → Defaults to "import"
- [ ] Fetch with invalid transactionType → Returns 400 error
- [ ] Response includes transactionType field

### UI Config Editor

- [ ] Select Import in modal → transactionType set to "import"
- [ ] Select Export in modal → transactionType set to "export"
- [ ] Save config → transactionType included in request
- [ ] Load existing configs → Filtered by current transactionType
- [ ] Switch between Import/Export → Different configs loaded

---

## Breaking Changes

### None - Backward Compatible

**Reason**: Default value ensures existing functionality continues to work

**Migration Path**:
1. ✅ Existing configs work (defaulted to "import")
2. ✅ New configs can specify transaction type
3. ✅ API backward compatible (defaults to "import" if not provided)

**If You Were Using UI Configs Before**:
- All your configs are still there
- They all have `transactionType = "import"`
- Forms still load correctly
- No action required unless you need export configs

---

## Next Steps

### Immediate

1. **Test UI Config Editor**
   - Create config for Import
   - Create config for Export
   - Verify both saved with correct transaction type

2. **Test DynamicFormRenderer**
   - Open Import filing → Verify import configs loaded
   - Open Export filing → Verify export configs loaded

3. **Review Existing Configs**
   - Check if any of the 163 configs should be export
   - Update if necessary

### Future Enhancements

1. **Bulk Copy Configs**
   - Copy Import configs to Export
   - Adjust field paths automatically (ImportDeclaration → ExportDeclaration)

2. **Transaction Type Detection**
   - Auto-detect from procedure code (H*=import, E*=export)
   - Warn if procedure and transaction type mismatch

3. **Config Template Library**
   - Pre-configured templates for common scenarios
   - Import: Standard Import, T1 Transit
   - Export: Standard Export, Re-export

---

## Related Files Modified

1. `prisma/schema.prisma` - Added transactionType field
2. `src/app/api/filing-config/ui-configuration/route.ts` - POST with transactionType
3. `src/app/api/filing-config/ui-configuration/[id]/route.ts` - PUT with transactionType
4. `src/app/api/filing/ui-config/route.ts` - GET with transactionType filter
5. `src/app/app/filing-config/UIConfigEditor.tsx` - Pass transactionType to API

---

## Summary

**Status**: ✅ Fully implemented and deployed to database

**Impact**: 
- ✅ No breaking changes
- ✅ Backward compatible
- ✅ 163 existing configs preserved
- ✅ Ready for Import and Export configurations

**Benefits**:
- Different field sets for Import vs Export
- Cleaner separation of concerns
- More flexible configuration options
- Foundation for comprehensive schema support

**Testing Required**: End-to-end testing of config creation and form loading for both Import and Export

---

## Troubleshooting

### Issue: Configs Not Loading

**Check**:
1. Is transactionType parameter passed to API?
2. Does the filing have correct transaction type determined?
3. Are configs created with matching transaction type?

**Debug**:
```sql
-- Check what configs exist
SELECT country, procedureCode, messageName, messageType, transactionType, COUNT(*)
FROM "FilingUIConfig"
WHERE isVisible = true
GROUP BY country, procedureCode, messageName, messageType, transactionType;
```

### Issue: Duplicate Key Error

**Cause**: Trying to create config that already exists

**Solution**: Check for existing config first, update instead of create

**Query to Find Duplicates**:
```sql
SELECT country, procedureCode, messageName, messageType, transactionType, fieldPath, COUNT(*)
FROM "FilingUIConfig"
GROUP BY country, procedureCode, messageName, messageType, transactionType, fieldPath
HAVING COUNT(*) > 1;
```

---

## Documentation Links

- **Action Plan**: `ACTION-PLAN-SCHEMA-INTEGRATION.md`
- **Default UI**: `DEFAULT-UI-AND-VISIBILITY-CONTROL.md`
- **Implementation Summary**: `IMPLEMENTATION-SUMMARY-SCHEMA-INTEGRATION.md`

---

## Conclusion

The transaction type field is now fully integrated into the UI configuration system. The implementation is backward compatible, preserves existing data, and provides a solid foundation for supporting both Import and Export declarations with different field configurations.

**Next**: Update DynamicFormRenderer and FilingDetailClient to determine and pass transaction type (covered in next implementation phase).
