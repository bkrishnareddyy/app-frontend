# Action Plan: Schema Integration Fixes

## Based on System Evaluation (SHIPMENT-TO-FILING-EVALUATION.md)

---

## Executive Summary

**Status**: ✅ **UI Configuration System** is ready for new schemas  
**Gap**: ⚠️ **Data Mapping Layer** needs implementation

The evaluation revealed that:
1. ✅ **Schema structure is correct** - Import/Export per transaction type
2. ✅ **Response fields added** - Canonical fields in place
3. ✅ **UI Config infrastructure ready** - SchemaTreeViewer, FieldConfigPanel, DynamicFormRenderer all support nested paths
4. ⚠️ **Missing**: Comprehensive field mapping from shipment to new schema structure

---

## Phase 1: Critical Fixes (DO NOW)

### Fix 1: Update Schema Loading to Handle Wrapper Objects

**File**: `src/app/app/filing-config/SchemaTreeViewer.tsx`

**Issue**: Import/Export schemas have root wrappers (`ImportDeclaration`, `ExportDeclaration`) that should be transparent to users

**Current Behavior**: Tree shows:
```
└── ImportDeclaration
    └── GoodsDeclaration
        ├── DeclarationNumber
        ├── Procedure
        └── ...
```

**Desired Behavior**: Tree shows GoodsDeclaration as root:
```
└── GoodsDeclaration
    ├── DeclarationNumber
    ├── Procedure
    └── ...
```

**Solution**: Add wrapper detection logic in buildTree():

```typescript
// In SchemaTreeViewer.tsx, buildTree() function
export default function SchemaTreeViewer({ schema, selectedPath, onSelectPath }: SchemaTreeViewerProps) {
  // ...existing code...

  // Build tree structure from JSON schema
  const buildTree = (
    schemaObj: any,
    path: string = "",
    name: string = "root",
    parentRequired: string[] = []
  ): SchemaTreeNode[] => {
    const nodes: SchemaTreeNode[] = [];

    // === NEW: Detect and unwrap root transaction type wrappers ===
    if (path === "" && schemaObj.properties) {
      const rootKeys = Object.keys(schemaObj.properties);
      
      // If schema has single root property named ImportDeclaration or ExportDeclaration
      if (rootKeys.length === 1 && (rootKeys[0] === "ImportDeclaration" || rootKeys[0] === "ExportDeclaration")) {
        const wrapper = schemaObj.properties[rootKeys[0]];
        
        // Unwrap and treat the inner structure as root
        if (wrapper.properties) {
          return buildTree(wrapper, "", "root", wrapper.required || []);
        }
      }
    }
    // === END NEW CODE ===

    // Handle $defs (definitions)
    const defs = schemaObj.$defs || schemaObj.definitions || {};
    
    // ... rest of existing code ...
  };
}
```

**Test**: Load Import schema, verify tree shows GoodsDeclaration at top level

---

### Fix 2: Update Field Path Construction

**File**: `src/app/app/filing-config/FieldConfigPanel.tsx`

**Issue**: When user selects a field, the fieldPath needs to include the transaction wrapper for backend storage

**Current**: `"GoodsDeclaration.DeclarationNumber"`
**Required**: `"ImportDeclaration.GoodsDeclaration.DeclarationNumber"`

**Solution**: Store transaction type in UIConfigEditor state and prepend wrapper:

```typescript
// In UIConfigEditor.tsx
const [wrapperPrefix, setWrapperPrefix] = useState<string>("");

// In handleSelectTarget() function
const handleSelectTarget = (selection: ConfigSelection) => {
  // ... existing code ...
  
  // Determine wrapper prefix based on transaction type
  const wrapper = selection.transactionType === "import" 
    ? "ImportDeclaration" 
    : "ExportDeclaration";
  
  setWrapperPrefix(wrapper);
  // ... existing code ...
};

// Pass wrapperPrefix to FieldConfigPanel as prop
<FieldConfigPanel
  selectedNode={selectedNode}
  wrapperPrefix={wrapperPrefix}  // NEW PROP
  onSave={handleSaveConfig}
  onClose={() => setSelectedNode(null)}
/>
```

```typescript
// In FieldConfigPanel.tsx
interface FieldConfigPanelProps {
  selectedNode: SchemaTreeNode | null;
  wrapperPrefix: string;  // NEW PROP
  onSave: (config: Partial<FilingUIConfig>) => void;
  onClose: () => void;
}

// In handleSave() function
const handleSave = () => {
  // Prepend wrapper to field path
  const fullPath = wrapperPrefix 
    ? `${wrapperPrefix}.${fieldPath}` 
    : fieldPath;
  
  onSave({
    ...formData,
    fieldPath: fullPath,  // Use full path with wrapper
  });
};
```

