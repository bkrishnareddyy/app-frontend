# UI Configuration System - Gap Analysis (REVISED)

## Executive Summary

This document identifies gaps between the current UI configuration implementation and the comprehensive architecture design documented in `DYNAMIC-UI-CONFIGURATION-ARCHITECTURE.md`.

**Analysis Date:** August 17, 2026  
**Current Status:** Minimal JSON-based implementation with basic field configuration  
**Target State:** Full schema-driven dynamic UI system using JSON structure  
**Architecture:** Single-table JSON-based (FilingUIConfig.configData)

---

## ? Current Implementation (What Exists)

### **Database Schema: FilingUIConfig**
```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  country         String
  procedureCode   String
  messageName     String
  messageType     String   // "request" or "response"
  transactionType String   // "import" or "export"
  configData      Json     // ? ALL configuration stored here
  version         Int      @default(1)
  isActive        Boolean  @default(true)
  ...
}
```

### **Current JSON Structure:**
```json
{
  "fields": [
    {
      "fieldPath": "goodsDeclaration.declarationNumber",
      "fieldLabel": "Declaration Number",
      "fieldType": "text",
      "section": "header",
      "displayOrder": 10,
      "gridColumn": 6,
      "isRequired": false,
      "isReadOnly": false,
      "isVisible": true,
      "placeholder": "Enter declaration number",
      "helpText": "Unique identifier",
      "masterDataSource": null,
      "isMultiSelect": false,
      "isArrayField": false
    }
  ]
}
```

### **What Works:**
1. ? FilingUIConfig table with JSON storage
2. ? CRUD APIs (GET/POST/PUT/DELETE)
3. ? UIConfigEditor with split-screen interface
4. ? FieldConfigPanel for field configuration
5. ? DynamicFormRenderer that reads JSON config
6. ? Basic field types (8 types supported)
7. ? Section-based grouping
8. ? Nested path support (e.g., "importer.name")
9. ? Array field handling via LineItemsManager

---

## ?? CRITICAL GAPS (Must Fix for Core Functionality)

### **GAP-001: Incomplete JSON Schema Structure**

**Current:** Only `fields[]` array exists  
**Required:** Complete nested JSON structure

**Missing from configData JSON:**

```json
{
  "version": "1.0.0",
  "metadata": {
    "title": "Import Declaration - NL H1 IE501",
    "description": "Configuration for Netherlands import declaration"
  },
  
  // ? MISSING: Layout configuration
  "layout": {
    "mode": "tabs",              // tabs | accordion | wizard | single-page
    "tabPosition": "top",         // top | left | right
    "responsive": { ... }
  },
  
  // ? MISSING: Tab definitions
  "tabs": [
    {
      "tabId": "declaration",
      "label": "Declaration",
      "icon": "FileText",
      "tabOrder": 10,
      "isVisible": true,
      "conditional": { ... },
      "sections": ["header", "parties"]
    }
  ],
  
  // ? MISSING: Section definitions  
  "sections": [
    {
      "sectionId": "header",
      "title": "Declaration Header",
      "sectionOrder": 10,
      "layout": "grid",         // grid | panels | cards | list
      "columns": 2,
      "isCollapsible": false,
      "defaultExpanded": true,
      "conditional": { ... },
      "panels": [ ... ]         // For panel-based layouts
    }
  ],
  
  // ? MISSING: Panel definitions
  "panels": [
    {
      "panelId": "importer",
      "sectionId": "parties",
      "title": "Importer Details",
      "panelOrder": 10,
      "isCollapsible": true,
      "defaultExpanded": true,
      "borderStyle": "solid",
      "fields": ["importer.name", "importer.address"]
    }
  ],
  
  // ? EXISTS: Field definitions (but incomplete)
  "fields": [ ... ],
  
  // ? MISSING: Validation rules
  "validation": {
    "crossFieldRules": [ ... ],
    "strategy": { ... }
  },
  
  // ? MISSING: Conditional logic
  "conditionalLogic": {
    "rules": [ ... ]
  },
  
  // ? MISSING: Workflow configuration
  "workflow": {
    "type": "wizard",           // wizard | approval | state-machine
    "steps": [ ... ]
  },
  
  // ? MISSING: Translations
  "translations": {
    "en": { ... },
    "nl": { ... }
  },
  
  // ? MISSING: Theme overrides
  "theme": {
    "colorPalette": { ... },
    "componentVariants": { ... }
  },
  
  // ? MISSING: RBAC rules
  "permissions": {
    "roles": { ... }
  }
}
```

