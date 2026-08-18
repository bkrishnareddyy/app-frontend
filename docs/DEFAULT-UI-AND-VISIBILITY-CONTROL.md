# Default UI Fallback & Visibility Control

## Implementation Date: 2026-08-16

This document describes the default UI rendering system and field visibility controls for the filing declaration forms.

---

## Overview

The system now supports:

1. **Default Schema-Based Rendering**: Automatic form generation from JSON schemas when no UI config exists
2. **Field Visibility Control**: Ability to hide/show fields per country/procedure (not all fields needed everywhere)
3. **Graceful Fallback**: Seamless transition between configured and default UIs

---

## Feature 1: Default Schema Renderer

### Problem
Previously, if no UI configuration existed for a country/procedure/message combination, the form showed a yellow error box: "No form configuration available". This blocked users from viewing or entering data.

### Solution
**New Component**: `DefaultSchemaRenderer.tsx`

**Behavior**:
- Automatically loads the appropriate JSON schema (Import or Export)
- Generates a form from the schema structure
- Infers field types from schema metadata
- Handles nested objects with expand/collapse
- Shows a blue info banner explaining it's using the default view

### User Flow

```
User opens Filing → Declaration Tab
           ↓
System checks for UI Config
           ↓
    ┌─────────────┴─────────────┐
    │                           │
UI Config Found          No UI Config
    │                           │
    ↓                           ↓
Load Custom Layout      Load Schema + Default Renderer
(DynamicFormRenderer)   (DefaultSchemaRenderer)
    │                           │
    └───────────┬───────────────┘
                ↓
        User can view/edit data
```

### Default Renderer Features

**Automatic Field Type Inference**:
- `enum` in schema → Dropdown
- `type: "boolean"` → Checkbox
- `type: "number"` → Number field
- `format: "date"` → Date picker
- `format: "date-time"` → DateTime picker
- `maxLength > 100` → Textarea
- Default → Text input

**Structure Handling**:
- Nested objects → Collapsible sections with expand/collapse
- Arrays → Shows placeholder (configure via UI Config Editor for complex handling)
- Required fields → Marked with red asterisk (*)
- Field descriptions → Shown as help text below field

**Schema Wrapper Unwrapping**:
- Automatically detects `ImportDeclaration` / `ExportDeclaration` root wrappers
- Shows meaningful structure starting from `GoodsDeclaration`
- Same unwrapping logic as SchemaTreeViewer

### Example

**Without UI Config** (before):
```
┌─────────────────────────────────────────┐
│  ⚠️  No form configuration available   │
└─────────────────────────────────────────┘
(User blocked - cannot proceed)
```

**Without UI Config** (after):
```
┌───────────────────────────────────────────────────────┐
│  ℹ️  Default Schema View: No UI configuration found  │
│  for this message. Showing auto-generated form from   │
│  schema. Configure fields in Filing Configuration for │
│  a customized layout.                                  │
└───────────────────────────────────────────────────────┘

▼ Goods Declaration
  Declaration Number    [________________]
  Function Code        [▼ Select...     ]
  Invoice Amount       [________________]
  Invoice Currency     [▼ Select...     ]
  ...

▼ Parties
  ▶ Importer
  ▶ Exporter
  ▶ Declarant
  ...

[Save Declaration]
```

**With UI Config**:
```
(Custom layout with only configured fields shown)

Declaration Header
  Entry Number         [________________] *
  Entry Type          [▼ Select...     ]
  
Parties
  Importer Name       [________________] *
  Importer EORI       [________________]
  ...
```

---

## Feature 2: Field Visibility Control

### Problem
Different countries and procedures require different fields. For example:
- EU requires EORI numbers, US doesn't
- India requires GSTIN, other countries don't
- Some fields are country-specific or procedure-specific
- Showing all 200+ fields from schema is overwhelming

### Solution
**Enhanced `isVisible` Field Control**

**Database Field**: `FilingUIConfig.isVisible` (boolean, default true)

**UI Enhancement**: Prominent visibility checkbox in Field Config Panel

### Configuration UI

**Location**: Filing Configuration → UI Configuration → Configure Fields Visually → Select field

