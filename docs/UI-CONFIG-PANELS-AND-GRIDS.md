# UI Config - Panels and Grids Feature

**Date**: 2026-08-16  
**Feature**: Display complex types as panels and arrays as grids

---

## 🎯 Goal

Enable UI configuration to:
1. **Complex Type Panels**: Group related fields from a complex object together in a visual panel
2. **Array Grids**: Display array items in a table/grid format instead of individual fields

---

## 📊 Current vs. Desired Behavior

### Complex Types (Objects)

**Current** (Individual Fields):
```
┌─────────────────────────────────────┐
│ Importer Name: [_____________]      │
│ Importer Address: [_____________]   │
│ Importer City: [_____________]      │
│ Importer Country: [_____________]   │
└─────────────────────────────────────┘
```

**Desired** (Grouped Panel):
```
┌─────────────────────────────────────┐
│ ┌─ Importer ───────────────────────┐ │
│ │ Name: [_____________]            │ │
│ │ Address: [_____________]         │ │
│ │ City: [_____________]            │ │
│ │ Country: [_____________]         │ │
│ └──────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

### Arrays (Lists)

**Current** (Accordion/Individual Items):
```
┌─────────────────────────────────────┐
│ ▼ Line Item 1                       │
│   HS Code: [_____________]          │
│   Description: [_____________]      │
│   Quantity: [_____________]         │
│                                     │
│ ▼ Line Item 2                       │
│   HS Code: [_____________]          │
│   Description: [_____________]      │
│   Quantity: [_____________]         │
└─────────────────────────────────────┘
```

**Desired** (Grid/Table):
```
┌──────────────────────────────────────────────────────────┐
│ Line Items                                    [+ Add Row] │
├──────────┬──────────────────┬──────────┬─────────────────┤
│ HS Code  │ Description      │ Quantity │ Value          │
├──────────┼──────────────────┼──────────┼─────────────────┤
│ [______] │ [_____________]  │ [______] │ [___________]  │
│ [______] │ [_____________]  │ [______] │ [___________]  │
│ [______] │ [_____________]  │ [______] │ [___________]  │
└──────────┴──────────────────┴──────────┴─────────────────┘
```

---

## 🗄️ Database Schema Updates

### Step 1: Add displayMode to FilingUIFieldConfig

```prisma
model FilingUIFieldConfig {
  id                String   @id @default(cuid())
  uiConfigId        String
  uiConfig          FilingUIConfig @relation(fields: [uiConfigId], references: [id], onDelete: Cascade)
  
  // Existing fields
  fieldPath         String
  fieldLabel        String
  fieldType         String
  section           String
  displayOrder      Int
  gridColumn        Int
  
  // NEW: Display mode
  displayMode       String   @default("field")  // "field", "panel", "grid", "table"
  
  // NEW: Panel configuration
  panelTitle        String?   // Title for panel mode
  panelCollapsible  Boolean   @default(false)
  panelDefaultOpen  Boolean   @default(true)
  
  // NEW: Grid configuration  
  gridColumnWidth   Int?      // Column width in grid (pixels or %)
  gridColumnAlign   String?   // "left", "center", "right"
  gridSortable      Boolean   @default(false)
  gridFilterable    Boolean   @default(false)
  
  // Existing fields
  isRequired        Boolean
  isReadOnly        Boolean
  isVisible         Boolean
  placeholder       String?
  helpText          String?
  masterDataSource  String?
  isMultiSelect     Boolean
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  @@index([uiConfigId, section])
  @@index([fieldPath])
}
```

---

## 🎨 Configuration Examples

### Example 1: Complex Type as Panel (Importer)

**Schema Path**: `importTransaction.importer`

**UI Config**:
```json
{
  "fields": [
    {
      "fieldPath": "importTransaction.importer.name",
      "fieldLabel": "Name",
      "fieldType": "text",
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Importer Information",
      "panelCollapsible": true,
      "panelDefaultOpen": true,
      "displayOrder": 1,
      "gridColumn": 6,
      "isRequired": true
    },
    {
      "fieldPath": "importTransaction.importer.address",
      "fieldLabel": "Address",
      "fieldType": "text",
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Importer Information",  // Same panel title groups fields
      "displayOrder": 2,
      "gridColumn": 12
    },
    {
      "fieldPath": "importTransaction.importer.city",
      "fieldLabel": "City",
      "fieldType": "text",
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Importer Information",
      "displayOrder": 3,
      "gridColumn": 6
    },
    {
      "fieldPath": "importTransaction.importer.country",
      "fieldLabel": "Country",
      "fieldType": "dropdown",
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Importer Information",
      "displayOrder": 4,
      "gridColumn": 6,
      "masterDataSource": "countries"
    }
  ]
}
```

**Grouping Logic**: All fields with same `panelTitle` are grouped into one panel.

---

### Example 2: Array as Grid (Line Items)

**Schema Path**: `importTransaction.lineItems[]`

**UI Config**:
```json
{
  "fields": [
    {
      "fieldPath": "importTransaction.lineItems[].hsCode",
      "fieldLabel": "HS Code",
      "fieldType": "text",
      "section": "lineItems",
      "displayMode": "grid",
      "gridColumnWidth": 150,
      "gridColumnAlign": "left",
      "gridSortable": true,
      "gridFilterable": true,
      "displayOrder": 1,
      "isRequired": true
    },
    {
      "fieldPath": "importTransaction.lineItems[].description",
      "fieldLabel": "Description",
      "fieldType": "textarea",
      "section": "lineItems",
      "displayMode": "grid",
      "gridColumnWidth": 300,
      "gridColumnAlign": "left",
      "displayOrder": 2
    },
    {
      "fieldPath": "importTransaction.lineItems[].quantity",
      "fieldLabel": "Quantity",
      "fieldType": "number",
      "section": "lineItems",
      "displayMode": "grid",
      "gridColumnWidth": 100,
      "gridColumnAlign": "right",
      "displayOrder": 3
    },
    {
      "fieldPath": "importTransaction.lineItems[].value",
      "fieldLabel": "Value",
      "fieldType": "number",
      "section": "lineItems",
      "displayMode": "grid",
      "gridColumnWidth": 120,
      "gridColumnAlign": "right",
      "gridSortable": true,
      "displayOrder": 4
    }
  ]
}
```

**Grid Rendering**: All fields with `displayMode: "grid"` from same array path are rendered as table columns.

---

## 🧩 Implementation Components

### Component 1: FieldPanel.tsx

Wraps grouped fields in a collapsible panel:

```typescript
interface FieldPanelProps {
  title: string;
  collapsible: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}