**Action:** Extend FilingUIConfig.configData JSON schema to include all sections above.

---

### **GAP-002: Incomplete Field Configuration Schema**

**Current Field Schema:**
```json
{
  "fieldPath": "...",
  "fieldLabel": "...",
  "fieldType": "text",
  "section": "header",
  "displayOrder": 10,
  "gridColumn": 6,
  "isRequired": false,
  "isReadOnly": false,
  "isVisible": true,
  "placeholder": null,
  "helpText": null,
  "masterDataSource": null,
  "isMultiSelect": false,
  "isArrayField": false
}
```

**Missing Properties:**

```json
{
  // ? MISSING: Advanced layout
  "tabId": "declaration",           // Which tab this field belongs to
  "sectionId": "header",            // Explicit section reference
  "panelId": "importer",            // Which panel (if panel layout)
  "gridColumnOrder": 0,             // Order within grid column
  "displayMode": "input",           // input | grid | cards | readonly
  
  // ? MISSING: Default values
  "defaultValue": "${entryNumber}", // Static or dynamic default
  "computeDefault": {               // Computed default expression
    "type": "expression",
    "expression": "concat(...)"
  },
  
  // ? MISSING: Validation rules
  "validation": {
    "required": {
      "value": true,
      "message": "This field is required"
    },
    "minLength": { "value": 5, "message": "..." },
    "maxLength": { "value": 50, "message": "..." },
    "pattern": { "value": "^[A-Z0-9]+$", "message": "..." },
    "min": { ... },
    "max": { ... },
    "custom": {
      "validator": "validateLRN",
      "async": false
    },
    "asyncValidation": {
      "endpoint": "/api/validate-unique",
      "debounce": 500,
      "method": "POST"
    }
  },
  
  // ? MISSING: Conditional logic
  "conditional": {
    "showWhen": {
      "field": "country",
      "operator": "equals",
      "value": "NL"
    },
    "enableWhen": { ... },
    "requiredWhen": { ... }
  },
  
  // ? MISSING: Data source configuration
  "dataSource": {
    "type": "api",                  // api | static | masterData
    "endpoint": "/api/countries",
    "valueField": "code",
    "labelField": "name",
    "filters": { ... },
    "dependsOn": ["region"],        // Cascade dependencies
    "cacheKey": "countries",
    "cacheTTL": 300
  },
  
  // ? MISSING: API hooks
  "hooks": {
    "onLoad": {
      "endpoint": "/api/field-load",
      "method": "POST",
      "payload": { ... }
    },
    "onChange": { ... },
    "onBlur": { ... }
  },
  
  // ? MISSING: Translations
  "translations": {
    "label": {
      "en": "Declaration Number",
      "nl": "Aangifte Nummer"
    },
    "placeholder": { ... },
    "helpText": { ... }
  },
  
  // ? MISSING: Style overrides
  "styleOverrides": {
    "inputClass": "custom-input",
    "labelClass": "font-bold",
    "containerClass": "mb-4"
  },
  
  // ? MISSING: Grid configuration (for array fields)
  "gridConfig": {
    "enableAdd": true,
    "enableEdit": true,
    "enableDelete": true,
    "enableBulkEdit": true,
    "columns": [
      {
        "field": "itemNumber",
        "header": "Item #",
        "width": 80,
        "sortable": true,
        "filterable": false,
        "editable": false
      }
    ]
  },
  
  // ? MISSING: RBAC
  "permissions": {
    "read": ["all"],
    "write": ["admin", "operator"],
    "maskFor": ["viewer"]
  }
}
```

**Action:** Extend field configuration schema in JSON.