**Visibility Control**:
```
┌────────────────────────────────────────────────┐
│ □ Required Field                               │
│ □ Read-only                                    │
│                                                 │
│ ┌──────────────────────────────────────────┐  │
│ │ ✓ Visible in Form                        │  │
│ │                                           │  │
│ │ Uncheck to hide this field for this      │  │
│ │ country/procedure (not all fields are    │  │
│ │ required for every message)              │  │
│ └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**How It Works**:

1. **Configure Per Country/Procedure**
   - Create UI config for field
   - Check "Visible in Form" = field shows
   - Uncheck "Visible in Form" = field hidden for this specific country/procedure

2. **Example Scenarios**

   **Scenario A: EORI Required for EU, Not US**
   ```
   Country: NL, Procedure: H1
   Field: ImportDeclaration.GoodsDeclaration.Parties.Importer.EORI
   Visible: ✓ (checked) → Shows in NL filing forms
   
   Country: US, Procedure: 01
   Field: Importer.EORI
   Visible: □ (unchecked) → Hidden in US filing forms
   ```

   **Scenario B: Complex Nested Structure Not Needed**
   ```
   Country: NL, Procedure: H1
   Field: GoodsDeclaration.Amendment.ChangeRemarks
   Visible: □ (unchecked) → Hidden (not needed for standard imports)
   ```

3. **API Filtering**
   - API route automatically filters: `WHERE isVisible = true`
   - Only visible fields returned to form renderer
   - No client-side filtering needed

---

## Technical Implementation

### File: `DefaultSchemaRenderer.tsx` (NEW)

**Path**: `src/app/app/filing/[id]/DefaultSchemaRenderer.tsx`

**Key Functions**:

```typescript
// Infer field type from schema
const inferFieldType = (fieldSchema: SchemaField): string => {
  if (fieldSchema.enum) return "dropdown";
  if (fieldSchema.type === "boolean") return "checkbox";
  if (fieldSchema.type === "number") return "number";
  if (fieldSchema.format === "date") return "date";
  if (fieldSchema.format === "date-time") return "datetime";
  if (fieldSchema.maxLength && fieldSchema.maxLength > 100) return "textarea";
  return "text";
};

// Unwrap root transaction wrapper
const getEffectiveSchema = () => {
  if (schema.properties) {
    const rootKeys = Object.keys(schema.properties);
    if (rootKeys.length === 1 && 
        (rootKeys[0] === "ImportDeclaration" || rootKeys[0] === "ExportDeclaration")) {
      return schema.properties[rootKeys[0]];
    }
  }
  return schema;
};

// Render nested object with expand/collapse
const renderObject = (objSchema, path, name, depth) => {
  // Recursive rendering with depth limit
  // Handles nested structures like Parties → Importer → Address
};
```

**Props**:
- `schema`: JSON schema object
- `data`: Form data
- `onChange`: Field change handler
- `onSave`: Save handler (optional)
- `readOnly`: Read-only mode flag
- `maxDepth`: Maximum nesting depth (default: 3)

### File: `DynamicFormRenderer.tsx` (UPDATED)

**Changes**:

1. **Added state for default renderer**:
```typescript
const [schema, setSchema] = useState<any>(null);
const [useDefaultRenderer, setUseDefaultRenderer] = useState(false);
```

2. **Enhanced fetch logic**:
```typescript
// Try to fetch UI configuration
const response = await fetch(...);

if (response.ok) {
  const result = await response.json();
  const hasConfigs = result.sections && Object.keys(result.sections).length > 0;
  
  if (hasConfigs) {
    // Filter out isVisible = false fields
    const filteredSections = {};
    Object.entries(result.sections).forEach(([section, fields]) => {
      const visibleFields = fields.filter(field => field.isVisible !== false);
      if (visibleFields.length > 0) {
        filteredSections[section] = visibleFields;
      }
    });
    setUiConfig(filteredSections);
    setUseDefaultRenderer(false);
  } else {
    // No configs, use default
    setUseDefaultRenderer(true);
    await loadSchema();
  }
} else if (response.status === 404) {
  // Not found, use default
  setUseDefaultRenderer(true);
  await loadSchema();
}
```

3. **Schema loader**:
```typescript
const loadSchema = async () => {
  // Determine transaction type from procedure code
  const transactionType = procedureCode.toUpperCase().startsWith('H') ? 'import' : 'export';
  const schemaFileName = transactionType === "import" 
    ? "ImportDeclaration.schema.json" 
    : "ExportDeclaration.schema.json";
  
  const response = await fetch(
    `/schemas/customs-filing/filing-schemas/${transactionType}/1.0.0/${schemaFileName}`
  );
  
  if (response.ok) {
    const schemaData = await response.json();
    setSchema(schemaData);
  }
};
```

4. **Conditional rendering**:
```typescript
// Use default schema renderer if no UI config found
if (useDefaultRenderer && schema) {
  return (
    <DefaultSchemaRenderer
      schema={schema}
      data={data}
      onChange={onChange}
      onSave={onSave}
      readOnly={readOnly}
      maxDepth={3}
    />
  );
}
```

### File: `FieldConfigPanel.tsx` (UPDATED)

**Enhanced Visibility Control**:

```typescript
<div className="p-2 bg-blue-50 border border-blue-200 rounded">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={config.isVisible}
      onChange={(e) => setConfig({ ...config, isVisible: e.target.checked })}
      className="w-4 h-4 rounded border-border text-brand focus:ring-brand"
    />
    <div>
      <span className="text-xs font-semibold text-ink">Visible in Form</span>
      <p className="text-[10px] text-ink-muted mt-0.5">
        Uncheck to hide this field for this country/procedure 
        (not all fields are required for every message)
      </p>
    </div>
  </label>
