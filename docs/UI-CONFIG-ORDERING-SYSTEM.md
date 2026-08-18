# UI Config - Complete Ordering System

**Date**: 2026-08-16  
**Feature**: Comprehensive ordering control for tabs, panels, grids, and fields

---

## 🎯 Ordering Hierarchy

Users need control over the order of display at EVERY level:

```
1. Tab Order          → Which tab appears first, second, third?
   ↓
2. Section Order      → Within a tab, which section comes first?
   ↓
3. Panel Order        → Which panel appears first in a section?
   ↓
4. Field Order        → Within a panel/section, which field is first?
   ↓
5. Grid Column Order  → Which column appears first in a grid?
```

---

## 📊 Ordering at Each Level

### Level 1: Tab Order

**Control**: `tabOrder` field in FilingUIConfig

**Example**:
```json
{
  "useTabs": true,
  "tabOrder": ["overview", "parties", "transport", "lineItems", "totals", "compliance"]
}
```

**Visual Result**:
```
┌─────────────────────────────────────────────────────────────────┐
│ [Overview] [Parties] [Transport] [Line Items] [Totals] [Compliance]
└─────────────────────────────────────────────────────────────────┘
   ↑ 1st    ↑ 2nd     ↑ 3rd       ↑ 4th        ↑ 5th   ↑ 6th
```

**UI Config Editor**:
```
Tab Configuration:
┌──────────────────────────────────────┐
│ ☑ Use Tabbed Layout                  │
│                                      │
│ Tab Order:                           │
│ ┌────────────────────────────────┐  │
│ │ 1. ☰ Overview         [↑] [↓] │  │ ← Drag to reorder
│ │ 2. ☰ Parties          [↑] [↓] │  │
│ │ 3. ☰ Transport        [↑] [↓] │  │
│ │ 4. ☰ Line Items       [↑] [↓] │  │
│ │ 5. ☰ Totals           [↑] [↓] │  │
│ │ 6. ☰ Compliance       [↑] [↓] │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

### Level 2: Section Order (within Tab)

**Control**: `sectionOrder` field per section

**Example**:
```json
{
  "fields": [
    {
      "section": "parties",
      "sectionOrder": 1,  // Parties section appears first in tab
      "tabGroup": "general"
    },
    {
      "section": "commercial",
      "sectionOrder": 2,  // Commercial section appears second
      "tabGroup": "general"
    }
  ]
}
```

**Visual Result**:
```
Tab: General
├─ 1. Parties Section
│  └─ Fields...
├─ 2. Commercial Section
│  └─ Fields...
└─ 3. References Section
   └─ Fields...
```

---

### Level 3: Panel Order (within Section)

**Control**: `panelOrder` field

**Example**:
```json
{
  "fields": [
    {
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Importer",
      "panelOrder": 1  // Importer panel appears first
    },
    {
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Exporter",
      "panelOrder": 2  // Exporter panel appears second
    },
    {
      "section": "parties",
      "displayMode": "panel",
      "panelTitle": "Declarant",
      "panelOrder": 3  // Declarant panel appears third
    }
  ]
}
```

**Visual Result**:
```
Section: Parties
┌─────────────────────────────────┐
│ ┌─ 1. Importer ────────────┐   │ ← First panel
│ │ Name: [_______________]   │   │
│ └───────────────────────────┘   │
│                                 │
│ ┌─ 2. Exporter ────────────┐   │ ← Second panel
│ │ Name: [_______________]   │   │
│ └───────────────────────────┘   │
│                                 │
│ ┌─ 3. Declarant ───────────┐   │ ← Third panel
│ │ Name: [_______________]   │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘
```

**UI Config Editor**:
```
Panel Order Configuration:
┌──────────────────────────────────────┐
│ Section: Parties                     │
│                                      │
│ Panels:                              │
│ ┌────────────────────────────────┐  │
│ │ 1. ☰ Importer         [↑] [↓] │  │ ← Drag to reorder
│ │ 2. ☰ Exporter         [↑] [↓] │  │
│ │ 3. ☰ Declarant        [↑] [↓] │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

### Level 4: Field Order (within Panel/Section)

**Control**: `displayOrder` field (already exists!)

**Example**:
```json
{
  "fields": [
    {
      "fieldPath": "importer.name",
      "panelTitle": "Importer",
      "displayOrder": 1  // First field in panel
    },
    {
      "fieldPath": "importer.address",
      "panelTitle": "Importer",
      "displayOrder": 2  // Second field
    },
    {
      "fieldPath": "importer.city",
      "panelTitle": "Importer",
      "displayOrder": 3  // Third field
    },
    {
      "fieldPath": "importer.country",
      "panelTitle": "Importer",
      "displayOrder": 4  // Fourth field
    }
  ]
}
```