---

### **GAP-003: No Validation Framework**

**Current:** HTML5 validation only  
**Required:** Schema-driven validation engine

**Missing:**
- ValidationEngine.ts to parse and execute validation rules from JSON
- Real-time validation with debouncing
- Async validation (uniqueness, API checks)
- Cross-field validation (date ranges, sums)
- Custom error message display
- Validation strategy configuration (real-time vs submit-time)

**Components to Create:**
- `src/lib/validation/ValidationEngine.ts`
- `src/lib/validation/AsyncValidator.ts`
- `src/lib/validation/CrossFieldValidator.ts`
- `src/hooks/useValidation.ts`
- `src/components/form/ErrorSummary.tsx`
- `src/components/form/FieldError.tsx`

---

### **GAP-004: No Conditional Logic Engine**

**Current:** No show/hide or enable/disable logic  
**Required:** Expression-based conditional engine

**Missing:**
- ConditionalEngine.ts to evaluate JSON conditional expressions
- Support for operators: equals, notEquals, in, notIn, greaterThan, lessThan, contains, regex
- Field dependency tracking
- Cascade updates when dependent fields change

**Components to Create:**
- `src/lib/conditional/ConditionalEngine.ts`
- `src/lib/conditional/ExpressionParser.ts`
- `src/hooks/useConditional.ts`

---

### **GAP-005: No Layout System (Tabs/Accordion/Wizard)**

**Current:** Single-page section-based only  
**Required:** Multiple layout modes

**Missing:**
- Tab layout renderer (reads `layout.mode = "tabs"` and `tabs[]` from JSON)
- Accordion renderer
- Wizard stepper
- Panel renderer within sections
- Responsive layout switching

**Components to Create:**
- `src/components/form/layouts/TabbedFormLayout.tsx`
- `src/components/form/layouts/AccordionLayout.tsx`
- `src/components/form/layouts/WizardLayout.tsx`
- `src/components/form/layouts/PanelLayout.tsx`
- `src/components/form/layouts/LayoutRenderer.tsx` (main orchestrator)

---

## ?? HIGH PRIORITY GAPS (Core Features)

### **GAP-006: Limited Field Types**

**Current:** 8 types (text, textarea, number, date, datetime, checkbox, dropdown, lookup)  
**Required:** 20+ types

**Missing Types:**
- email, currency, time
- radio, multiselect
- richtext, file
- autocomplete, phone, url
- password, color, rating, slider, switch

**Action:** Create component for each type in `src/components/form/fields/`

---

### **GAP-007: No Multi-language Support**

**Current:** Hard-coded English labels  
**Required:** JSON-based translations with locale switching

**Missing:**
- Translation resolver that reads `translations` from JSON
- Locale context provider
- RTL layout support
- Fallback logic (en ? nl ? field key)

**Components to Create:**
- `src/lib/i18n/TranslationResolver.ts`
- `src/contexts/LocaleContext.tsx`
- `src/hooks/useTranslation.ts`

---

### **GAP-008: No RBAC Integration**

**Current:** No role-based field control  
**Required:** Permission-based visibility/editability from JSON

**Missing:**
- Permission checker that reads `permissions` from field JSON
- Role-based field masking
- Action-level permissions

**Components to Create:**
- `src/lib/rbac/PermissionChecker.ts`
- `src/hooks/usePermissions.ts`

---

### **GAP-009: No Theming System**

**Current:** Fixed Tailwind classes  
**Required:** JSON-driven theme overrides

**Missing:**
- Theme resolver that reads `theme` from JSON
- Dark mode support
- Component variant system
- Custom CSS class injection

**Components to Create:**
- `src/lib/theme/ThemeResolver.ts`
- `src/contexts/ThemeContext.tsx`

---

### **GAP-010: No API Integration Hooks**

**Current:** Hard-coded data fetching  
**Required:** JSON-configured field-level hooks

**Missing:**
- Hook executor that reads `hooks.onLoad`, `hooks.onChange` from JSON
- Data source resolver for `dataSource.endpoint`
- Payload mapping
- Cache management