</div>
```

**Benefits**:
- Highlighted with blue background
- Clear label and explanation
- Cursor pointer indicates clickability
- Help text explains purpose

### File: `route.ts` (EXISTING - No changes needed)

**Already filters by isVisible**:

```typescript
const uiConfig = await db.filingUIConfig.findMany({
  where: {
    country,
    procedureCode,
    messageName,
    messageType,
    isVisible: true,  // ← Already filtering
  },
  orderBy: [
    { section: "asc" },
    { displayOrder: "asc" },
  ],
});
```

---

## Usage Scenarios

### Scenario 1: New Country Setup (No Config Yet)

**Steps**:
1. User creates filing for new country (e.g., India)
2. Opens Declaration tab
3. **System shows**: Default schema renderer with all fields
4. User can view/edit data immediately (not blocked)
5. Administrator later configures UI for better UX

**Benefits**:
- No blocking - users can work immediately
- System functional from day 1 for any country
- Can gradually improve UX by adding configs

### Scenario 2: Minimalist UI (Hide Most Fields)

**Use Case**: Standard import with only 20 critical fields needed out of 200+

**Steps**:
1. Admin opens UI Config Editor
2. Configures 20 important fields, sets `isVisible = true`
3. For remaining 180 fields: either don't configure (won't show), or configure with `isVisible = false`
4. User sees clean form with only 20 fields
5. Advanced users can still use Response tab to see full data

**Benefits**:
- Clean, focused UI for common cases
- Reduced training time
- Less scrolling, faster data entry

### Scenario 3: Different Fields Per Country

**Use Case**: EORI needed for EU, SSN/EIN for US

**EU Configuration** (Country: NL, Procedure: H1):
```
Field: Parties.Importer.EORI
Visible: ✓ (checked)
Required: ✓ (checked)

Field: Parties.Importer.SSN
Visible: □ (unchecked) ← Hidden for EU
```

**US Configuration** (Country: US, Procedure: 01):
```
Field: Importer.EORI
Visible: □ (unchecked) ← Hidden for US

