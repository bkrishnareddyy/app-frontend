# UI Config - Tabs, Panels, and Grids Feature

**Date**: 2026-08-16  
**Feature**: Display sections as tabs, complex types as panels, and arrays as grids

---

## 🎯 Enhanced Goal

Enable UI configuration to support multiple display modes:
1. **Tabs**: Group sections into tabbed interface for better organization
2. **Panels**: Group related fields from a complex object together in a visual panel
3. **Grids**: Display array items in a table/grid format instead of individual fields
4. **Fields**: Regular individual field display

---

## 📊 Display Modes

### Mode 1: Tabs (Section Level)

**Use Case**: Organize main sections as tabs instead of vertical stacking

**Visual**:
```
┌─────────────────────────────────────────────────────────────┐
│ [Parties] [Transport] [Line Items] [Valuation] [Compliance]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Current Tab: Parties                                       │
│  ┌─ Importer ──────────────────┐                           │
│  │ Name: [_______________]     │                           │
│  │ Address: [_______________]  │                           │
│  └─────────────────────────────┘                           │
│                                                             │
│  ┌─ Exporter ──────────────────┐                           │
│  │ Name: [_______________]     │                           │
│  │ Address: [_______________]  │                           │
│  └─────────────────────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Mode 2: Panels (Complex Type Level)

**Use Case**: Group related fields from nested objects

**Visual**:
```
┌─ Importer Information ───────────────┐
│ Name:     [_______________]          │
│ Address:  [_______________]          │
│ City:     [_______] Zip: [_____]     │
│ Country:  [_______________]          │
└──────────────────────────────────────┘
```

---

### Mode 3: Grids (Array Level)

**Use Case**: Display array items in table format

**Visual**:
```
┌─ Line Items ─────────────────────────┐ [+ Add Row]
├────────┬─────────────────┬──────────┬─────────────┐
│ HS Code│ Description     │ Quantity │ Value       │
├────────┼─────────────────┼──────────┼─────────────┤
│ [____] │ [____________]  │ [______] │ [_________] │
│ [____] │ [____________]  │ [______] │ [_________] │
└────────┴─────────────────┴──────────┴─────────────┘
```

---

### Mode 4: Fields (Default)

**Use Case**: Standard individual field display

**Visual**:
```
Entry Number: [_______________]
Entry Date:   [_______________]
Currency:     [_______________]
```

---

## 🗄️ Database Schema

### Updated FilingUIConfig Model

```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  country         String
  procedureCode   String
  messageName     String
  messageType     String
  transactionType String
  version         String   @default("1.0.0")
  
  // NEW: Tab configuration at config level
  useTabs         Boolean  @default(false)  // Enable/disable tabbed layout
  tabOrder        Json?    // Array of section names in tab order: ["parties", "transport", "lineItems"]
  
  configData      Json
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([country, procedureCode, messageName, messageType, transactionType])
}
```

### Updated Field Configuration

```typescript
interface UIFieldConfig {
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  section: string;
  
  // Display mode: how this field should be rendered
  displayMode: "field" | "panel" | "grid" | "tab";
  
  // Tab configuration (when displayMode = "tab")
  tabGroup?: string;       // Which tab this belongs to (e.g., "parties")
  tabLabel?: string;       // Label for the tab
  tabOrder?: number;       // Order of tabs
  
  // Panel configuration (when displayMode = "panel")
  panelTitle?: string;
  panelCollapsible?: boolean;
  panelDefaultOpen?: boolean;
  
  // Grid configuration (when displayMode = "grid")
  gridColumnWidth?: number;
  gridColumnAlign?: "left" | "center" | "right";
  gridSortable?: boolean;
  gridFilterable?: boolean;
  
