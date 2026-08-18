# UI Configuration Framework Documentation

## Overview

The UI Configuration Framework allows administrators to define how declaration forms and response views are rendered dynamically based on canonical JSON schemas. This framework provides a flexible, database-driven approach to form rendering that adapts to schema changes without requiring code modifications.

## Architecture

### Components

1. **Database Schema** (`prisma/schema.prisma`)
   - `FilingUIConfig` - Stores field configurations for dynamic forms
   - `FilingMasterDataSource` - Defines dropdown/lookup data sources

2. **API Endpoints**
   - `GET /api/filing/ui-config` - Fetches UI configuration for a filing
   - `GET /api/filing/master-data` - Fetches dropdown/lookup options

3. **React Components**
   - `DynamicFormRenderer.tsx` - Renders forms based on UI configuration
   - `FilingConfigClient.tsx` - Admin interface for managing configurations

4. **Utilities**
   - `seed-ui-config-nl-import.ts` - Seed script for initial configurations
   - `generate-ui-config-from-schema.ts` - Generator for new schema fields

## FilingUIConfig Table Structure

| Field | Type | Description |
|-------|------|-------------|
| country | String | ISO 2-letter country code (NL, IE, FR, etc.) |
| procedureCode | String | Procedure code (H1, H4, H7, etc.) |
| messageName | String | Message name (IE501, IE503, etc.) |
| messageType | String | "request" or "response" |
| fieldPath | String | Dot notation path (e.g., "importer.name", "lineItems[].hsCode6") |
| fieldLabel | String | Display label for the field |
| fieldType | String | text, number, date, datetime, checkbox, textarea, dropdown, lookup |
| section | String | Grouping category (parties, transport, lineItems, etc.) |
| displayOrder | Int | Order within section |
| gridColumn | Int | Column span in 12-column grid (1-12) |
| isRequired | Boolean | Whether field is required |
| isReadOnly | Boolean | Whether field is read-only |
| isVisible | Boolean | Whether field is visible |
| placeholder | String? | Placeholder text |
| helpText | String? | Help text displayed below field |
| masterDataSource | String? | Reference to master data source for dropdowns/lookups |
| isMultiSelect | Boolean | Allow multiple selections |
| isArrayField | Boolean | True for array fields (e.g., lineItems[]) |

## Field Types

### Input Types
- **text** - Single-line text input
- **number** - Numeric input with step support
- **date** - Date picker
- **datetime** - Date and time picker
- **checkbox** - Boolean checkbox
- **textarea** - Multi-line text area

### Lookup Types
- **dropdown** - Select from predefined options (static list)
- **lookup** - Searchable dropdown with autocomplete (large datasets)

## Master Data Sources

Master data sources define the options for dropdown and lookup fields.

### Source Types

1. **static** - Hardcoded list in database
   ```json
   {
     "sourceName": "Currency",
     "sourceType": "static",
     "staticOptions": [
       { "value": "EUR", "label": "Euro (EUR)" },
       { "value": "USD", "label": "US Dollar (USD)" }
     ]
   }
   ```

2. **table** - Query from database table (future)
   ```json
   {
     "sourceName": "Company",
     "sourceType": "table",
     "tableName": "Company",
     "valueField": "id",
     "labelField": "name"
   }
   ```

3. **api** - Fetch from external API (future)
   ```json
   {
     "sourceName": "HSCode",
     "sourceType": "api",
     "apiEndpoint": "/api/master-data/hs-code",
     "apiMethod": "GET"
   }
   ```

4. **enum** - TypeScript enum values (future)

## Usage

### 1. Viewing/Editing UI Configuration

Navigate to **Filing Configuration** → **UI Configuration** tab

- View all field configurations grouped by country/procedure/message
- Add new field configurations
- Edit existing configurations
- Delete configurations

### 2. Managing Master Data Sources

Navigate to **Filing Configuration** → **Master Data Sources** tab

- View all master data sources
- Add new sources (e.g., new dropdown options)
- Edit existing sources
- Activate/deactivate sources

### 3. Using Dynamic Form Renderer

In your filing detail component:

```tsx
import DynamicFormRenderer from "./DynamicFormRenderer";

<DynamicFormRenderer
  country="NL"
  procedureCode="H1"
  messageName="IE501"
  messageType="request"
  data={declarationData}
  onChange={(fieldPath, value) => updateDeclarationField(fieldPath, value)}
  onSave={handleSaveDeclaration}
  readOnly={false}
/>
```

## Extending for Schema Changes

### When Canonical Schema is Updated

**Option 1: Use the Generator Script**

```bash
npx tsx scripts/generate-ui-config-from-schema.ts \
  schemas/customs-filing/filing-request-declaration/1.0.2.json \
  NL H1 IE501 request
```

This generates a JSON file with suggested UI configurations that you can:
1. Review and adjust
2. Import via Filing Configuration UI
3. Or convert to a seed script

**Option 2: Manual Entry via UI**

1. Go to Filing Configuration → UI Configuration
2. Click "Add" button
3. Fill in the form:
   - Country: NL
   - Procedure Code: H1
   - Message Name: IE501
   - Message Type: request
   - Field Path: newField.subField (use dot notation)
   - Field Label: New Field Sub Field
   - Field Type: text (or appropriate type)
   - Section: appropriate section name
   - Display Order: numeric order within section
   - Grid Column: 1-12 (default 6)
   - Required: check if required
   - Master Data Source: select if dropdown/lookup

4. Click "Save"

**Option 3: Create a Seed Script**