export function FieldPanel({ 
  title, 
  collapsible, 
  defaultOpen, 
  children 
}: FieldPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-xl p-4 mb-4">
      <div 
        className="flex items-center justify-between mb-3 cursor-pointer"
        onClick={() => collapsible && setIsOpen(!isOpen)}
      >
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {collapsible && (
          <ChevronDown 
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          />
        )}
      </div>
      
      {isOpen && (
        <div className="grid grid-cols-12 gap-4">
          {children}
        </div>
      )}
    </div>
  );
}
```

---

### Component 2: FieldGrid.tsx

Renders array fields as a table:

```typescript
interface FieldGridProps {
  arrayPath: string;  // e.g., "lineItems"
  columns: Array<{
    fieldPath: string;
    label: string;
    type: string;
    width?: number;
    align?: string;
    sortable?: boolean;
  }>;
  data: any[];
  onChange: (index: number, fieldName: string, value: any) => void;
  onAddRow: () => void;
  onDeleteRow: (index: number) => void;
  readOnly?: boolean;
}

export function FieldGrid({ 
  columns, 
  data, 
  onChange, 
  onAddRow, 
  onDeleteRow,
  readOnly 
}: FieldGridProps) {
  return (
    <div className="border border-border rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between p-3 bg-ink/5 border-b border-border">
        <h3 className="text-sm font-bold text-ink">Line Items</h3>
        {!readOnly && (
          <Button size="sm" onClick={onAddRow}>
            <Plus className="w-4 h-4 mr-1" />
            Add Row
          </Button>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-ink/5 border-b border-border">
            <tr>
              {columns.map((col) => (
                <th 
                  key={col.fieldPath}
                  className="px-3 py-2 text-left text-xs font-semibold text-ink"
                  style={{ width: col.width }}
                >
                  {col.label}
                  {col.sortable && <ArrowUpDown className="w-3 h-3 inline ml-1" />}
                </th>
              ))}
              {!readOnly && <th className="w-12"></th>}
            </tr>
          </thead>
          
          <tbody>
            {data.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border hover:bg-ink/5">
                {columns.map((col) => (
                  <td key={col.fieldPath} className="px-3 py-2">
                    {renderGridCell(
                      col,
                      row,
                      rowIndex,
                      onChange,
                      readOnly
                    )}
                  </td>
                ))}
                
                {!readOnly && (
                  <td className="px-3 py-2 text-right">
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => onDeleteRow(rowIndex)}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderGridCell(
  column: any,
  rowData: any,
  rowIndex: number,
  onChange: any,
  readOnly: boolean
) {
  const fieldName = column.fieldPath.split('[].')[];
  const value = rowData[fieldName] || '';
  
  if (readOnly) {
    return <span className="text-sm text-ink">{value}</span>;
  }
  
  switch (column.type) {
    case 'number':
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(rowIndex, fieldName, e.target.value)}
          className="w-full px-2 py-1 text-sm border border-border rounded"
        />
      );
    
    case 'dropdown':
      return (
        <select
          value={value}
          onChange={(e) => onChange(rowIndex, fieldName, e.target.value)}
          className="w-full px-2 py-1 text-sm border border-border rounded"
        >
          {/* Load options from master data */}
        </select>
      );
    
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(rowIndex, fieldName, e.target.value)}
          className="w-full px-2 py-1 text-sm border border-border rounded"
        />
      );
  }
}
```

---

## 🔧 Updated DynamicFormRenderer

Modify the renderer to detect panels and grids:

```typescript
export default function DynamicFormRenderer({ ... }) {
  // ... existing code ...
  
  // Group fields by display mode
  function organizeFields(fields: UIFieldConfig[]) {
    const panels: Record<string, UIFieldConfig[]> = {};
    const grids: Record<string, UIFieldConfig[]> = {};
    const regularFields: UIFieldConfig[] = [];
    
    fields.forEach(field => {
      if (field.displayMode === 'panel' && field.panelTitle) {
        if (!panels[field.panelTitle]) {
          panels[field.panelTitle] = [];
        }
        panels[field.panelTitle].push(field);
      } else if (field.displayMode === 'grid') {
        const arrayPath = field.fieldPath.split('[]')[0];
        if (!grids[arrayPath]) {
          grids[arrayPath] = [];
        }
        grids[arrayPath].push(field);
      } else {
        regularFields.push(field);
      }
    });
    
    return { panels, grids, regularFields };
  }
  
  return (
    <div>
      {Object.entries(uiConfig.sections).map(([sectionName, fields]) => {
        const { panels, grids, regularFields } = organizeFields(fields);
        
        return (
          <div key={sectionName} className="mb-6">
            <h2 className="text-lg font-bold mb-4">{sectionName}</h2>
            
            {/* Render Panels */}
            {Object.entries(panels).map(([panelTitle, panelFields]) => (
              <FieldPanel
                key={panelTitle}
                title={panelTitle}
                collapsible={panelFields[0].panelCollapsible}
                defaultOpen={panelFields[0].panelDefaultOpen}
              >
                {panelFields.map(field => renderField(field))}
              </FieldPanel>
            ))}
            
            {/* Render Grids */}
            {Object.entries(grids).map(([arrayPath, gridColumns]) => (
              <FieldGrid
                key={arrayPath}
                arrayPath={arrayPath}
                columns={gridColumns}
                data={getArrayData(arrayPath)}
                onChange={handleGridChange}
                onAddRow={() => handleAddRow(arrayPath)}
                onDeleteRow={(index) => handleDeleteRow(arrayPath, index)}
                readOnly={readOnly}
              />
            ))}
            
            {/* Render Regular Fields */}
            <div className="grid grid-cols-12 gap-4">
              {regularFields.map(field => renderField(field))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

---

## 📝 Configuration Workflow

### Step 1: Select Complex Type
In UI Config Editor, when user selects a complex type path (e.g., `importer`):
1. Show all child fields
2. Add option to "Group as Panel"
3. Prompt for panel title
4. Set `displayMode = "panel"` for all child fields

### Step 2: Select Array Type  
When user selects an array path (e.g., `lineItems[]`):
1. Show all array item fields
2. Add option to "Display as Grid"
3. Configure grid columns (width, alignment, sortable)
4. Set `displayMode = "grid"` for all array fields

---

## 🎯 Benefits

1. **Better UX**: Related fields are visually grouped
2. **Space Efficient**: Grid view saves vertical space for arrays
3. **Familiar Interface**: Tables are familiar for data entry
4. **Collapsible Panels**: Users can hide/show sections
5. **Flexible**: Mix panel, grid, and regular fields in same form

---

**Documentation Created**: 2026-08-16 23:50 IST  
**Status**: Design Complete - Ready for Implementation