**Visual Result**:
```
┌─ Importer ──────────────────────┐
│ 1. Name:     [_______________]  │ ← displayOrder: 1
│ 2. Address:  [_______________]  │ ← displayOrder: 2
│ 3. City:     [_______________]  │ ← displayOrder: 3
│ 4. Country:  [_______________]  │ ← displayOrder: 4
└─────────────────────────────────┘
```

**UI Config Editor** (when panel is selected):
```
Field Order in Panel: Importer
┌──────────────────────────────────────┐
│ Fields:                              │
│ ┌────────────────────────────────┐  │
│ │ 1. ☰ Name            [↑] [↓]  │  │ ← Drag to reorder
│ │ 2. ☰ Address         [↑] [↓]  │  │
│ │ 3. ☰ City            [↑] [↓]  │  │
│ │ 4. ☰ Country         [↑] [↓]  │  │
│ │ 5. ☰ Postal Code     [↑] [↓]  │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

### Level 5: Grid Column Order

**Control**: `gridColumnOrder` field

**Example**:
```json
{
  "fields": [
    {
      "fieldPath": "lineItems[].lineNumber",
      "displayMode": "grid",
      "gridColumnOrder": 1  // First column
    },
    {
      "fieldPath": "lineItems[].hsCode",
      "displayMode": "grid",
      "gridColumnOrder": 2  // Second column
    },
    {
      "fieldPath": "lineItems[].description",
      "displayMode": "grid",
      "gridColumnOrder": 3  // Third column
    },
    {
      "fieldPath": "lineItems[].quantity",
      "displayMode": "grid",
      "gridColumnOrder": 4  // Fourth column
    },
    {
      "fieldPath": "lineItems[].value",
      "displayMode": "grid",
      "gridColumnOrder": 5  // Fifth column
    }
  ]
}
```

**Visual Result**:
```
┌─ Line Items ─────────────────────────────────────────────────┐
├──────┬──────────┬──────────────┬──────────┬─────────────────┤
│ Line │ HS Code  │ Description  │ Quantity │ Value          │
│  #   │          │              │          │                │
├──────┼──────────┼──────────────┼──────────┼─────────────────┤
  ↑ 1    ↑ 2        ↑ 3            ↑ 4        ↑ 5
```

**UI Config Editor** (when grid array is selected):
```
Grid Column Order: Line Items
┌──────────────────────────────────────┐
│ Columns:                             │
│ ┌────────────────────────────────┐  │
│ │ 1. ☰ Line Number     [↑] [↓]  │  │ ← Drag to reorder
│ │ 2. ☰ HS Code         [↑] [↓]  │  │
│ │ 3. ☰ Description     [↑] [↓]  │  │
│ │ 4. ☰ Quantity        [↑] [↓]  │  │
│ │ 5. ☰ Value           [↑] [↓]  │  │
│ │ 6. ☰ Country Origin  [↑] [↓]  │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## 🗄️ Complete Database Schema

### FilingUIConfig (Config Level)

```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  country         String
  procedureCode   String
  messageName     String
  messageType     String
  transactionType String
  version         String   @default("1.0.0")
  
  // Tab configuration
  useTabs         Boolean  @default(false)
  tabOrder        Json?    // Array: ["overview", "parties", "transport", ...]
  
  configData      Json
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([country, procedureCode, messageName, messageType, transactionType])
}
```

### Field Configuration (in configData JSON)

```typescript
interface UIFieldConfig {
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  
  // Hierarchy & Grouping
  section: string;
  sectionOrder: number;        // NEW: Order of sections within tab
  
  // Display Mode
  displayMode: "field" | "panel" | "grid";
  
  // Tab Configuration
  tabGroup?: string;
  tabLabel?: string;
  tabOrder?: number;           // Already in design, for tab-level ordering
  
  // Panel Configuration
  panelTitle?: string;
  panelOrder?: number;         // NEW: Order of panels within section
  panelCollapsible?: boolean;
  panelDefaultOpen?: boolean;
  
  // Grid Configuration
  gridColumnOrder?: number;    // NEW: Order of columns in grid
  gridColumnWidth?: number;
  gridColumnAlign?: "left" | "center" | "right";
  gridSortable?: boolean;
  gridFilterable?: boolean;
  
  // Field Configuration
  displayOrder: number;        // EXISTING: Order of fields within panel/section
  gridColumn: number;
  isRequired: boolean;
  isReadOnly: boolean;
  isVisible: boolean;
  placeholder?: string;
  helpText?: string;
  masterDataSource?: string;
  isMultiSelect: boolean;
}
```

---

## 🎨 UI Config Editor - Ordering Interface