```typescript
await db.filingUIConfig.create({
  data: {
    country: 'NL',
    procedureCode: 'H1',
    messageName: 'IE501',
    messageType: 'request',
    fieldPath: 'newField.subField',
    fieldLabel: 'New Field Sub Field',
    fieldType: 'text',
    section: 'newSection',
    displayOrder: 1,
    gridColumn: 6,
    isRequired: false,
    isReadOnly: false,
    isVisible: true,
  }
});
```

## Section Organization

Recommended section names:

- **header** - Top-level metadata (declarationId, entryType)
- **parties** - Party information (importer, exporter, filer)
- **transport** - Transport details
- **commercial** - Commercial terms (currency, incoterm)
- **lineItems** - Line items array
- **valuation** - Valuation information
- **totals** - Totals and summary
- **compliance** - Compliance flags
- **evidence** - Evidence and documentation
- **assessment** - Assessment results (response)
- **release** - Release information (response)
- **errors** - Errors and warnings (response)
- **notes** - Remarks and notes (response)

## Field Path Conventions

- **Simple field**: `fieldName`
- **Nested object**: `parent.child`
- **Deep nesting**: `parent.child.grandchild`
- **Array field**: `arrayField[].itemProperty`
- **Deep array nesting**: `lineItems[].packages[].description`

## Grid Layout

The form uses a 12-column grid system:

- **12 columns** - Full width (textarea, checkboxes)
- **6 columns** - Half width (most text inputs)
- **4 columns** - Third width (grouped fields)
- **3 columns** - Quarter width (compact fields)

## Best Practices

1. **Consistent Sections** - Keep section names consistent across procedures
2. **Logical Ordering** - Order fields logically within sections (displayOrder)
3. **Appropriate Field Types** - Use the most specific field type available
4. **Master Data Sources** - Use lookups for standardized data (countries, currencies)
5. **Help Text** - Provide helpful descriptions for complex fields
6. **Required Fields** - Mark required fields according to canonical schema
7. **Grid Columns** - Use appropriate widths for better UX

## Examples

### Example 1: Simple Text Field

```typescript
{
  country: 'NL',
  procedureCode: 'H1',
  messageName: 'IE501',
  messageType: 'request',
  fieldPath: 'importer.name',
  fieldLabel: 'Importer Name',
  fieldType: 'text',
  section: 'parties',
  displayOrder: 10,
  gridColumn: 6,
  isRequired: false,
  placeholder: 'Legal name of importer'
}
```

### Example 2: Dropdown with Master Data

```typescript
{
  country: 'NL',
  procedureCode: 'H1',
  messageName: 'IE501',
  messageType: 'request',
  fieldPath: 'currency',
  fieldLabel: 'Currency',
  fieldType: 'dropdown',
  section: 'commercial',
  displayOrder: 50,
  gridColumn: 6,
  isRequired: true,
  masterDataSource: 'Currency',
  placeholder: '3-letter code (e.g., EUR)'
}
```

### Example 3: Array Field

```typescript
{
  country: 'NL',
  procedureCode: 'H1',
  messageName: 'IE501',
  messageType: 'request',
  fieldPath: 'lineItems[].hsCode6',
  fieldLabel: 'HS Code (6-digit)',
  fieldType: 'lookup',
  section: 'lineItems',
  displayOrder: 62,
  gridColumn: 3,
  isRequired: true,
  isArrayField: true,
  masterDataSource: 'HSCode'
}
```

### Example 4: Read-Only Response Field

```typescript
{
  country: 'NL',
  procedureCode: 'H1',
  messageName: 'IE501',
  messageType: 'response',
  fieldPath: 'authorityReference',
  fieldLabel: 'Authority Reference (MRN)',
  fieldType: 'text',
  section: 'header',
  displayOrder: 5,
  gridColumn: 6,
  isRequired: false,
  isReadOnly: true,
  helpText: 'Movement Reference Number assigned by customs'
}
```

## Migration Path

### Phase 1: Coexistence (Current)
- New filings use DynamicFormRenderer with UI configuration
- Legacy hardcoded forms remain for existing filings

### Phase 2: Migration
- Migrate all procedures to UI configuration
- Create configurations for all countries/procedures
- Test and validate

### Phase 3: Complete
- Remove hardcoded form components
- All forms rendered dynamically
- Easy to extend for new countries/procedures

## Troubleshooting

### No UI Configuration Found
- **Problem**: Form shows "No form configuration available"
- **Solution**: Create UI configuration entries for the country/procedure/message combination

### Dropdown Shows No Options
- **Problem**: Dropdown field is empty
- **Solution**: Check master data source exists and has staticOptions populated

### Field Not Updating
- **Problem**: Field value doesn't persist
- **Solution**: Verify fieldPath matches exact structure in declarationData object

### Wrong Field Type
- **Problem**: Field renders as wrong type
- **Solution**: Update fieldType in UI Configuration to correct type

## Future Enhancements

1. **Conditional Visibility** - Show/hide fields based on other field values
2. **Dynamic Validation** - Complex validation rules from configuration
3. **Field Dependencies** - Auto-populate fields based on other values
4. **Layout Templates** - Pre-defined layouts for common patterns
5. **Version Management** - Track configuration versions over time
6. **Bulk Import/Export** - Import/export configurations as JSON
7. **Schema Sync** - Automatic sync when canonical schema changes

## Support

For questions or issues with UI Configuration:
1. Check this documentation
2. Review existing configurations in Filing Config
3. Use the schema generator script for guidance
4. Contact platform administrators