Field: Importer.TaxId (SSN/EIN)
Visible: ✓ (checked)
Required: ✓ (checked)
```

**Result**: 
- EU users see EORI field, not SSN
- US users see SSN/EIN field, not EORI
- Same codebase, different configs

### Scenario 4: Progressive Disclosure

**Use Case**: Show basic fields by default, advanced fields only when needed

**Initial Setup** (20 basic fields):
- DeclarationNumber, Procedure, InvoiceAmount, Currency, etc.
- All set `isVisible = true`

**Advanced Fields** (180 additional fields):
- ValuationAdjustment.AdditionCode, OriginCriterion, etc.
- All set `isVisible = false`

**When needed**:
- Admin can toggle `isVisible = true` for specific advanced fields
- Or users can use default renderer to see everything

**Benefits**:
- Simplified onboarding (only 20 fields to learn)
- Power users can enable advanced features
- Flexible per use case

---

## Benefits Summary

### For Users

✅ **Never Blocked**: Can always view/edit data, even without UI config  
✅ **Clean Interface**: Only see relevant fields for their country/procedure  
✅ **Faster Data Entry**: Less scrolling, fewer irrelevant fields  
✅ **Progressive Learning**: Start with basics, add complexity as needed  

### For Administrators

✅ **Gradual Rollout**: Configure UI incrementally, system works immediately  
✅ **Country Flexibility**: Different field sets per country without code changes  
✅ **Easy Maintenance**: Change visibility without touching code  
✅ **Reusable Configs**: Configure once per field, control visibility separately  

### For Developers

✅ **No Special Cases**: Same renderer works for all countries  
✅ **Schema-Driven**: Default renderer auto-adapts to schema changes  
✅ **Separation of Concerns**: UI config separate from business logic  
✅ **Testable**: Can test with/without configs independently  

---

## Configuration Best Practices

### 1. Start with Default Renderer
- Deploy to production without configs
- Let users work with default schema view
- Gather feedback on which fields are actually used

### 2. Configure High-Traffic Fields First
- Identify 20 most-used fields per country
- Configure those with proper labels, help text, validation
- Set `isVisible = true`
- Leave others unconfigured (users see them in default view if needed)

### 3. Hide Unused Fields Gradually
- After monitoring usage, identify truly unused fields
- Configure them with `isVisible = false`
- Clean up UI without breaking anything

### 4. Use Visibility for Business Rules
- Fields that apply only to specific countries: configure per country, control visibility
- Fields that apply only to specific procedures: configure per procedure
- Fields for advanced use cases: configure but hide (`isVisible = false`), enable when needed

### 5. Document Why Fields Are Hidden
- Use the `helpText` field to document reasoning
- Example: "Hidden for US - US Customs uses SSN/EIN instead of EORI"
- Helps future administrators understand configuration decisions

---

## Testing Checklist

### Default Renderer Tests

- [ ] Create new filing without UI config
- [ ] Verify default renderer loads
- [ ] Check blue info banner displays
- [ ] Expand/collapse nested sections
- [ ] Enter data in various field types
- [ ] Save and verify data persisted
- [ ] Reload and verify data loaded

### Visibility Control Tests

- [ ] Configure field with `isVisible = true`
- [ ] Verify field shows in form
- [ ] Update config to `isVisible = false`
- [ ] Verify field hidden in form
- [ ] Check API only returns visible fields
- [ ] Verify different visibility per country works

### Transition Tests

- [ ] Start with no config (default renderer)
- [ ] Add first field config
- [ ] Verify switches to custom renderer
- [ ] Remove all field configs
- [ ] Verify switches back to default renderer

---

## Known Limitations

### Arrays Not Fully Supported in Default Renderer
**Impact**: Array fields (like line items) show placeholder message in default renderer  
**Workaround**: Configure array fields via UI Config Editor for full functionality  
**Future**: Enhance default renderer with array handling

### Max Depth Limit
**Impact**: Default renderer stops at depth 3 to prevent overwhelming nesting  
**Workaround**: Configure deep nested fields via UI Config Editor  
**Reason**: UX - too many nested levels confuse users

### No Master Data in Default Renderer
**Impact**: Dropdowns in default renderer only show schema enums, not master data  
**Workaround**: Configure fields that need master data via UI Config Editor  
**Reason**: Default renderer doesn't know which fields use master data

---

## Migration Notes

### Existing Installations

**No Breaking Changes**: Existing UI configs continue to work

**New Behavior**:
1. If `isVisible` not set → defaults to `true` (backward compatible)
2. If `isVisible = false` → field hidden (new feature)
3. If no configs at all → shows default renderer (new feature, previously showed error)

**Recommended Actions**:
1. Review existing configs
2. Set `isVisible = false` for any fields that shouldn't show
3. Add configs for new countries with appropriate visibility settings

### New Installations

**Recommended Flow**:
1. Start with default renderer (no configs)
2. Users can immediately work
3. Configure UI gradually based on feedback
4. Use visibility control to hide irrelevant fields

---

## Future Enhancements

### Planned
- [ ] Array handling in default renderer (expandable line items)
- [ ] Schema version detection (use correct schema version automatically)
- [ ] Bulk visibility toggle (show/hide entire sections)
- [ ] Visibility templates (copy visibility settings between procedures)
- [ ] Usage analytics (track which fields are actually used)

### Under Consideration
- [ ] Conditional visibility (show field only if another field has specific value)
- [ ] Role-based visibility (different fields for different user roles)
- [ ] Time-based visibility (show field only during specific periods)
- [ ] Smart defaults (pre-fill fields based on historical data)

---

## Related Documentation

- **Implementation Summary**: `IMPLEMENTATION-SUMMARY-SCHEMA-INTEGRATION.md`
- **Action Plan**: `ACTION-PLAN-SCHEMA-INTEGRATION.md`
- **Current Mapping**: `CURRENT-SHIPMENT-TO-FILING-MAPPING.md`
- **System Evaluation**: `SHIPMENT-TO-FILING-EVALUATION.md`

---

## Conclusion

The default UI fallback and visibility control features provide:

1. **Resilience**: System works even without configuration
2. **Flexibility**: Different field sets per country/procedure
3. **Simplicity**: Clean UI by hiding irrelevant fields
4. **Scalability**: Easy to add new countries/procedures

**Status**: ✅ Fully implemented and ready for testing

**Next**: Test with real schemas and configure first production country