  // Standard field properties
  displayOrder: number;
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

## 🎨 Configuration Examples

### Example 1: Tabs for Main Sections

**Scenario**: Create tabs for Parties, Transport, Line Items, and Valuation sections

**FilingUIConfig**:
```json
{
  "country": "NL",
  "procedureCode": "5100",
  "messageName": "IE015",
  "messageType": "request",
  "transactionType": "import",
  "useTabs": true,
  "tabOrder": ["parties", "transport", "lineItems", "valuation", "compliance"],
  "configData": {
    "fields": [...]
  }
}
```

**Field Configs**:
```json
[
  {
    "fieldPath": "importTransaction.importer.name",
    "fieldLabel": "Importer Name",
    "section": "parties",
    "displayMode": "panel",
    "panelTitle": "Importer",
    "tabGroup": "parties",
    "tabLabel": "Parties",
    "tabOrder": 1
  },
  {
    "fieldPath": "importTransaction.transport.modeOfTransport",
    "fieldLabel": "Mode of Transport",
    "section": "transport",
    "displayMode": "field",
    "tabGroup": "transport",
    "tabLabel": "Transport",
    "tabOrder": 2
  },
  {
    "fieldPath": "importTransaction.lineItems[].hsCode",
    "fieldLabel": "HS Code",
    "section": "lineItems",
    "displayMode": "grid",
    "tabGroup": "lineItems",
    "tabLabel": "Line Items",
    "tabOrder": 3,
    "gridColumnWidth": 150
  }
]
```

---

### Example 2: Mixed Display Modes within Tabs

**Tab 1 - Parties**: Contains 2 panels (Importer, Exporter)
**Tab 2 - Transport**: Contains regular fields
**Tab 3 - Line Items**: Contains grid
**Tab 4 - Valuation**: Contains regular fields

```json
{
  "useTabs": true,
  "tabOrder": ["parties", "transport", "lineItems", "valuation"],
  "configData": {
    "fields": [
      // Tab 1: Parties - Panel Mode
      {
        "fieldPath": "importTransaction.importer.name",
        "section": "parties",
        "displayMode": "panel",
        "panelTitle": "Importer",
        "tabGroup": "parties",
        "tabLabel": "Parties",
        "tabOrder": 1
      },
      {
        "fieldPath": "importTransaction.exporter.name",
        "section": "parties",
        "displayMode": "panel",
        "panelTitle": "Exporter",
        "tabGroup": "parties"
      },
      
      // Tab 2: Transport - Field Mode
      {
        "fieldPath": "importTransaction.transport.modeOfTransport",
        "section": "transport",
        "displayMode": "field",
        "tabGroup": "transport",
        "tabLabel": "Transport",
        "tabOrder": 2
      },
      
      // Tab 3: Line Items - Grid Mode
      {
        "fieldPath": "importTransaction.lineItems[].hsCode",
        "section": "lineItems",
        "displayMode": "grid",
        "tabGroup": "lineItems",
        "tabLabel": "Line Items",
        "tabOrder": 3,
        "gridColumnWidth": 150
      },
      
      // Tab 4: Valuation - Field Mode
      {
        "fieldPath": "importTransaction.valuation.totalAmount",
        "section": "valuation",
        "displayMode": "field",
        "tabGroup": "valuation",
        "tabLabel": "Valuation",
        "tabOrder": 4
      }
    ]
  }
}
```

---

## 🧩 Implementation Components

### Component 1: TabbedFormLayout.tsx

Main wrapper that provides tabbed interface:

```typescript
interface Tab {
  id: string;
  label: string;
  order: number;
  fields: UIFieldConfig[];
}

interface TabbedFormLayoutProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  renderTabContent: (tab: Tab) => React.ReactNode;
}

export function TabbedFormLayout({
  tabs,
  activeTab,
  onTabChange,
  renderTabContent
}: TabbedFormLayoutProps) {
  const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);
  
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Tab Headers */}
      <div className="flex border-b border-border bg-ink/5">
        {sortedTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-6 py-3 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-white text-brand border-b-2 border-brand"
                : "text-ink-muted hover:text-ink hover:bg-ink/10"
            }`}
          >
            {tab.label}
            <span className="ml-2 text-xs opacity-60">
              ({tab.fields.length})
            </span>
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div className="p-6 bg-white">
        {sortedTabs.map((tab) => (
          <div
            key={tab.id}
            className={activeTab === tab.id ? "block" : "hidden"}
          >
            {renderTabContent(tab)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Component 2: Updated DynamicFormRenderer

Enhanced to support tabs:

```typescript
export default function DynamicFormRenderer({ ... }) {
  const [activeTab, setActiveTab] = useState<string>("");
  
  // Check if tabs are enabled
  const useTabs = uiConfig?.useTabs || false;
  const tabOrder = uiConfig?.tabOrder || [];
  
  // Organize fields by display mode AND tabs
  function organizeFieldsWithTabs(fields: UIFieldConfig[]) {
    if (!useTabs) {
      // Use existing logic for non-tabbed layout
      return organizeFieldsBySection(fields);
    }
    
    // Group by tab first, then by display mode within each tab
    const tabs: Record<string, {
      label: string;
      order: number;
      fields: UIFieldConfig[];
      panels: Record<string, UIFieldConfig[]>;
      grids: Record<string, UIFieldConfig[]>;
      regularFields: UIFieldConfig[];
    }> = {};
    
    fields.forEach(field => {
      const tabGroup = field.tabGroup || "default";
      
      if (!tabs[tabGroup]) {
        tabs[tabGroup] = {
          label: field.tabLabel || tabGroup,
          order: field.tabOrder || 999,
          fields: [],
          panels: {},
          grids: {},
          regularFields: []
        };
      }
      
      tabs[tabGroup].fields.push(field);
      
      // Further organize within tab by display mode
      if (field.displayMode === 'panel' && field.panelTitle) {
        if (!tabs[tabGroup].panels[field.panelTitle]) {
          tabs[tabGroup].panels[field.panelTitle] = [];
        }
        tabs[tabGroup].panels[field.panelTitle].push(field);
      } else if (field.displayMode === 'grid') {
        const arrayPath = field.fieldPath.split('[]')[0];
        if (!tabs[tabGroup].grids[arrayPath]) {
          tabs[tabGroup].grids[arrayPath] = [];
        }
        tabs[tabGroup].grids[arrayPath].push(field);
      } else {
        tabs[tabGroup].regularFields.push(field);
      }
    });
    
    return tabs;
  }
  
  // Initialize active tab
  useEffect(() => {
    if (useTabs && tabOrder.length > 0 && !activeTab) {
      setActiveTab(tabOrder[0]);
    }
  }, [useTabs, tabOrder]);
  
  if (useTabs) {
    // Render tabbed layout
    const tabsData = organizeFieldsWithTabs(allFields);
    const tabsList = Object.entries(tabsData).map(([id, data]) => ({
      id,
      label: data.label,
      order: data.order,
      fields: data.fields
    }));
    
    return (
      <TabbedFormLayout
        tabs={tabsList}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        renderTabContent={(tab) => {
          const tabData = tabsData[tab.id];
          
          return (
            <div className="space-y-6">
              {/* Render Panels */}
              {Object.entries(tabData.panels).map(([panelTitle, panelFields]) => (
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
              {Object.entries(tabData.grids).map(([arrayPath, gridColumns]) => (
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
              {tabData.regularFields.length > 0 && (
                <div className="grid grid-cols-12 gap-4">
                  {tabData.regularFields.map(field => renderField(field))}
                </div>
              )}
            </div>
          );
        }}
      />
    );
  }
  
  // Render non-tabbed layout (existing logic)
  return <div>...</div>;
}
```

---

## 🎯 Configuration Workflow in UI Config Editor

### Step 1: Enable Tabs (Config Level)

In UIConfigEditor, add a checkbox at the top:

```
┌─────────────────────────────────────────┐
│ UI Configuration Editor                 │
├─────────────────────────────────────────┤
│ ☑ Use Tabbed Layout                     │
│                                         │
│ Tab Order: [Parties] [Transport] [...] │
└─────────────────────────────────────────┘
```

### Step 2: Assign Fields to Tabs

When configuring a field, add tab selection:

```
Field Configuration Panel:
┌─────────────────────────────────────┐
│ Field Path: importer.name           │
│ Field Label: [Importer Name]        │
│ Section: [parties ▼]                │
│                                     │
│ Display Mode: [Panel ▼]             │  ← Select: Field/Panel/Grid
│                                     │
│ Tab Assignment:                     │
│   Tab Group: [parties ▼]            │  ← Which tab
│   Tab Label: [Parties]              │
│   Tab Order: [1]                    │
│                                     │
│ Panel Settings:                     │
│   Panel Title: [Importer]           │
│   ☑ Collapsible                     │
│   ☑ Default Open                    │
└─────────────────────────────────────┘
```

---

## 📊 Visual Example: Complete Form

### Configuration:
- **useTabs**: true
- **Tab 1 - Parties**: 2 panels (Importer, Exporter)
- **Tab 2 - Transport**: Regular fields
- **Tab 3 - Line Items**: Grid
- **Tab 4 - Totals**: Regular fields

### Rendered Output:

```
┌────────────────────────────────────────────────────────────┐
│ Declaration Form                                           │
├────────────────────────────────────────────────────────────┤
│ [Parties] [Transport] [Line Items] [Totals]              │ ← Tabs
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Current Tab: Parties                                       │
│                                                            │
│ ┌─ Importer ─────────────────────────────────────────┐   │ ← Panel 1
│ │ Name:     [_____________________________]          │   │
│ │ Address:  [_____________________________]          │   │
│ │ City:     [____________] Zip: [_______]            │   │
│ │ Country:  [_____________________________]          │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌─ Exporter ─────────────────────────────────────────┐   │ ← Panel 2
│ │ Name:     [_____________________________]          │   │
│ │ Address:  [_____________________________]          │   │
│ │ City:     [____________] Zip: [_______]            │   │
│ │ Country:  [_____________________________]          │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘

[Click "Line Items" tab]

┌────────────────────────────────────────────────────────────┐
│ [Parties] [Transport] [Line Items] [Totals]              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Current Tab: Line Items                                    │
│                                                            │
│ ┌─ Line Items ─────────────────────────────┐ [+ Add Row] │ ← Grid
│ ├──────────┬─────────────┬──────────┬──────────────────┤ │
│ │ HS Code  │ Description │ Quantity │ Value           │ │
│ ├──────────┼─────────────┼──────────┼──────────────────┤ │
│ │ [______] │ [_________] │ [______] │ [_____________] │ │
│ │ [______] │ [_________] │ [______] │ [_____________] │ │
│ │ [______] │ [_________] │ [______] │ [_____________] │ │
│ └──────────┴─────────────┴──────────┴──────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 Summary of Display Modes

| Display Mode | Level | Use Case | Example |
|--------------|-------|----------|---------|
| **Tab** | Section | Organize main sections | Parties, Transport, Line Items tabs |
| **Panel** | Complex Type | Group related object fields | Importer details in one panel |
| **Grid** | Array | Display list items as table | Line items as editable grid |
| **Field** | Individual | Standard single field | Entry Number, Currency, etc. |

---

## 🔧 Database Migration

Add to FilingUIConfig:
```sql
ALTER TABLE "FilingUIConfig" 
ADD COLUMN "useTabs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tabOrder" JSONB;
```

Add to field configuration JSON:
```json
{
  "displayMode": "field|panel|grid",
  "tabGroup": "string",
  "tabLabel": "string",
  "tabOrder": number,
  "panelTitle": "string",
  "panelCollapsible": boolean,
  "gridColumnWidth": number
}
```

---

**Documentation Created**: 2026-08-16 23:55 IST  
**Status**: Enhanced Design with Tabs - Ready for Implementation
