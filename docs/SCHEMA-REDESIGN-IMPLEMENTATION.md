# Schema Redesign Implementation - Summary

## Overview
Implemented support for the redesigned canonical JSON schema structure with per-transaction-type schemas and integrated canonical response fields.

## Schema Structure Changes

### Old Structure:
```
schemas/customs-filing/filing-request-declaration/
  └── 1.0.1.json (single schema for all)
```

### New Structure:
```
schemas/customs-filing/
  ├── filing-schemas/
  │   ├── import/
  │   │   └── 1.0.0/
  │   │       └── ImportDeclaration.schema.json
  │   └── export/
  │       └── 1.0.0/
  │           └── ExportDeclaration.schema.json
  └── filing-response-data/
      └── 1.0.0.json
```

## Changes Made

### 1. Added Canonical Response Fields to Request Schemas

**Fields Added to Response Section** (from `filing-response-data/1.0.0.json`):
- `status` - Enum: ACCEPTED, REJECTED, NEEDS_INFO, RELEASED, CANCELLED, ERROR
- `authorityReference` - Entry number assigned by authority
- `humanMessage` - Plain-language message for display
- `rawResponsePayload` - Raw response from authority (audit only)
- `extensions` - Forward-compatible bucket for additional data

**Updated Files:**
- `schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`
- `schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`

These canonical fields are now at the **top** of the Response section, followed by country-specific fields.

### 2. Updated UI Configuration Editor

**Modal Changes:**
Added new field: **Transaction Type** (Import/Export dropdown)

**Field Order in Modal:**
1. Country (e.g., NL, IE, FR)
2. Procedure Code (e.g., H1, H4, H7)
3. Message Name (e.g., IE501, IE503, IE015)
4. Transaction Type (import/export) - **NEW**
5. Message Type (request/response)
6. Schema Version (e.g., 1.0.0, 1.0.1)

**Schema Loading Logic:**
- Now loads schema based on transaction type: 
  - Import: `/schemas/customs-filing/filing-schemas/import/{version}/ImportDeclaration.schema.json`
  - Export: `/schemas/customs-filing/filing-schemas/export/{version}/ExportDeclaration.schema.json`

**Header Display:**
Shows transaction type: `IMPORT - NL / H1 / IE501 (request) - Schema v1.0.0`

### 3. Copied Schemas to Public Folder

All schemas copied to `public/schemas/` for browser access:
- `public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`
- `public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`
- `public/schemas/customs-filing/filing-response-data/1.0.0.json`

## Benefits

### 1. **Separation of Concerns**
- Import and Export have their own schemas
- Same schemas used for both request and response
- Clear distinction between canonical fields and country-specific fields

### 2. **Canonical Response Fields**
- Consistent response handling across all countries
- `status` enum provides standardized status codes
- `authorityReference` captures the official entry number
- `humanMessage` provides user-friendly messages
- `rawResponsePayload` keeps complete audit trail

### 3. **Flexible UI Configuration**
- Configure fields for import separately from export
- Version-specific configurations
- Transaction type awareness throughout the system

## Response Section Structure

```json
{
  "Response": {
    "type": "object",
    "properties": {
      // === CANONICAL FIELDS (Common across all countries) ===
      "status": { "type": "string", "enum": ["ACCEPTED", "REJECTED", ...] },
      "authorityReference": { "type": "string" },
      "humanMessage": { "type": "string" },
      "rawResponsePayload": { "type": ["object", "array", "string", "null"] },
      "extensions": { "type": "object" },
      
      // === COUNTRY-SPECIFIC FIELDS ===
      "AccountingStatusDescription": { "type": "string" },
      "CustomsStatus": { "type": "string" },
      "DeclarationStatus": { "type": "string" },
      "TemporaryMRN": { "type": "string" },
      // ... and many more country-specific fields
    }
  }
}
```

## Usage Example

### Configuring Import Declaration Fields:
1. Navigate to Filing Configuration → UI Configuration
2. Click "Configure Fields Visually"
3. Select:
   - Country: NL
   - Procedure: H1
   - Message: IE501
   - **Transaction Type: import** ← NEW
   - Message Type: request
   - Schema Version: 1.0.0
4. Click Continue
5. Schema tree shows Import-specific fields
6. Configure fields and save

### Configuring Export Declaration Fields:
Same flow, but select **Transaction Type: export**

## Technical Notes

### Schema Loading Path Pattern:
```typescript
const schemaFileName = transactionType === "import" 
  ? "ImportDeclaration.schema.json" 
  : "ExportDeclaration.schema.json";
  
const path = `/schemas/customs-filing/filing-schemas/${transactionType}/${schemaVersion}/${schemaFileName}`;
```

### Response Field Priority:
1. First check canonical `status` field
2. Then check country-specific `DeclarationStatus` or `CustomsStatus`
3. Use `humanMessage` for display, fallback to country-specific descriptions

## Migration Notes

### If you have existing UI configurations:
- No migration needed for configurations
- Just add Transaction Type when creating new configurations
- Old configurations will continue to work (defaults to import)

### If you need to support more transaction types:
1. Add new schema folder (e.g., `filing-schemas/transit/1.0.0/TransitDeclaration.schema.json`)
2. Add option to Transaction Type dropdown in modal
3. Update schema loading logic to handle new type
4. Add canonical response fields to new schema

## Files Modified

1. **Schemas (source):**
   - `schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`
   - `schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`

2. **Schemas (public):**
   - `public/schemas/customs-filing/filing-schemas/import/1.0.0/ImportDeclaration.schema.json`
   - `public/schemas/customs-filing/filing-schemas/export/1.0.0/ExportDeclaration.schema.json`
   - `public/schemas/customs-filing/filing-response-data/1.0.0.json`

3. **UI Components:**
   - `src/app/app/filing-config/UIConfigEditor.tsx`

## Testing Checklist

- [ ] Can select Import transaction type and load schema
- [ ] Can select Export transaction type and load schema
- [ ] Schema tree displays correct fields for Import
- [ ] Schema tree displays correct fields for Export
- [ ] Response section shows canonical fields at top
- [ ] Response section shows country-specific fields after canonical
- [ ] Can configure and save fields for Import declarations
- [ ] Can configure and save fields for Export declarations
- [ ] Header displays correct transaction type
- [ ] Schema version selection works

## Next Steps

1. Test the UI Configuration editor with both Import and Export
2. Verify Response section fields are accessible in declaration forms
3. Update DynamicFormRenderer to handle Response section display
4. Test with real customs responses to validate canonical field mapping
5. Consider adding validation for required canonical response fields