**Components to Create:**
- `src/lib/hooks/FieldHookExecutor.ts`
- `src/lib/hooks/DataSourceResolver.ts`

---

### **GAP-011: No Workflow Orchestration**

**Current:** Single-page forms only  
**Required:** Wizard/approval workflows from JSON

**Missing:**
- Wizard stepper that reads `workflow.steps[]` from JSON
- Step validation
- Progress tracking
- Save-and-resume

**Components to Create:**
- `src/components/form/workflows/WizardWorkflow.tsx`
- `src/lib/workflow/WorkflowEngine.ts`

---

### **GAP-012: No Extensibility System**

**Current:** Fixed component mapping  
**Required:** Plugin architecture

**Missing:**
- Component registry for custom field types
- Custom validator registration
- Schema version migration scripts

**Components to Create:**
- `src/lib/registry/ComponentRegistry.ts`
- `src/lib/registry/ValidatorRegistry.ts`

---

## ?? MEDIUM PRIORITY GAPS (UX & Polish)

### **GAP-013: No Preview in UI Config Editor**

**Current:** Eye icon imported but no preview modal  
**Required:** Live preview of JSON configuration

**Action:** Create ConfigPreviewModal.tsx

---

### **GAP-014: No Drag-and-Drop Ordering**

**Current:** Manual number entry for displayOrder  
**Required:** Drag-and-drop reordering

**Action:** Create OrderableList.tsx with react-beautiful-dnd

---

### **GAP-015: No Bulk Configuration**

**Current:** One field at a time  
**Required:** Multi-select and bulk edit

**Action:** Add bulk edit UI to UIConfigEditor

---

### **GAP-016: No Version History**

**Current:** Version number only, no history  
**Required:** Version tracking with diff viewer

**Action:** Create ConfigVersionHistory.tsx

---

### **GAP-017: No Caching Strategy**

**Current:** Fetch on every load  
**Required:** Client-side caching with TTL

**Action:** Implement React Query or SWR for API caching

---

### **GAP-018: No Input Sanitization**

**Current:** Raw input accepted  
**Required:** XSS protection

**Action:** Sanitize user input in API and render

---

### **GAP-019: No Config Validation**

**Current:** No validation of JSON structure  
**Required:** JSON Schema validation on save

**Action:** Create ConfigValidator.ts with JSON Schema

---

### **GAP-020: No Lazy Loading**

**Current:** Load all tabs/sections upfront  
**Required:** Lazy load tabs on first view

**Action:** Implement React.lazy() for tab content

---

### **GAP-021: No Form State Optimization**

**Current:** Full re-render on any change  
**Required:** Memoization and batched updates

**Action:** Add React.memo, useMemo, useCallback

---

### **GAP-022: No Automated Tests**

**Current:** No tests  
**Required:** Unit + integration tests

**Action:** Write tests for ValidationEngine, ConditionalEngine, DynamicFormRenderer

---

### **GAP-023: No Documentation**

**Current:** Code comments only  
**Required:** Schema reference guide

**Action:** Create docs for JSON schema structure

---

### **GAP-024: No Dashboard Support**

**Current:** Form-only  
**Required:** Dashboard widgets from JSON

**Future:** Add `"type": "dashboard"` to configData

---

### **GAP-025: No Default Value Computation**

**Current:** Static defaults only  
**Required:** Expression-based computed defaults

**Action:** Create DefaultValueResolver.ts that evaluates `computeDefault.expression`

---

## ?? REVISED JSON Schema Structure (Target State)

### **Complete configData Schema:**