### Master View with All Ordering Controls

```
┌────────────────────────────────────────────────────────────┐
│ UI Configuration Editor                                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ☑ Use Tabbed Layout                                        │
│                                                            │
│ ┌─ Tab Configuration ────────────────────────────────┐    │
│ │ Drag tabs to reorder:                              │    │
│ │ ┌──────────────────────────────────────────────┐  │    │
│ │ │ 1. ☰ Overview           [↑] [↓] [×] [⚙]    │  │    │
│ │ │ 2. ☰ Parties            [↑] [↓] [×] [⚙]    │  │    │
│ │ │ 3. ☰ Transport          [↑] [↓] [×] [⚙]    │  │    │
│ │ │ 4. ☰ Line Items         [↑] [↓] [×] [⚙]    │  │    │
│ │ │ 5. ☰ Valuation          [↑] [↓] [×] [⚙]    │  │    │
│ │ └──────────────────────────────────────────────┘  │    │
│ │                                  [+ Add Tab]      │    │
│ └────────────────────────────────────────────────────┘    │
│                                                            │
│ ┌─ Selected Tab: Parties ────────────────────────────┐    │
│ │                                                     │    │
│ │ ┌─ Panels in this Tab ───────────────────────┐    │    │
│ │ │ 1. ☰ Importer        [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 2. ☰ Exporter        [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 3. ☰ Declarant       [↑] [↓] [×] [⚙]      │    │    │
│ │ └─────────────────────────────────────────────┘    │    │
│ │                           [+ Add Panel]            │    │
│ │                                                     │    │
│ │ ┌─ Selected Panel: Importer ─────────────────┐    │    │
│ │ │ Fields:                                     │    │    │
│ │ │ 1. ☰ Name            [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 2. ☰ Address         [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 3. ☰ City            [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 4. ☰ Postal Code     [↑] [↓] [×] [⚙]      │    │    │
│ │ │ 5. ☰ Country         [↑] [↓] [×] [⚙]      │    │    │
│ │ └─────────────────────────────────────────────┘    │    │
│ │                           [+ Add Field]            │    │
│ └─────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘

Legend:
☰  = Drag handle
[↑] = Move up
[↓] = Move down
[×] = Remove
[⚙] = Configure
```

---

## 🔧 Implementation Components

### Component 1: OrderableList.tsx

Reusable component for drag-and-drop ordering:

```typescript
interface OrderableItem {
  id: string;
  label: string;
  order: number;
}

interface OrderableListProps {
  items: OrderableItem[];
  onReorder: (newOrder: OrderableItem[]) => void;
  onRemove?: (id: string) => void;
  onConfigure?: (id: string) => void;
}

export function OrderableList({ 
  items, 
  onReorder, 
  onRemove, 
  onConfigure 
}: OrderableListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newItems = [...items];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    updateOrder(newItems);
  };
  
  const handleMoveDown = (index: number) => {
    if (index === items.length - 1) return;
    const newItems = [...items];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    updateOrder(newItems);
  };
  
  const updateOrder = (newItems: OrderableItem[]) => {
    const reordered = newItems.map((item, idx) => ({
      ...item,
      order: idx + 1
    }));
    onReorder(reordered);
  };
  
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          draggable
          onDragStart={() => setDraggedIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (draggedIndex !== null && draggedIndex !== index) {
              const newItems = [...items];
              const [removed] = newItems.splice(draggedIndex, 1);
              newItems.splice(index, 0, removed);
              updateOrder(newItems);
              setDraggedIndex(null);
            }
          }}
          className="flex items-center gap-2 p-2 border border-border rounded-lg hover:bg-ink/5 cursor-move"
        >
          <span className="text-ink-muted">☰</span>
          <span className="flex-1 text-sm font-semibold text-ink">
            {item.order}. {item.label}
          </span>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleMoveUp(index)}
              disabled={index === 0}
              className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              onClick={() => handleMoveDown(index)}
              disabled={index === items.length - 1}
              className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
            {onRemove && (
              <button
                onClick={() => onRemove(item.id)}
                className="p-1 text-red-600 hover:text-red-700"
                title="Remove"
              >
                ×
              </button>
            )}
            {onConfigure && (
              <button
                onClick={() => onConfigure(item.id)}
                className="p-1 text-brand hover:text-brand-dark"
                title="Configure"
              >
                ⚙
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

### Component 2: TabOrderEditor.tsx

Specific component for managing tab order:

```typescript
interface TabOrderEditorProps {
  tabs: Array<{ id: string; label: string; order: number }>;
  onReorder: (tabs: Array<{ id: string; label: string; order: number }>) => void;
}