**Test**: Configure a field, save, verify database has full path with wrapper

---

### Fix 3: Add Transaction Type to FilingUIConfig

**File**: `prisma/schema.prisma`

**Issue**: UI configs need to distinguish between Import and Export schemas

**Current Schema**:
```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  accountId       String
  country         String
  procedureCode   String
  messageName     String
  messageType     String   // request/response
  
  fieldPath       String
  fieldLabel      String
  // ... other fields ...
  
  @@unique([country, procedureCode, messageName, messageType, fieldPath])
}
```

**Required Schema**:
```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  accountId       String
  country         String
  procedureCode   String
  messageName     String
  messageType     String   // request/response
  transactionType String   // import/export  <-- NEW FIELD
  
  fieldPath       String
  fieldLabel      String
  // ... other fields ...
  
  @@unique([country, procedureCode, messageName, messageType, transactionType, fieldPath])  // Updated unique constraint
}
```

**Migration Steps**:
1. Update `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add-transaction-type`
3. Update `src/app/api/filing-config/ui-configuration/route.ts` to handle transactionType
4. Update `src/app/api/filing/ui-config/route.ts` query to filter by transactionType

**Files to Update**:
- `prisma/schema.prisma` - Add field and update unique constraint
- `src/app/api/filing-config/ui-configuration/route.ts` - Accept transactionType in POST/PUT
- `src/app/api/filing/ui-config/route.ts` - Add transactionType to query params
- `src/app/app/filing/[id]/DynamicFormRenderer.tsx` - Pass transactionType to API
- `src/app/app/filing/[id]/FilingDetailClient.tsx` - Determine transactionType from filing

---

### Fix 4: Add Transaction Type Determination

**File**: `src/app/app/filing/[id]/FilingDetailClient.tsx`

**Issue**: Need to determine if filing is import or export to load correct schema

**Current**: Filings have `entryType` (e.g., "01", "11") but not explicit transaction type

**Solution**: Add mapping logic based on entryType or procedure:

```typescript
// In FilingDetailClient.tsx
const determineTransactionType = (entryType: string | null, procedureCode: string | null): "import" | "export" => {
  // Strategy 1: Use entryType mapping (US-specific)
  if (entryType) {
    // Import entry types: 01, 02, 03, 06, 07, 08, 11
    // Export entry types: 40, 41, 42
    const importTypes = ["01", "02", "03", "06", "07", "08", "11"];
    const exportTypes = ["40", "41", "42"];
    
    if (importTypes.includes(entryType)) return "import";
    if (exportTypes.includes(entryType)) return "export";
  }
  
  // Strategy 2: Use procedure code (multi-country)
  if (procedureCode) {
    // Common patterns:
    // H1, H2 = Import procedures (EU)
    // E1, E2 = Export procedures (EU)
    const procedureUpper = procedureCode.toUpperCase();
    if (procedureUpper.startsWith('H')) return "import";
    if (procedureUpper.startsWith('E')) return "export";
  }
  
  // Default: assume import
  return "import";
};

// Use in component
const transactionType = determineTransactionType(filing.entryType, filing.procedureCode);

// Pass to DynamicFormRenderer
<DynamicFormRenderer
  country={filing.country || "US"}
  procedureCode={filing.procedureCode || "H1"}
  messageName={filing.messageName || "IE501"}
  messageType="request"
  transactionType={transactionType}  // NEW PROP
  data={declarationData}
  onChange={updateDeclarationField}
  readOnly={filing.filingStatus !== "Draft"}
/>
```

**Update DynamicFormRenderer interface**:
```typescript
// In DynamicFormRenderer.tsx
interface DynamicFormRendererProps {
  country: string;
  procedureCode: string;
  messageName: string;
  messageType: "request" | "response";
  transactionType: "import" | "export";  // NEW PROP
  data: Record<string, any>;
  onChange: (fieldPath: string, value: any) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

// Update API call
const response = await fetch(
  `/api/filing/ui-config?country=${country}&procedureCode=${procedureCode}&messageName=${messageName}&messageType=${messageType}&transactionType=${transactionType}`
);
```

---

## Phase 2: Enhanced Mapping (NEXT SPRINT)

### Task 1: Create Field Mapping Configuration Table

**File**: `prisma/schema.prisma`

Add comprehensive mapping table:

```prisma
model FilingFieldMapping {
  id              String  @id @default(cuid())
  accountId       String
  country         String
  procedureCode   String
  transactionType String  // import/export
  
  // Source (shipment field)
  sourceField     String  // e.g., "shipmentNumber"
  sourceType      String  // shipment, lineItem, party, document
  
  // Target (schema field)
  targetPath      String  // e.g., "ImportDeclaration.GoodsDeclaration.DeclarationNumber"
  
  // Transformation
  transformType   String? // direct, calculated, lookup, constant
  transformValue  String? // For constant or lookup key
  transformCode   String? // For complex transformations
  
  isRequired      Boolean @default(false)
  defaultValue    String?
  
  isActive        Boolean @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([accountId, country, procedureCode, transactionType, targetPath])
  @@index([country, procedureCode, transactionType])
}
```