```typescript
interface FilingUIConfigData {
  version: string;
  metadata: {
    title: string;
    description?: string;
  };
  
  // Layout configuration
  layout: {
    mode: 'tabs' | 'accordion' | 'wizard' | 'single-page';
    tabPosition?: 'top' | 'left' | 'right';
    responsive?: ResponsiveConfig;
  };
  
  // Tab definitions (if layout.mode = 'tabs')
  tabs?: UITab[];
  
  // Section definitions
  sections: UISection[];
  
  // Panel definitions (for panel-based layouts)
  panels?: UIPanel[];
  
  // Field definitions
  fields: FieldConfig[];
  
  // Validation configuration
  validation?: {
    crossFieldRules: CrossFieldRule[];
    strategy: ValidationStrategy;
  };
  
  // Conditional logic rules
  conditionalLogic?: {
    rules: ConditionalRule[];
  };
  
  // Workflow configuration
  workflow?: {
    type: 'wizard' | 'approval' | 'state-machine';
    config: WorkflowConfig;
  };
  
  // Translations
  translations?: {
    [locale: string]: TranslationSet;
  };
  
  // Theme overrides
  theme?: {
    colorPalette?: ColorPalette;
    componentVariants?: ComponentVariants;
  };
  
  // RBAC configuration
  permissions?: {
    roles: RolePermissions;
  };
}
```

---

## ??? Implementation Roadmap (JSON-Based)

### **Phase 1: Foundation (Weeks 1-2)**
- ? Extend JSON schema structure in FilingUIConfig.configData
- ? Build ValidationEngine.ts (parse validation rules from JSON)
- ? Build ConditionalEngine.ts (evaluate conditional expressions)
- ? Update UIConfigEditor to edit extended JSON structure

### **Phase 2: Layout System (Weeks 3-4)**
- ? Create TabbedFormLayout.tsx (reads tabs[] from JSON)
- ? Create AccordionLayout.tsx
- ? Create PanelLayout.tsx
- ? Update DynamicFormRenderer to route to layout renderers

### **Phase 3: Field Enhancements (Weeks 5-6)**
- ? Add 12 new field type components
- ? Build DataSourceResolver.ts (handles dataSource config)
- ? Build FieldHookExecutor.ts (handles field hooks)
- ? Add multi-language support via TranslationResolver.ts

### **Phase 4: Workflows (Weeks 7-8)**
- ? Create WizardWorkflow.tsx (reads workflow.steps from JSON)
- ? Build WorkflowEngine.ts
- ? Add RBAC via PermissionChecker.ts

### **Phase 5: UX & Performance (Weeks 9-10)**
- ? Add drag-and-drop ordering in UIConfigEditor
- ? Add preview modal (ConfigPreviewModal.tsx)
- ? Implement lazy loading for tabs
- ? Add memoization for performance

### **Phase 6: Security & Testing (Weeks 11-12)**
- ? Add input sanitization
- ? Add JSON Schema validation on save (ConfigValidator.ts)
- ? Write comprehensive tests

### **Phase 7: Documentation (Week 13)**
- ? Write JSON schema reference guide
- ? Create developer guide
- ? Create user guide for UI Config Editor

---

## ?? Summary

**Total Identified Gaps:** 25  
**Critical (Blockers):** 5 (JSON schema extension, validation, conditional logic, layout system)  
**High Priority:** 7 (field types, i18n, RBAC, theming, hooks, workflow, extensibility)  
**Medium Priority:** 13 (UX polish, performance, security, testing, docs)

**Total Estimated Effort:** 13 weeks (3.25 months)

**Key Architecture Decision:** ? **Single-table JSON-based approach using FilingUIConfig.configData** - No new database tables required.

---

## ?? Immediate Next Steps

1. **Week 1:** Extend FilingUIConfig.configData JSON schema (add tabs, sections, panels, validation, conditionalLogic)
2. **Week 2:** Build ValidationEngine.ts and ConditionalEngine.ts
3. **Week 3:** Create TabbedFormLayout.tsx
4. **Week 4:** Update UIConfigEditor to manage full JSON structure
5. **Week 5:** Build FieldHookExecutor and DataSourceResolver

---

## ?? References

- Architecture: `DYNAMIC-UI-CONFIGURATION-ARCHITECTURE.md`
- Current Table: `prisma/schema.prisma` (FilingUIConfig model)
- Current Editor: `src/app/app/filing-config/UIConfigEditor.tsx`
- Current Renderer: `src/app/app/filing/[id]/DynamicFormRenderer.tsx`
- APIs: `src/app/api/filing-config/ui-configuration/route.ts`