export function TabOrderEditor({ tabs, onReorder }: TabOrderEditorProps) {
  return (
    <div className="border border-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-ink mb-3">Tab Order</h3>
      <OrderableList
        items={tabs}
        onReorder={onReorder}
        onConfigure={(id) => {
          // Open tab configuration modal
        }}
      />
      <Button className="mt-3" size="sm" variant="outline">
        <Plus className="w-4 h-4 mr-2" />
        Add Tab
      </Button>
    </div>
  );
}
```

---

## 🎯 Complete Ordering Example

### Scenario: Custom Declaration Form Layout

**User wants**:
1. Tabs: Overview → Parties → Line Items → Totals
2. Parties Tab has 2 panels: Importer (first), Exporter (second)
3. Importer Panel fields: Name, Address, City, Country (in that order)
4. Line Items Tab has grid with columns: Line#, HS Code, Description, Quantity, Value

**Configuration**:
```json
{
  "useTabs": true,
  "tabOrder": ["overview", "parties", "lineItems", "totals"],
  "configData": {
    "fields": [
      // Overview Tab - Field 1
      {
        "fieldPath": "declarationId",
        "section": "overview",
        "sectionOrder": 1,
        "tabGroup": "overview",
        "tabLabel": "Overview",
        "tabOrder": 1,
        "displayMode": "field",
        "displayOrder": 1
      },
      
      // Parties Tab - Importer Panel
      {
        "fieldPath": "importer.name",
        "section": "parties",
        "sectionOrder": 1,
        "tabGroup": "parties",
        "tabLabel": "Parties",
        "tabOrder": 2,
        "displayMode": "panel",
        "panelTitle": "Importer",
        "panelOrder": 1,
        "displayOrder": 1
      },
      {
        "fieldPath": "importer.address",
        "section": "parties",
        "displayMode": "panel",
        "panelTitle": "Importer",
        "panelOrder": 1,
        "displayOrder": 2
      },
      
      // Parties Tab - Exporter Panel
      {
        "fieldPath": "exporter.name",
        "section": "parties",
        "displayMode": "panel",
        "panelTitle": "Exporter",
        "panelOrder": 2,
        "displayOrder": 1
      },
      
      // Line Items Tab - Grid
      {
        "fieldPath": "lineItems[].lineNumber",
        "section": "lineItems",
        "tabGroup": "lineItems",
        "tabLabel": "Line Items",
        "tabOrder": 3,
        "displayMode": "grid",
        "gridColumnOrder": 1
      },
      {
        "fieldPath": "lineItems[].hsCode",
        "section": "lineItems",
        "displayMode": "grid",
        "gridColumnOrder": 2
      }
    ]
  }
}
```

**Rendered Output**:
```
┌──────────────────────────────────────────────────────────┐
│ [Overview] [Parties] [Line Items] [Totals]              │ ← tabOrder
├──────────────────────────────────────────────────────────┤
│ Tab: Parties                                             │
│                                                          │
│ ┌─ Importer ──────────────────────────────────────┐    │ ← panelOrder: 1
│ │ 1. Name:     [_____________________________]    │    │ ← displayOrder: 1
│ │ 2. Address:  [_____________________________]    │    │ ← displayOrder: 2
│ │ 3. City:     [_____________________________]    │    │ ← displayOrder: 3
│ │ 4. Country:  [_____________________________]    │    │ ← displayOrder: 4
│ └─────────────────────────────────────────────────┘    │
│                                                          │
│ ┌─ Exporter ──────────────────────────────────────┐    │ ← panelOrder: 2
│ │ 1. Name:     [_____________________________]    │    │
│ │ 2. Address:  [_____________________________]    │    │
│ └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## ✅ Summary

### Ordering Capabilities

| Level | Control Field | Purpose | UI Control |
|-------|--------------|---------|------------|
| **Tabs** | `tabOrder` (array) | Order of tabs | Drag-and-drop list |
| **Sections** | `sectionOrder` | Order of sections within tab | Drag-and-drop list |
| **Panels** | `panelOrder` | Order of panels within section | Drag-and-drop list |
| **Fields** | `displayOrder` | Order of fields within panel | Drag-and-drop list |
| **Grid Columns** | `gridColumnOrder` | Order of columns in grid | Drag-and-drop list |

### Benefits
1. ✅ **Full Control**: Users can arrange UI exactly as needed
2. ✅ **Intuitive**: Drag-and-drop or up/down arrows
3. ✅ **Hierarchical**: Ordering at every level of nesting
4. ✅ **Visual Feedback**: Preview shows exact layout
5. ✅ **Persistent**: Configuration saved to database

---

**Documentation Created**: 2026-08-16 23:55 IST  
**Status**: Complete Ordering System Design - Ready for Implementation