### Task 2: Create Default Values Configuration Table

```prisma
model FilingDefaultValue {
  id              String   @id @default(cuid())
  accountId       String
  country         String
  procedureCode   String
  transactionType String
  
  fieldPath       String   // e.g., "ImportDeclaration.GoodsDeclaration.FunctionCode"
  defaultValue    String   // e.g., "9"
  valueType       String   // string, number, boolean, array, object
  
  description     String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([accountId, country, procedureCode, transactionType, fieldPath])
  @@index([country, procedureCode, transactionType])
}
```

### Task 3: Implement Enhanced Declaration Builder

**File**: `src/lib/canonicalMessaging/declarationBuilder.ts`

Create transaction-specific builders:

```typescript
export async function buildCanonicalDeclaration(params: BuildDeclarationParams): Promise<CanonicalCustomsDeclaration> {
  const { transactionType } = params;
  
  if (transactionType === "import") {
    return buildImportDeclaration(params);
  } else if (transactionType === "export") {
    return buildExportDeclaration(params);
  }
  
  throw new Error(`Unknown transaction type: ${transactionType}`);
}

async function buildImportDeclaration(params: BuildDeclarationParams) {
  const { accountId, country, procedureCode, snapshotData, tariff } = params;
  
  // 1. Load field mappings for this configuration
  const mappings = await db.filingFieldMapping.findMany({
    where: {
      accountId,
      country,
      procedureCode,
      transactionType: "import",
      isActive: true
    }
  });
  
  // 2. Load default values
  const defaults = await db.filingDefaultValue.findMany({
    where: {
      accountId,
      country,
      procedureCode,
      transactionType: "import",
      isActive: true
    }
  });
  
  // 3. Build declaration using mappings
  const declaration: any = {
    ImportDeclaration: {
      GoodsDeclaration: {}
    }
  };
  
  // 4. Apply default values first
  for (const def of defaults) {
    setNestedValue(declaration, def.fieldPath, parseValue(def.defaultValue, def.valueType));
  }
  
  // 5. Apply field mappings
  for (const mapping of mappings) {
    const sourceValue = getSourceValue(snapshotData, mapping.sourceField, mapping.sourceType);
    const transformedValue = applyTransform(sourceValue, mapping.transformType, mapping.transformValue);
    setNestedValue(declaration, mapping.targetPath, transformedValue);
  }
  
  // 6. Apply calculated fields (tariff, etc.)
  setNestedValue(declaration, "ImportDeclaration.GoodsDeclaration.InvoiceAmount", tariff.totalCustomsValue);
  setNestedValue(declaration, "ImportDeclaration.GoodsDeclaration.GoodsItemQuantity", snapshotData.lineItems.length);
  
  return declaration;
}

function getSourceValue(snapshot: FilingSnapshotData, sourceField: string, sourceType: string): any {
  switch (sourceType) {
    case "shipment":
      return snapshot.shipment[sourceField];
    case "lineItem":
      return snapshot.lineItems.map(item => item[sourceField]);
    case "filingHeader":
      return snapshot.filingHeader[sourceField];
    default:
      return null;
  }
}

function applyTransform(value: any, transformType: string | null, transformValue: string | null): any {
  switch (transformType) {
    case "direct":
      return value;
    case "constant":
      return transformValue;
    case "lookup":
      // Implement lookup from master data
      return value;
    case "calculated":
      // Implement calculated values
      return value;
    default:
      return value;
  }
}

function setNestedValue(obj: any, path: string, value: any) {
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  
  current[keys[keys.length - 1]] = value;
}

function parseValue(value: string, valueType: string): any {
  switch (valueType) {
    case "number":
      return parseFloat(value);
    case "boolean":
      return value === "true";
    case "array":
      return JSON.parse(value);
    case "object":
      return JSON.parse(value);
    default:
      return value;
  }
}
```

---

## Phase 3: Response Processing (WEEK AFTER)

### Task 1: Update Inbound Message Consumer

**File**: `src/lib/canonicalMessaging/inboundConsumer.ts`

Add response parsing logic:

```typescript
async function processFilingResponse(message: CanonicalMessage) {
  const { header, data } = message;
  
  // Extract transaction type from header or data structure
  const transactionType = determineTransactionType(data);
  
  let response;
  if (transactionType === "import") {
    response = data.ImportDeclaration?.GoodsDeclaration?.Response;
  } else if (transactionType === "export") {
    response = data.ExportDeclaration?.Response;
  }
  
  if (!response) {
    throw new Error("Response section not found in message");
  }
  
  // Extract canonical fields
  const canonicalStatus = response.status;  // ACCEPTED, REJECTED, etc.
  const authorityRef = response.authorityReference || response.MRN || response.EntryNumber;
  const humanMessage = response.humanMessage || response.DeclarationStatus;
  const rawResponse = response.rawResponsePayload || response;
  
  // Map canonical status to filing status
  const filingStatus = mapCanonicalStatusToFilingStatus(canonicalStatus);
  
  // Update filing
  await db.customsFiling.update({
    where: { id: header.filingId },
    data: {
      filingStatus,
      authorityReference: authorityRef,
      responseMessage: humanMessage,
      responseData: JSON.stringify(rawResponse),
      responseReceivedAt: new Date()
    }
  });
  
  // Create filing message record
  await db.filingMessage.create({
    data: {
      filingId: header.filingId,
      messageId: header.messageId,
      correlationId: header.correlationId,
      direction: "INBOUND",
      messageName: header.messageName,
      messageData: JSON.stringify(data),
      status: filingStatus,
      receivedAt: new Date()
    }
  });
}

function mapCanonicalStatusToFilingStatus(canonicalStatus: string): string {
  const mapping: Record<string, string> = {
    "ACCEPTED": "Submitted",
    "REJECTED": "ValidationFailed",
    "NEEDS_INFO": "DocumentsRequested",
    "RELEASED": "Released",
    "CANCELLED": "Cancelled",
    "ERROR": "SystemError"
  };
  
  return mapping[canonicalStatus] || "Processing";
}
```

---

## Phase 4: Testing & Validation

### Test Cases

**Test 1: UI Configuration with Import Schema**
- [ ] Open UI Config Editor
- [ ] Select: Country=NL, Procedure=H1, Message=IE501, Transaction=Import
- [ ] Verify schema loads and tree displays GoodsDeclaration at root
- [ ] Configure field: DeclarationNumber
- [ ] Save and verify database has full path: `ImportDeclaration.GoodsDeclaration.DeclarationNumber`

**Test 2: UI Configuration with Export Schema**
- [ ] Select: Country=NL, Procedure=E1, Message=EX501, Transaction=Export
- [ ] Verify schema loads and tree displays correctly
- [ ] Configure field and verify full path includes ExportDeclaration wrapper

**Test 3: Dynamic Form Rendering**
- [ ] Create filing with UI configs
- [ ] Verify Declaration tab renders fields based on configs
- [ ] Verify nested paths work correctly (GoodsDeclaration.DeclarationNumber)
- [ ] Test data entry and save

**Test 4: Field Mapping (Phase 2)**
- [ ] Create field mappings for Import
- [ ] Create shipment and convert to filing
- [ ] Verify declaration built with correct mapped fields
- [ ] Transmit and check message structure

**Test 5: Response Processing (Phase 3)**
- [ ] Send test filing
- [ ] Simulate inbound response with canonical fields
- [ ] Verify filing status updated
- [ ] Verify authority reference stored
- [ ] Verify human message displayed

---

## Summary of Required Changes

### Immediate (This Session):
1. ✅ SchemaTreeViewer: Unwrap ImportDeclaration/ExportDeclaration root
2. ✅ FieldConfigPanel: Prepend transaction wrapper to field paths
3. ✅ Database: Add transactionType to FilingUIConfig
4. ✅ FilingDetailClient: Determine transaction type from filing
5. ✅ DynamicFormRenderer: Accept and use transactionType param

### Next Sprint:
6. ⏭ Create FilingFieldMapping table
7. ⏭ Create FilingDefaultValue table
8. ⏭ Implement buildImportDeclaration() function
9. ⏭ Implement buildExportDeclaration() function

### Future:
10. ⏭ Update inbound response consumer
11. ⏭ Build field mapping configuration UI
12. ⏭ Add schema validation
13. ⏭ Add migration tools

---

## Decision Log

**Decision 1**: Keep transaction wrapper in database field paths
- **Reason**: Full path needed for uniqueness and clarity
- **Impact**: UI must prepend wrapper when saving configs

**Decision 2**: Unwrap transaction wrapper in tree display
- **Reason**: Better UX - users don't need to see technical wrapper
- **Impact**: SchemaTreeViewer logic more complex

**Decision 3**: Use procedure code pattern for transaction type detection
- **Reason**: Multi-country support (not US-only)
- **Impact**: Procedure codes must follow convention (H*=import, E*=export)

**Decision 4**: Gradual migration approach
- **Reason**: Minimize breaking changes to existing code
- **Impact**: Longer timeline but safer rollout
