# Dynamic UI Configuration Architecture

## Executive Summary

This document provides a comprehensive architectural design for a dynamic, schema-driven UI configuration system. The goal is to enable new screens, forms, workflows, and dashboards to be created entirely through JSON schemas without requiring code changes.

## Table of Contents

1. [Form Generation](#1-form-generation)
2. [Dynamic Layouts](#2-dynamic-layouts)
3. [Reusable Components](#3-reusable-components)
4. [Conditional Logic](#4-conditional-logic)
5. [Validation & Error Handling](#5-validation--error-handling)
6. [Multi-language Support](#6-multi-language-support)
7. [Theme & Styling](#7-theme--styling)
8. [Role-based Access Control](#8-role-based-access-control)
9. [Workflow Orchestration](#9-workflow-orchestration)
10. [Integration Hooks](#10-integration-hooks)
11. [Extensibility](#11-extensibility)
12. [Dashboards & Analytics](#12-dashboards--analytics)
13. [Best Practices](#13-best-practices)
14. [React Component Mapping](#14-react-component-mapping)

---

## 1. Form Generation

### Overview
Form generation is the core capability that transforms JSON schemas into fully functional, interactive forms with validation, conditional logic, and real-time feedback.

### Field Type Support

The system should support these field types:

```json
{
  "fieldTypes": {
    "text": { "component": "Input", "validation": ["minLength", "maxLength", "pattern"] },
    "email": { "component": "Input", "type": "email", "validation": ["email"] },
    "number": { "component": "Input", "type": "number", "validation": ["min", "max"] },
    "currency": { "component": "CurrencyInput", "validation": ["min", "max", "precision"] },
    "date": { "component": "DatePicker", "validation": ["minDate", "maxDate"] },
    "datetime": { "component": "DateTimePicker", "validation": ["minDateTime", "maxDateTime"] },
    "time": { "component": "TimePicker", "validation": ["minTime", "maxTime"] },
    "checkbox": { "component": "Checkbox", "validation": [] },
    "radio": { "component": "RadioGroup", "validation": ["required"] },
    "dropdown": { "component": "Select", "validation": ["required"] },
    "multiselect": { "component": "MultiSelect", "validation": ["minItems", "maxItems"] },
    "textarea": { "component": "Textarea", "validation": ["minLength", "maxLength"] },
    "richtext": { "component": "RichTextEditor", "validation": ["minLength", "maxLength"] },
    "file": { "component": "FileUpload", "validation": ["maxSize", "acceptedTypes", "maxFiles"] },
    "lookup": { "component": "LookupField", "validation": ["required"] },
    "autocomplete": { "component": "Autocomplete", "validation": ["required", "minChars"] },
    "phone": { "component": "PhoneInput", "validation": ["phoneFormat"] },
    "url": { "component": "URLInput", "validation": ["urlFormat"] },
    "password": { "component": "PasswordInput", "validation": ["minLength", "strength"] },
    "color": { "component": "ColorPicker", "validation": [] },
    "rating": { "component": "RatingInput", "validation": ["min", "max"] },
    "slider": { "component": "Slider", "validation": ["min", "max", "step"] },
    "switch": { "component": "Switch", "validation": [] }
  }
}
```

### Example: Form Schema

```json
{
  "formId": "customs-filing-import",
  "version": "1.0.0",
  "metadata": {
    "title": "Import Declaration",
    "description": "Create a new import declaration filing"
  },
  "fields": [
    {
      "fieldPath": "goodsDeclaration.declarationNumber",
      "fieldType": "text",
      "label": "Declaration Number",
      "placeholder": "Enter declaration number",
      "required": true,
      "readOnly": false,
      "validation": {
        "minLength": 5,
        "maxLength": 50,
        "pattern": "^[A-Z0-9-]+$",
        "errorMessages": {
          "required": "Declaration number is required",
          "pattern": "Must contain only uppercase letters, numbers, and hyphens"
        }
      },
      "helpText": "Unique identifier for this declaration",
      "displayOrder": 10
    },
    {
      "fieldPath": "goodsDeclaration.localReferenceNumber",
      "fieldType": "text",
      "label": "Local Reference Number",
      "required": true,
      "defaultValue": "${entryNumber}",
      "displayOrder": 20,
      "conditional": {
        "showWhen": {
          "field": "goodsDeclaration.declarationCountry",
          "operator": "in",
          "value": ["NL", "BE", "DE"]
        }
      }
    },
    {
      "fieldPath": "goodsDeclaration.declarationCountry",
      "fieldType": "dropdown",
      "label": "Declaration Country",
      "required": true,
      "dataSource": {
        "type": "api",
        "endpoint": "/api/countries",
        "valueField": "code",
        "labelField": "name"
      },
      "displayOrder": 5
    },
    {
      "fieldPath": "goodsDeclaration.totalValue",
      "fieldType": "currency",
      "label": "Total Value",
      "required": true,
      "validation": {
        "min": 0,
        "max": 999999999.99,
        "precision": 2
      },
      "displayOrder": 30
    },
    {
      "fieldPath": "documents",
      "fieldType": "file",
      "label": "Supporting Documents",
      "required": false,
      "validation": {
        "maxFiles": 10,
        "maxSize": 10485760,
        "acceptedTypes": ["application/pdf", "image/jpeg", "image/png"]
      },
      "displayOrder": 40
    }
  ]
}
```

### Dynamic Default Values

Support for computed default values:

```json
{
  "fieldPath": "goodsDeclaration.localReferenceNumber",
  "defaultValue": "${entryNumber}",
  "computeDefault": {
    "type": "expression",
    "expression": "concat(${country}, '-', ${procedure}, '-', timestamp())"
  }
}
```


---

## 2. Dynamic Layouts

### Overview
Dynamic layouts allow forms and screens to be structured in various ways without code changes. The system supports multiple layout modes that can be mixed and nested.

### Layout Modes

```json
{
  "layoutModes": {
    "tabs": "Organize content into tabbed sections",
    "accordion": "Collapsible sections for space efficiency",
    "wizard": "Step-by-step guided workflow",
    "grid": "Tabular display for array data",
    "panel": "Grouped fields in bordered container",
    "split": "Side-by-side panes with resizable divider",
    "cards": "Card-based layout for visual hierarchy",
    "drawer": "Sliding panel for secondary content"
  }
}
```

### Example: Tab-based Layout

```json
{
  "formId": "customs-filing-complete",
  "layout": {
    "mode": "tabs",
    "tabPosition": "top",
    "tabs": [
      {
        "tabId": "declaration",
        "label": "Declaration",
        "icon": "FileText",
        "tabOrder": 10,
        "sections": [
          {
            "sectionId": "header",
            "title": "Declaration Header",
            "sectionOrder": 10,
            "layout": "grid",
            "columns": 2,
            "fields": ["declarationNumber", "declarationDate", "country", "procedure"]
          },
          {
            "sectionId": "parties",
            "title": "Parties",
            "sectionOrder": 20,
            "layout": "panels",
            "panels": [
              {
                "panelId": "importer",
                "title": "Importer Details",
                "panelOrder": 10,
                "collapsible": true,
                "defaultExpanded": true,
                "fields": ["importer.name", "importer.address", "importer.eori"]
              },
              {
                "panelId": "exporter",
                "title": "Exporter Details",
                "panelOrder": 20,
                "collapsible": true,
                "defaultExpanded": false,
                "fields": ["exporter.name", "exporter.address"]
              }
            ]
          }
        ]
      },
      {
        "tabId": "goods",
        "label": "Goods",
        "icon": "Package",
        "tabOrder": 20,
        "sections": [
          {
            "sectionId": "lineItems",
            "title": "Line Items",
            "sectionOrder": 10,
            "layout": "grid",
            "gridConfig": {
              "enableAdd": true,
              "enableEdit": true,
              "enableDelete": true,
              "enableBulkEdit": true,
              "columns": [
                { "field": "itemNumber", "header": "Item #", "width": 80, "sortable": true },
                { "field": "hsCode", "header": "HS Code", "width": 120, "filterable": true },
                { "field": "description", "header": "Description", "width": 300 },
                { "field": "quantity", "header": "Quantity", "width": 100, "editable": true },
                { "field": "value", "header": "Value", "width": 120, "editable": true }
              ]
            }
          }
        ]
      },
      {
        "tabId": "documents",
        "label": "Documents",
        "icon": "Paperclip",
        "tabOrder": 30,
        "sections": [
          {
            "sectionId": "uploads",
            "title": "Upload Documents",
            "sectionOrder": 10,
            "layout": "cards",
            "fields": ["documents"]
          }
        ]
      }
    ]
  }
}
```

### Example: Wizard Layout

```json
{
  "formId": "filing-wizard",
  "layout": {
    "mode": "wizard",
    "steps": [
      {
        "stepId": "select-type",
        "label": "Select Filing Type",
        "stepOrder": 1,
        "fields": ["country", "procedureCode", "messageName"],
        "validation": "all-required",
        "nextLabel": "Continue",
        "canSkip": false
      },
      {
        "stepId": "enter-details",
        "label": "Enter Details",
        "stepOrder": 2,
        "sections": [
          { "sectionId": "header", "fields": ["declarationNumber", "declarationDate"] },
          { "sectionId": "parties", "fields": ["importer.*", "exporter.*"] }
        ],
        "nextLabel": "Review",
        "previousLabel": "Back"
      },
      {
        "stepId": "review",
        "label": "Review & Submit",
        "stepOrder": 3,
        "mode": "readonly",
        "displaySummary": true,
        "submitLabel": "Submit to Customs",
        "previousLabel": "Edit"
      }
    ]
  }
}
```

### Responsive Layouts

```json
{
  "responsive": {
    "breakpoints": {
      "mobile": { "maxWidth": 640, "columns": 1 },
      "tablet": { "minWidth": 641, "maxWidth": 1024, "columns": 2 },
      "desktop": { "minWidth": 1025, "columns": 3 }
    },
    "adaptiveLayouts": {
      "tabs": { "mobile": "accordion", "tablet": "tabs", "desktop": "tabs" },
      "grid": { "mobile": "cards", "tablet": "grid", "desktop": "grid" }
    }
  }
}
```

---

## 3. Reusable Components

### Component Library Architecture

The system maps schema field types to reusable UI components from an existing library.

### Existing Components in System

From our codebase analysis, these components are already available:

#### Basic UI Components (src/components/ui/)
- Button
- Input
- Card
- Modal
- Badge
- Checkbox
- Select
- Textarea
- Label

#### Complex Components
- **DynamicFormRenderer** (src/app/app/filing/[id]/DynamicFormRenderer.tsx)
  - Already renders forms dynamically from UI config
  - Supports nested paths and array fields
  - Foundation for all form generation

- **LineItemsManager** (src/app/app/filing/[id]/LineItemsManager.tsx)
  - Handles array/grid display
  - Supports add, edit, delete operations
  - Already implements grid layout for line items

#### Table Components
- TablePagination
- ColumnChooser
- SortableHeader
- TableSkeleton

### Component Registry

```json
{
  "componentRegistry": {
    "Input": {
      "path": "@/components/ui/input",
      "props": ["type", "placeholder", "disabled", "readOnly", "maxLength"],
      "variants": ["default", "outline", "ghost"],
      "supports": ["text", "email", "number", "tel", "url", "password"]
    },
    "Select": {
      "path": "@/components/ui/select",
      "props": ["options", "placeholder", "disabled", "multiple"],
      "dataBinding": ["static", "api", "computed"],
      "supports": ["dropdown", "multiselect"]
    },
    "DatePicker": {
      "path": "@/components/DatePicker",
      "props": ["minDate", "maxDate", "format", "disabled"],
      "supports": ["date", "datetime"]
    },
    "FileUpload": {
      "path": "@/components/FileUpload",
      "props": ["accept", "maxSize", "maxFiles", "multiple"],
      "supports": ["file"]
    },
    "LineItemsManager": {
      "path": "@/app/app/filing/[id]/LineItemsManager",
      "props": ["columns", "enableAdd", "enableEdit", "enableDelete"],
      "supports": ["grid", "array"]
    },
    "DynamicFormRenderer": {
      "path": "@/app/app/filing/[id]/DynamicFormRenderer",
      "props": ["schema", "uiConfig", "data", "onChange"],
      "supports": ["form", "section", "wizard-step"]
    }
  }
}
```

### Component Mapping Strategy

```json
{
  "fieldPath": "goodsDeclaration.importDate",
  "fieldType": "date",
  "componentMapping": {
    "component": "DatePicker",
    "props": {
      "format": "MM/DD/YYYY",
      "minDate": "${today}",
      "maxDate": "${today+90days}",
      "showTimezone": false
    }
  }
}
```

### Custom Component Registration

Allow developers to register custom components:

```typescript
// Custom component registration
interface CustomComponentRegistration {
  componentId: string;
  componentPath: string;
  supportedFieldTypes: string[];
  propMapping: Record<string, any>;
  validator?: (config: FieldConfig) => ValidationResult;
}

// Example registration
registerCustomComponent({
  componentId: "HSCodeLookup",
  componentPath: "@/components/customs/HSCodeLookup",
  supportedFieldTypes: ["hscode"],
  propMapping: {
    country: "declarationCountry",
    year: "tariffYear"
  }
});
```


---

## 4. Conditional Logic

### Overview
Conditional logic enables dynamic form behavior based on user input, external data, or system state.

### Condition Types

```json
{
  "conditionTypes": {
    "fieldValue": "Show/hide based on another field's value",
    "expression": "Evaluate complex expressions",
    "api": "Call external API to determine visibility",
    "permission": "Check user permissions",
    "dataState": "Based on data availability or status",
    "computed": "Based on calculated values"
  }
}
```

### Show/Hide Logic

```json
{
  "fieldPath": "goodsDeclaration.preferentialOrigin",
  "label": "Preferential Origin",
  "conditional": {
    "visibility": {
      "showWhen": {
        "operator": "and",
        "conditions": [
          {
            "field": "goodsDeclaration.requestPreferentialTreatment",
            "operator": "equals",
            "value": true
          },
          {
            "field": "goodsDeclaration.declarationCountry",
            "operator": "in",
            "value": ["NL", "BE", "DE", "FR"]
          }
        ]
      }
    }
  }
}
```

### Enable/Disable Logic

```json
{
  "fieldPath": "goodsDeclaration.entryNumber",
  "label": "Entry Number",
  "conditional": {
    "enabled": {
      "disableWhen": {
        "field": "filing.status",
        "operator": "in",
        "value": ["transmitted", "accepted", "rejected"]
      }
    }
  }
}
```

### Complex Expressions

```json
{
  "fieldPath": "charges.totalDuty",
  "label": "Total Duty",
  "conditional": {
    "visibility": {
      "showWhen": {
        "expression": "(${goodsValue} > 1000) AND (${country} != 'US') OR (${hasExemption} == false)",
        "expressionType": "javascript"
      }
    }
  }
}
```

### Dependent Field Updates

```json
{
  "fieldPath": "goodsDeclaration.totalValue",
  "label": "Total Value",
  "onChangeActions": [
    {
      "action": "updateField",
      "targetField": "charges.dutyAmount",
      "value": "${goodsDeclaration.totalValue} * 0.05"
    },
    {
      "action": "validateField",
      "targetField": "goodsDeclaration.currency"
    },
    {
      "action": "callAPI",
      "endpoint": "/api/calculate-duties",
      "payload": {
        "value": "${goodsDeclaration.totalValue}",
        "country": "${goodsDeclaration.declarationCountry}"
      },
      "onSuccess": {
        "action": "updateFields",
        "mapping": {
          "charges.dutyAmount": "response.duty",
          "charges.vatAmount": "response.vat"
        }
      }
    }
  ]
}
```

### Branching Workflows

```json
{
  "formId": "filing-workflow",
  "workflow": {
    "branches": [
      {
        "branchId": "import-flow",
        "condition": {
          "field": "transactionType",
          "operator": "equals",
          "value": "import"
        },
        "steps": ["select-import-procedure", "enter-import-details", "add-goods"]
      },
      {
        "branchId": "export-flow",
        "condition": {
          "field": "transactionType",
          "operator": "equals",
          "value": "export"
        },
        "steps": ["select-export-procedure", "enter-export-details", "add-goods", "export-licenses"]
      }
    ]
  }
}
```

---

## 5. Validation & Error Handling

### Centralized Validation Rules

All validation rules are defined in the schema, ensuring consistency and reusability.

### Validation Rule Types

```json
{
  "validationRules": {
    "required": "Field must have a value",
    "minLength": "Minimum string length",
    "maxLength": "Maximum string length",
    "min": "Minimum numeric value",
    "max": "Maximum numeric value",
    "pattern": "Regex pattern matching",
    "email": "Valid email format",
    "url": "Valid URL format",
    "phone": "Valid phone number format",
    "custom": "Custom validation function",
    "async": "Asynchronous validation (e.g., check uniqueness)",
    "crossField": "Validate against other field values",
    "conditional": "Validation only applies under certain conditions"
  }
}
```

### Example: Comprehensive Field Validation

```json
{
  "fieldPath": "goodsDeclaration.localReferenceNumber",
  "fieldType": "text",
  "label": "Local Reference Number",
  "validation": {
    "required": {
      "value": true,
      "message": "Local Reference Number is mandatory for save or transmit"
    },
    "minLength": {
      "value": 5,
      "message": "Must be at least 5 characters"
    },
    "maxLength": {
      "value": 50,
      "message": "Cannot exceed 50 characters"
    },
    "pattern": {
      "value": "^[A-Z]{2}-[0-9]{4}-[A-Z0-9]{8}$",
      "message": "Format must be: CC-NNNN-XXXXXXXX"
    },
    "custom": {
      "validator": "validateLRN",
      "async": false
    },
    "conditionalRequired": {
      "condition": {
        "field": "filing.action",
        "operator": "in",
        "value": ["save", "transmit"]
      },
      "message": "Required when saving or transmitting"
    }
  }
}
```

### Async Validation (Uniqueness Check)

```json
{
  "fieldPath": "goodsDeclaration.declarationNumber",
  "validation": {
    "async": {
      "validator": "checkUniqueness",
      "endpoint": "/api/filings/check-declaration-number",
      "debounce": 500,
      "method": "POST",
      "payload": {
        "declarationNumber": "${value}",
        "country": "${goodsDeclaration.declarationCountry}"
      },
      "successCondition": "response.isUnique === true",
      "errorMessage": "Declaration number already exists"
    }
  }
}
```

### Cross-Field Validation

```json
{
  "formId": "customs-filing",
  "crossFieldValidation": [
    {
      "validationId": "date-range-check",
      "fields": ["goodsDeclaration.importDate", "goodsDeclaration.releaseDate"],
      "rule": "${goodsDeclaration.releaseDate} >= ${goodsDeclaration.importDate}",
      "message": "Release date cannot be earlier than import date",
      "level": "error"
    },
    {
      "validationId": "value-consistency",
      "fields": ["lineItems[].value", "goodsDeclaration.totalValue"],
      "rule": "sum(${lineItems[].value}) === ${goodsDeclaration.totalValue}",
      "message": "Line item values must sum to total value",
      "level": "error"
    }
  ]
}
```

### Real-Time vs Submit Validation

```json
{
  "validationStrategy": {
    "realTime": {
      "enabled": true,
      "triggerOn": ["blur", "change"],
      "debounce": 300,
      "validationTypes": ["required", "format", "minLength", "maxLength"]
    },
    "onSubmit": {
      "enabled": true,
      "validationTypes": ["all"],
      "stopOnFirstError": false,
      "scrollToFirstError": true
    }
  }
}
```

### Error Display Configuration

```json
{
  "errorHandling": {
    "displayMode": "inline",
    "showErrorSummary": true,
    "errorSummaryPosition": "top",
    "errorStyles": {
      "inline": {
        "position": "below-field",
        "icon": "AlertCircle",
        "color": "text-red-600",
        "background": "bg-red-50"
      },
      "toast": {
        "duration": 5000,
        "position": "top-right"
      }
    },
    "warningLevels": {
      "error": { "blockSubmit": true, "color": "red" },
      "warning": { "blockSubmit": false, "color": "yellow" },
      "info": { "blockSubmit": false, "color": "blue" }
    }
  }
}
```

---

## 6. Multi-language Support

### Overview
Enable instant localization by storing translation keys in the schema.

### Translation Key Structure

```json
{
  "fieldPath": "goodsDeclaration.declarationNumber",
  "fieldType": "text",
  "translations": {
    "label": {
      "en": "Declaration Number",
      "nl": "Aangifte Nummer",
      "de": "Anmeldenummer",
      "fr": "Numéro de déclaration"
    },
    "placeholder": {
      "en": "Enter declaration number",
      "nl": "Voer aangifte nummer in",
      "de": "Anmeldenummer eingeben",
      "fr": "Entrez le numéro de déclaration"
    },
    "helpText": {
      "en": "Unique identifier for this declaration",
      "nl": "Unieke identificatie voor deze aangifte",
      "de": "Eindeutige Kennung für diese Anmeldung",
      "fr": "Identifiant unique pour cette déclaration"
    },
    "validation": {
      "required": {
        "en": "Declaration number is required",
        "nl": "Aangifte nummer is verplicht",
        "de": "Anmeldenummer ist erforderlich",
        "fr": "Le numéro de déclaration est requis"
      }
    }
  }
}
```

### Translation Key References

For better maintainability, use translation key references:

```json
{
  "fieldPath": "goodsDeclaration.declarationNumber",
  "label": "i18n:filing.declarationNumber.label",
  "placeholder": "i18n:filing.declarationNumber.placeholder",
  "helpText": "i18n:filing.declarationNumber.help",
  "validation": {
    "required": {
      "message": "i18n:filing.declarationNumber.required"
    }
  }
}
```

External translation file (en.json):
```json
{
  "filing": {
    "declarationNumber": {
      "label": "Declaration Number",
      "placeholder": "Enter declaration number",
      "help": "Unique identifier for this declaration",
      "required": "Declaration number is required"
    }
  }
}
```

### RTL Support

```json
{
  "i18nConfig": {
    "defaultLocale": "en",
    "supportedLocales": ["en", "nl", "de", "fr", "ar", "he"],
    "rtlLocales": ["ar", "he"],
    "fallbackLocale": "en",
    "loadStrategy": "lazy",
    "rtlLayout": {
      "flipLayout": true,
      "flipIcons": true,
      "textAlign": "right"
    }
  }
}
```

### Dynamic Locale Switching

```json
{
  "formId": "customs-filing",
  "i18n": {
    "localeSelector": {
      "enabled": true,
      "position": "top-right",
      "displayMode": "dropdown",
      "showFlags": true
    },
    "persistLocalePreference": true,
    "reloadOnChange": false
  }
}
```


---

## 7. Theme & Styling

### Overview
Define visual appearance, CSS classes, color palettes, and component variants in the schema for brand consistency and customization.

### Theme Configuration

```json
{
  "themeConfig": {
    "themeName": "CustomsPortalTheme",
    "version": "1.0.0",
    "colorPalette": {
      "primary": "#2563eb",
      "secondary": "#64748b",
      "success": "#10b981",
      "warning": "#f59e0b",
      "error": "#ef4444",
      "info": "#3b82f6",
      "background": "#ffffff",
      "surface": "#f8fafc",
      "text": {
        "primary": "#0f172a",
        "secondary": "#475569",
        "disabled": "#cbd5e1"
      },
      "border": "#e2e8f0"
    },
    "typography": {
      "fontFamily": {
        "sans": "Inter, system-ui, sans-serif",
        "mono": "Fira Code, monospace"
      },
      "fontSize": {
        "xs": "0.75rem",
        "sm": "0.875rem",
        "base": "1rem",
        "lg": "1.125rem",
        "xl": "1.25rem",
        "2xl": "1.5rem"
      },
      "fontWeight": {
        "normal": 400,
        "medium": 500,
        "semibold": 600,
        "bold": 700
      }
    },
    "spacing": {
      "xs": "0.25rem",
      "sm": "0.5rem",
      "md": "1rem",
      "lg": "1.5rem",
      "xl": "2rem",
      "2xl": "3rem"
    },
    "borderRadius": {
      "none": "0",
      "sm": "0.125rem",
      "md": "0.375rem",
      "lg": "0.5rem",
      "full": "9999px"
    },
    "shadows": {
      "sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      "md": "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
      "lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      "xl": "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
    }
  }
}
```

### Dark Mode Support

```json
{
  "darkMode": {
    "enabled": true,
    "strategy": "class",
    "defaultMode": "light",
    "userPreference": true,
    "colorPalette": {
      "primary": "#3b82f6",
      "background": "#0f172a",
      "surface": "#1e293b",
      "text": {
        "primary": "#f1f5f9",
        "secondary": "#cbd5e1",
        "disabled": "#64748b"
      },
      "border": "#334155"
    }
  }
}
```

### Component-Level Styling

```json
{
  "fieldPath": "goodsDeclaration.declarationNumber",
  "fieldType": "text",
  "label": "Declaration Number",
  "styling": {
    "containerClass": "mb-4",
    "labelClass": "text-sm font-medium text-gray-700 dark:text-gray-200",
    "inputClass": "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500",
    "errorClass": "text-red-600 text-sm mt-1",
    "helpTextClass": "text-gray-500 text-sm mt-1",
    "customCSS": {
      "input:focus": {
        "borderColor": "#2563eb",
        "boxShadow": "0 0 0 3px rgba(37, 99, 235, 0.1)"
      }
    }
  }
}
```

### Field Variants

```json
{
  "fieldPath": "urgentNotice",
  "fieldType": "text",
  "label": "Urgent Notice",
  "variant": "warning",
  "variants": {
    "default": {
      "containerClass": "bg-white border-gray-300",
      "labelClass": "text-gray-700"
    },
    "warning": {
      "containerClass": "bg-yellow-50 border-yellow-300",
      "labelClass": "text-yellow-800",
      "icon": "AlertTriangle",
      "iconColor": "text-yellow-600"
    },
    "error": {
      "containerClass": "bg-red-50 border-red-300",
      "labelClass": "text-red-800",
      "icon": "AlertCircle",
      "iconColor": "text-red-600"
    },
    "success": {
      "containerClass": "bg-green-50 border-green-300",
      "labelClass": "text-green-800",
      "icon": "CheckCircle",
      "iconColor": "text-green-600"
    }
  }
}
```

### Layout-Level Styling

```json
{
  "layout": {
    "mode": "tabs",
    "styling": {
      "tabsContainer": "border-b border-gray-200",
      "tabButton": "px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:border-gray-300",
      "tabButtonActive": "border-b-2 border-blue-500 text-blue-600",
      "tabPanel": "py-4",
      "panel": "bg-white rounded-lg shadow-sm p-6 mb-4",
      "panelHeader": "text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200"
    }
  }
}
```

### Brand-Specific Themes

Support for multi-tenant or white-label scenarios:

```json
{
  "themes": {
    "default": {
      "name": "Default Theme",
      "colorPalette": { "primary": "#2563eb" }
    },
    "client-a": {
      "name": "Client A Brand",
      "colorPalette": { "primary": "#7c3aed" },
      "logo": "/assets/client-a-logo.svg",
      "favicon": "/assets/client-a-favicon.ico"
    },
    "client-b": {
      "name": "Client B Brand",
      "colorPalette": { "primary": "#059669" },
      "logo": "/assets/client-b-logo.svg"
    }
  },
  "themeSelection": {
    "strategy": "subdomain",
    "mapping": {
      "app.example.com": "default",
      "client-a.example.com": "client-a",
      "client-b.example.com": "client-b"
    }
  }
}
```

---

## 8. Role-based Access Control

### Overview
Control visibility and editability of fields, actions, and entire screens based on user roles and permissions.

### Permission Model

```json
{
  "permissions": {
    "roles": ["admin", "manager", "officer", "viewer"],
    "permissions": {
      "filing.create": ["admin", "manager", "officer"],
      "filing.edit": ["admin", "manager", "officer"],
      "filing.delete": ["admin", "manager"],
      "filing.transmit": ["admin", "officer"],
      "filing.view": ["admin", "manager", "officer", "viewer"],
      "filing.approve": ["admin", "manager"],
      "config.manage": ["admin"]
    }
  }
}
```

### Field-Level Access Control

```json
{
  "fieldPath": "goodsDeclaration.totalValue",
  "label": "Total Value",
  "accessControl": {
    "visibility": {
      "roles": ["admin", "manager", "officer", "viewer"],
      "permissions": ["filing.view"]
    },
    "editability": {
      "roles": ["admin", "manager", "officer"],
      "permissions": ["filing.edit"],
      "conditions": [
        {
          "field": "filing.status",
          "operator": "in",
          "value": ["draft", "pending"]
        }
      ]
    }
  }
}
```

### Action-Level Access Control

```json
{
  "actions": [
    {
      "actionId": "save-draft",
      "label": "Save Draft",
      "accessControl": {
        "roles": ["admin", "manager", "officer"],
        "permissions": ["filing.create", "filing.edit"]
      }
    },
    {
      "actionId": "transmit",
      "label": "Transmit to Customs",
      "accessControl": {
        "roles": ["admin", "officer"],
        "permissions": ["filing.transmit"],
        "additionalChecks": [
          {
            "type": "validation",
            "rule": "form.isValid === true"
          },
          {
            "type": "status",
            "rule": "filing.status === 'ready'"
          }
        ]
      }
    },
    {
      "actionId": "delete",
      "label": "Delete Filing",
      "accessControl": {
        "roles": ["admin", "manager"],
        "permissions": ["filing.delete"],
        "confirmationRequired": true,
        "confirmationMessage": "Are you sure you want to delete this filing?"
      }
    }
  ]
}
```

### Section-Level Access Control

```json
{
  "layout": {
    "mode": "tabs",
    "tabs": [
      {
        "tabId": "declaration",
        "label": "Declaration",
        "accessControl": {
          "roles": ["admin", "manager", "officer", "viewer"]
        }
      },
      {
        "tabId": "audit-log",
        "label": "Audit Log",
        "accessControl": {
          "roles": ["admin", "manager"],
          "permissions": ["audit.view"]
        }
      },
      {
        "tabId": "configuration",
        "label": "Configuration",
        "accessControl": {
          "roles": ["admin"],
          "permissions": ["config.manage"]
        }
      }
    ]
  }
}
```

### Dynamic Permission Evaluation

```json
{
  "fieldPath": "approverComments",
  "label": "Approver Comments",
  "accessControl": {
    "visibility": {
      "expression": "(${user.role} === 'admin' OR ${user.role} === 'manager') AND ${filing.requiresApproval} === true"
    },
    "editability": {
      "expression": "${user.id} === ${filing.assignedApproverId} AND ${filing.status} === 'pending-approval'"
    }
  }
}
```

### Data Masking

```json
{
  "fieldPath": "importer.taxId",
  "label": "Tax ID",
  "accessControl": {
    "visibility": {
      "roles": ["admin", "manager", "officer", "viewer"]
    },
    "dataMasking": {
      "enabled": true,
      "maskForRoles": ["viewer"],
      "maskPattern": "***-**-{last4}",
      "unmaskPermission": "sensitive-data.view"
    }
  }
}
```


---

## 9. Workflow Orchestration

### Overview
Support step-by-step wizards, approval flows, and dynamic navigation through schema-defined workflows.

### Wizard Configuration

```json
{
  "formId": "filing-wizard",
  "workflowType": "wizard",
  "workflow": {
    "wizardConfig": {
      "showProgressBar": true,
      "showStepNumbers": true,
      "allowStepSkip": false,
      "persistOnStepChange": true,
      "exitConfirmation": true
    },
    "steps": [
      {
        "stepId": "filing-type",
        "stepOrder": 1,
        "label": "Filing Type",
        "description": "Select the type of customs filing",
        "icon": "FileText",
        "fields": ["country", "procedureCode", "messageName", "transactionType"],
        "validation": {
          "validateOnNext": true,
          "blockOnError": true
        },
        "actions": {
          "next": {
            "label": "Continue",
            "loadNextStepData": true
          }
        }
      },
      {
        "stepId": "parties",
        "stepOrder": 2,
        "label": "Parties",
        "description": "Enter importer and exporter details",
        "icon": "Users",
        "sections": [
          { "sectionId": "importer", "title": "Importer", "fields": ["importer.*"] },
          { "sectionId": "exporter", "title": "Exporter", "fields": ["exporter.*"] }
        ],
        "validation": {
          "validateOnNext": true
        },
        "actions": {
          "previous": { "label": "Back" },
          "next": { "label": "Continue" }
        }
      },
      {
        "stepId": "goods",
        "stepOrder": 3,
        "label": "Goods",
        "description": "Add line items and commodity details",
        "icon": "Package",
        "layout": {
          "mode": "grid",
          "gridConfig": { "enableAdd": true, "enableEdit": true, "enableDelete": true }
        },
        "validation": {
          "validateOnNext": true,
          "customValidation": [
            {
              "rule": "lineItems.length > 0",
              "message": "At least one line item is required"
            }
          ]
        },
        "actions": {
          "previous": { "label": "Back" },
          "next": { "label": "Continue to Documents" }
        }
      },
      {
        "stepId": "documents",
        "stepOrder": 4,
        "label": "Documents",
        "description": "Upload supporting documents",
        "icon": "Paperclip",
        "fields": ["documents"],
        "optional": true,
        "actions": {
          "previous": { "label": "Back" },
          "next": { "label": "Review" }
        }
      },
      {
        "stepId": "review",
        "stepOrder": 5,
        "label": "Review",
        "description": "Review and submit your filing",
        "icon": "Eye",
        "mode": "readonly",
        "displaySummary": true,
        "summaryConfig": {
          "groupBy": "section",
          "showEmptyFields": false,
          "highlightErrors": true
        },
        "actions": {
          "previous": { "label": "Edit" },
          "submit": {
            "label": "Transmit to Customs",
            "confirmationRequired": true,
            "confirmationMessage": "Are you sure you want to transmit this filing?",
            "icon": "Send",
            "variant": "primary"
          },
          "saveDraft": {
            "label": "Save as Draft",
            "variant": "secondary"
          }
        }
      }
    ]
  }
}
```

### Approval Workflow

```json
{
  "formId": "filing-approval",
  "workflowType": "approval",
  "workflow": {
    "approvalConfig": {
      "requiresApproval": {
        "condition": {
          "field": "goodsDeclaration.totalValue",
          "operator": "greaterThan",
          "value": 10000
        }
      },
      "approvalLevels": [
        {
          "levelId": "manager-review",
          "levelOrder": 1,
          "label": "Manager Review",
          "assignmentStrategy": "role",
          "assignToRoles": ["manager"],
          "actions": ["approve", "reject", "requestChanges"],
          "notifyOnAssignment": true,
          "escalationTimeout": 48,
          "escalationTimeoutUnit": "hours",
          "escalateTo": "director"
        },
        {
          "levelId": "director-approval",
          "levelOrder": 2,
          "label": "Director Approval",
          "assignmentStrategy": "specific",
          "assignToUsers": ["director@example.com"],
          "actions": ["approve", "reject"],
          "requiredCondition": {
            "field": "goodsDeclaration.totalValue",
            "operator": "greaterThan",
            "value": 50000
          }
        }
      ]
    },
    "states": [
      {
        "stateId": "draft",
        "label": "Draft",
        "allowedActions": ["submit", "save", "delete"],
        "nextStates": ["pending-approval", "submitted"]
      },
      {
        "stateId": "pending-approval",
        "label": "Pending Approval",
        "allowedActions": ["approve", "reject", "requestChanges"],
        "nextStates": ["approved", "rejected", "changes-requested"]
      },
      {
        "stateId": "changes-requested",
        "label": "Changes Requested",
        "allowedActions": ["resubmit", "cancel"],
        "nextStates": ["pending-approval", "cancelled"]
      },
      {
        "stateId": "approved",
        "label": "Approved",
        "allowedActions": ["transmit"],
        "nextStates": ["transmitted"]
      },
      {
        "stateId": "transmitted",
        "label": "Transmitted",
        "allowedActions": ["view"],
        "terminal": true
      }
    ]
  }
}
```

### Dynamic Navigation

```json
{
  "navigation": {
    "mode": "dynamic",
    "structure": [
      {
        "id": "home",
        "label": "Home",
        "icon": "Home",
        "path": "/app",
        "accessControl": { "roles": ["admin", "manager", "officer", "viewer"] }
      },
      {
        "id": "filings",
        "label": "Filings",
        "icon": "FileText",
        "path": "/app/filings",
        "accessControl": { "roles": ["admin", "manager", "officer", "viewer"] },
        "children": [
          {
            "id": "new-filing",
            "label": "New Filing",
            "path": "/app/filing/new",
            "accessControl": { "roles": ["admin", "officer"], "permissions": ["filing.create"] }
          },
          {
            "id": "my-filings",
            "label": "My Filings",
            "path": "/app/filings/my",
            "badge": "${unreadFilingsCount}"
          },
          {
            "id": "all-filings",
            "label": "All Filings",
            "path": "/app/filings/all",
            "accessControl": { "roles": ["admin", "manager"] }
          }
        ]
      },
      {
        "id": "config",
        "label": "Configuration",
        "icon": "Settings",
        "path": "/app/config",
        "accessControl": { "roles": ["admin"], "permissions": ["config.manage"] },
        "children": [
          {
            "id": "filing-config",
            "label": "Filing Configuration",
            "path": "/app/filing-config"
          },
          {
            "id": "ui-config",
            "label": "UI Configuration",
            "path": "/app/filing-config/ui"
          }
        ]
      }
    ],
    "breadcrumbs": {
      "enabled": true,
      "showHome": true,
      "separator": "/"
    }
  }
}
```

### Event-Driven Workflows

```json
{
  "workflowEvents": {
    "onFormLoad": [
      {
        "action": "callAPI",
        "endpoint": "/api/filing/defaults",
        "method": "GET",
        "onSuccess": {
          "action": "populateFields",
          "mapping": {
            "country": "response.defaultCountry",
            "currency": "response.defaultCurrency"
          }
        }
      }
    ],
    "onFieldChange": [
      {
        "field": "country",
        "actions": [
          {
            "action": "clearField",
            "targetFields": ["procedureCode", "messageName"]
          },
          {
            "action": "reloadOptions",
            "targetFields": ["procedureCode"]
          }
        ]
      }
    ],
    "beforeSubmit": [
      {
        "action": "validateAll",
        "blockOnError": true
      },
      {
        "action": "callAPI",
        "endpoint": "/api/filing/pre-submit-check",
        "method": "POST",
        "payload": "${formData}",
        "onError": {
          "action": "showError",
          "message": "Pre-submit validation failed"
        }
      }
    ],
    "afterSubmit": [
      {
        "action": "showNotification",
        "message": "Filing submitted successfully",
        "type": "success"
      },
      {
        "action": "navigate",
        "path": "/app/filings/${filingId}"
      }
    ]
  }
}
```

---

## 10. Integration Hooks

### Overview
Allow schemas to specify API endpoints, payload mappings, and event triggers for seamless backend communication.

### API Integration Configuration

```json
{
  "apiIntegration": {
    "baseURL": "${API_BASE_URL}",
    "headers": {
      "Authorization": "Bearer ${accessToken}",
      "Content-Type": "application/json",
      "X-Tenant-ID": "${tenantId}"
    },
    "timeout": 30000,
    "retryConfig": {
      "maxRetries": 3,
      "retryDelay": 1000,
      "retryOn": [408, 429, 500, 502, 503, 504]
    }
  }
}
```

### Field-Level API Hooks

```json
{
  "fieldPath": "importer.eori",
  "fieldType": "lookup",
  "label": "EORI Number",
  "apiHooks": {
    "onBlur": {
      "endpoint": "/api/parties/validate-eori",
      "method": "POST",
      "payload": {
        "eori": "${value}",
        "country": "${goodsDeclaration.declarationCountry}"
      },
      "onSuccess": {
        "action": "populateFields",
        "mapping": {
          "importer.name": "response.partyName",
          "importer.address": "response.address",
          "importer.vatNumber": "response.vatNumber"
        }
      },
      "onError": {
        "action": "showFieldError",
        "message": "Invalid EORI number or not found"
      }
    }
  }
}
```

### Dropdown Data Sources

```json
{
  "fieldPath": "goodsDeclaration.procedureCode",
  "fieldType": "dropdown",
  "label": "Procedure Code",
  "dataSource": {
    "type": "api",
    "endpoint": "/api/filing-config/procedures",
    "method": "GET",
    "queryParams": {
      "country": "${goodsDeclaration.declarationCountry}",
      "transactionType": "${transactionType}"
    },
    "transform": {
      "valueField": "procedureCode",
      "labelField": "procedureName",
      "groupBy": "category"
    },
    "cache": {
      "enabled": true,
      "ttl": 300000,
      "cacheKey": "procedures-${country}"
    },
    "dependsOn": ["goodsDeclaration.declarationCountry"]
  }
}
```

### Form Submit API Configuration

```json
{
  "formId": "customs-filing",
  "submitConfig": {
    "endpoint": "/api/filing",
    "method": "POST",
    "payloadMapping": {
      "entryNumber": "${entryNumber}",
      "country": "${goodsDeclaration.declarationCountry}",
      "procedureCode": "${goodsDeclaration.procedureCode}",
      "messageName": "${messageName}",
      "declarationData": "${formData}",
      "metadata": {
        "submittedBy": "${user.id}",
        "submittedAt": "${timestamp}"
      }
    },
    "onSuccess": {
      "showNotification": {
        "message": "Filing created successfully",
        "type": "success"
      },
      "redirect": "/app/filing/${response.filingId}"
    },
    "onError": {
      "showNotification": {
        "message": "Failed to create filing: ${error.message}",
        "type": "error"
      },
      "highlightErrors": true
    }
  }
}
```

### Webhooks and Event Triggers

```json
{
  "webhooks": {
    "onFilingCreated": {
      "url": "${WEBHOOK_URL}/filing-created",
      "method": "POST",
      "payload": {
        "event": "filing.created",
        "filingId": "${filingId}",
        "country": "${country}",
        "timestamp": "${timestamp}"
      },
      "headers": {
        "X-Webhook-Secret": "${WEBHOOK_SECRET}"
      }
    },
    "onFilingTransmitted": {
      "url": "${WEBHOOK_URL}/filing-transmitted",
      "method": "POST",
      "payload": {
        "event": "filing.transmitted",
        "filingId": "${filingId}",
        "transmissionId": "${transmissionId}"
      }
    }
  }
}
```

### Real-time Data Sync

```json
{
  "realTimeSync": {
    "enabled": true,
    "protocol": "websocket",
    "endpoint": "wss://api.example.com/sync",
    "topics": [
      {
        "topic": "filing.${filingId}.updates",
        "onMessage": {
          "action": "updateFields",
          "mapping": {
            "filing.status": "message.status",
            "filing.lastUpdated": "message.timestamp"
          }
        }
      },
      {
        "topic": "filing.${filingId}.comments",
        "onMessage": {
          "action": "appendToList",
          "targetField": "comments",
          "data": "message.comment"
        }
      }
    ]
  }
}
```


---

## 11. Extensibility

### Overview
Design the system to allow developers to plug in new components, validators, and behaviors without breaking existing functionality.

### Plugin Architecture

```json
{
  "pluginSystem": {
    "enabled": true,
    "pluginDirectory": "/plugins",
    "autoLoad": true,
    "plugins": [
      {
        "pluginId": "customs-validators",
        "name": "Customs Validation Plugin",
        "version": "1.0.0",
        "path": "/plugins/customs-validators",
        "enabled": true,
        "provides": {
          "validators": ["hsCodeValidator", "eoriValidator", "declarationNumberValidator"],
          "components": [],
          "hooks": ["beforeSubmit"]
        }
      },
      {
        "pluginId": "advanced-charts",
        "name": "Advanced Charts Plugin",
        "version": "2.1.0",
        "path": "/plugins/advanced-charts",
        "enabled": true,
        "provides": {
          "components": ["AdvancedLineChart", "HeatMap", "Gantt"],
          "fieldTypes": ["chart"]
        }
      }
    ]
  }
}
```

### Custom Validator Registration

```typescript
// Custom validator interface
interface CustomValidator {
  validatorId: string;
  validate: (value: any, context: ValidationContext) => ValidationResult;
  async?: boolean;
}

// Example: Register custom HS Code validator
registerValidator({
  validatorId: "hsCodeValidator",
  async: false,
  validate: (value, context) => {
    const hsCodePattern = /^\\d{4}\\.\\d{2}(\\.\\d{2})?$/;
    if (!hsCodePattern.test(value)) {
      return {
        valid: false,
        message: "HS Code must be in format: NNNN.NN or NNNN.NN.NN"
      };
    }
    
    // Additional logic: validate against master data
    const isValidHSCode = checkHSCodeDatabase(value, context.country);
    return {
      valid: isValidHSCode,
      message: isValidHSCode ? "" : "HS Code not found in tariff database"
    };
  }
});
```

### Custom Component Registration

```typescript
// Custom component interface
interface CustomComponent {
  componentId: string;
  componentPath: string;
  supportedFieldTypes: string[];
  propMapping: Record<string, any>;
  validator?: (config: FieldConfig) => ValidationResult;
}

// Example: Register EORI lookup component
registerComponent({
  componentId: "EORILookup",
  componentPath: "@/components/customs/EORILookup",
  supportedFieldTypes: ["eori"],
  propMapping: {
    country: "declarationCountry",
    onSelect: "handleEORISelect"
  },
  validator: (config) => {
    if (!config.country) {
      return { valid: false, message: "EORI lookup requires country field" };
    }
    return { valid: true };
  }
});
```

### Schema Versioning

```json
{
  "schemaVersion": "2.1.0",
  "compatibilityMode": "backward",
  "migrations": [
    {
      "fromVersion": "1.0.0",
      "toVersion": "2.0.0",
      "changes": [
        {
          "type": "fieldRename",
          "oldPath": "declaration.refNumber",
          "newPath": "declaration.localReferenceNumber"
        },
        {
          "type": "fieldAdd",
          "path": "declaration.registrationNumber",
          "defaultValue": null
        }
      ],
      "migrationScript": "migrations/v1-to-v2.js"
    }
  ],
  "deprecations": [
    {
      "fieldPath": "declaration.oldField",
      "deprecatedIn": "2.0.0",
      "removedIn": "3.0.0",
      "replacement": "declaration.newField",
      "message": "This field will be removed in version 3.0.0"
    }
  ]
}
```

### Hook System

```typescript
// Hook system for lifecycle events
interface Hook {
  hookId: string;
  hookType: "beforeLoad" | "afterLoad" | "beforeSubmit" | "afterSubmit" | "onChange" | "onValidate";
  priority: number;
  handler: (context: HookContext) => Promise<HookResult>;
}

// Example: Register pre-submit validation hook
registerHook({
  hookId: "customs-pre-submit-check",
  hookType: "beforeSubmit",
  priority: 10,
  handler: async (context) => {
    const formData = context.formData;
    
    // Custom business logic
    if (formData.totalValue > 100000 && !formData.approverSignature) {
      return {
        proceed: false,
        errors: [{
          field: "approverSignature",
          message: "Approver signature required for high-value filings"
        }]
      };
    }
    
    return { proceed: true };
  }
});
```

### Extension Points

```json
{
  "extensionPoints": {
    "fieldRenderers": {
      "description": "Custom renderers for field types",
      "interface": "IFieldRenderer",
      "examples": ["HSCodeRenderer", "CountryFlagRenderer"]
    },
    "validators": {
      "description": "Custom validation functions",
      "interface": "IValidator",
      "examples": ["IBANValidator", "VATValidator"]
    },
    "dataTransformers": {
      "description": "Transform data before/after API calls",
      "interface": "IDataTransformer",
      "examples": ["DateFormatTransformer", "CurrencyConverter"]
    },
    "actionHandlers": {
      "description": "Custom action implementations",
      "interface": "IActionHandler",
      "examples": ["CustomSubmitHandler", "PDFExportHandler"]
    }
  }
}
```

### Future-Proofing Strategies

1. **Semantic Versioning**: Major.Minor.Patch format
2. **Deprecation Warnings**: Give developers time to migrate
3. **Backward Compatibility**: Support old schemas for at least 2 major versions
4. **Feature Flags**: Enable/disable features without code deployment
5. **Schema Registry**: Central repository for schema definitions
6. **Documentation**: Auto-generate docs from schema definitions

```json
{
  "featureFlags": {
    "enableAdvancedValidation": true,
    "enableRealTimeSync": false,
    "enableAIAssist": false,
    "enableBulkOperations": true
  },
  "schemaRegistry": {
    "url": "https://schema-registry.example.com",
    "authentication": "Bearer ${SCHEMA_REGISTRY_TOKEN}",
    "publishOnSave": true
  }
}
```

---

## 12. Dashboards & Analytics

### Overview
Extend beyond forms to support data visualization, KPI widgets, and interactive dashboards through schema configuration.

### Dashboard Configuration

```json
{
  "dashboardId": "filing-analytics",
  "title": "Filing Analytics Dashboard",
  "layout": {
    "mode": "grid",
    "columns": 12,
    "rowHeight": 80,
    "widgets": [
      {
        "widgetId": "total-filings",
        "type": "kpi",
        "title": "Total Filings",
        "position": { "x": 0, "y": 0, "w": 3, "h": 2 },
        "dataSource": {
          "endpoint": "/api/analytics/total-filings",
          "refreshInterval": 60000
        },
        "display": {
          "value": "${response.total}",
          "format": "number",
          "trend": {
            "enabled": true,
            "value": "${response.percentChange}",
            "direction": "${response.trendDirection}"
          },
          "icon": "FileText",
          "color": "primary"
        }
      },
      {
        "widgetId": "filings-by-status",
        "type": "chart",
        "chartType": "pie",
        "title": "Filings by Status",
        "position": { "x": 3, "y": 0, "w": 4, "h": 4 },
        "dataSource": {
          "endpoint": "/api/analytics/filings-by-status",
          "refreshInterval": 120000
        },
        "display": {
          "series": [
            {
              "dataKey": "count",
              "nameKey": "status",
              "colors": {
                "draft": "#94a3b8",
                "transmitted": "#3b82f6",
                "accepted": "#10b981",
                "rejected": "#ef4444"
              }
            }
          ],
          "legend": { "position": "right" },
          "tooltip": { "enabled": true }
        }
      },
      {
        "widgetId": "filings-timeline",
        "type": "chart",
        "chartType": "line",
        "title": "Filings Over Time",
        "position": { "x": 0, "y": 4, "w": 7, "h": 4 },
        "dataSource": {
          "endpoint": "/api/analytics/filings-timeline",
          "queryParams": {
            "startDate": "${dateRange.start}",
            "endDate": "${dateRange.end}"
          },
          "refreshInterval": 300000
        },
        "display": {
          "xAxis": { "dataKey": "date", "format": "MM/DD" },
          "yAxis": { "label": "Count" },
          "series": [
            { "dataKey": "transmitted", "name": "Transmitted", "color": "#3b82f6" },
            { "dataKey": "accepted", "name": "Accepted", "color": "#10b981" }
          ],
          "legend": { "position": "top" },
          "grid": { "strokeDasharray": "3 3" }
        }
      },
      {
        "widgetId": "recent-filings",
        "type": "table",
        "title": "Recent Filings",
        "position": { "x": 7, "y": 0, "w": 5, "h": 8 },
        "dataSource": {
          "endpoint": "/api/filings/recent",
          "queryParams": { "limit": 10 },
          "refreshInterval": 60000
        },
        "display": {
          "columns": [
            { "field": "entryNumber", "header": "Entry Number", "width": 150 },
            { "field": "country", "header": "Country", "width": 80 },
            { "field": "status", "header": "Status", "width": 100, "cellRenderer": "StatusBadge" },
            { "field": "createdAt", "header": "Created", "width": 120, "format": "datetime" }
          ],
          "pagination": false,
          "sortable": false
        }
      }
    ]
  },
  "filters": [
    {
      "filterId": "date-range",
      "type": "daterange",
      "label": "Date Range",
      "defaultValue": "last7days",
      "applyTo": ["filings-timeline"]
    },
    {
      "filterId": "country-filter",
      "type": "multiselect",
      "label": "Country",
      "dataSource": { "endpoint": "/api/countries" },
      "applyTo": ["filings-by-status", "recent-filings"]
    }
  ]
}
```

### Chart Types Support

```json
{
  "chartTypes": {
    "line": "Time series and trend analysis",
    "bar": "Comparison across categories",
    "pie": "Proportional distribution",
    "donut": "Proportional with central metric",
    "area": "Stacked time series",
    "scatter": "Correlation analysis",
    "heatmap": "Multi-dimensional intensity",
    "gauge": "Progress or capacity metrics",
    "funnel": "Conversion or process stages",
    "treemap": "Hierarchical proportions",
    "radar": "Multi-axis comparison"
  }
}
```

### KPI Widget Configuration

```json
{
  "widgetType": "kpi",
  "title": "Average Processing Time",
  "dataSource": {
    "endpoint": "/api/analytics/avg-processing-time",
    "refreshInterval": 300000
  },
  "display": {
    "value": "${response.avgHours}",
    "format": "duration",
    "unit": "hours",
    "target": {
      "value": 24,
      "showTarget": true,
      "indicator": "below-is-good"
    },
    "trend": {
      "enabled": true,
      "value": "${response.weekOverWeekChange}",
      "format": "percentage",
      "direction": "auto"
    },
    "sparkline": {
      "enabled": true,
      "data": "${response.last30Days}",
      "color": "#3b82f6"
    }
  }
}
```

### Interactive Dashboard Actions

```json
{
  "widgetId": "filings-map",
  "type": "map",
  "title": "Filings by Location",
  "interactions": {
    "onClick": {
      "action": "navigate",
      "path": "/app/filings?country=${clickedCountry}"
    },
    "onHover": {
      "action": "showTooltip",
      "content": {
        "country": "${country}",
        "count": "${count}",
        "totalValue": "${totalValue}"
      }
    }
  }
}
```


---

## 13. Best Practices

### Schema Design Principles

1. **Keep It Simple**: Start with minimal schema, add complexity only when needed
2. **Consistent Naming**: Use camelCase for field paths, kebab-case for IDs
3. **Clear Hierarchies**: Organize fields logically (header → sections → fields)
4. **Reusable Patterns**: Extract common configurations into reusable templates
5. **Documentation**: Add descriptions and help text for all fields
6. **Validation First**: Define validation rules upfront to prevent bad data
7. **Progressive Disclosure**: Show advanced options only when needed

### Schema Organization

```
schemas/
├── forms/
│   ├── customs-filing/
│   │   ├── import-declaration.schema.json
│   │   ├── export-declaration.schema.json
│   │   └── transit-declaration.schema.json
│   └── shared/
│       ├── party-details.schema.json
│       ├── goods-item.schema.json
│       └── address.schema.json
├── layouts/
│   ├── wizard-layout.schema.json
│   ├── tab-layout.schema.json
│   └── dashboard-layout.schema.json
├── themes/
│   ├── default-theme.schema.json
│   └── dark-theme.schema.json
└── widgets/
    ├── kpi-widget.schema.json
    ├── chart-widget.schema.json
    └── table-widget.schema.json
```

### Schema Versioning Strategy

```json
{
  "schemaId": "customs-filing-import",
  "version": "2.1.0",
  "versionHistory": [
    {
      "version": "1.0.0",
      "date": "2024-01-01",
      "changes": "Initial release"
    },
    {
      "version": "2.0.0",
      "date": "2024-06-01",
      "changes": "Added LocalReferenceNumber field, deprecated RefNumber",
      "breaking": true
    },
    {
      "version": "2.1.0",
      "date": "2024-12-01",
      "changes": "Added RegistrationNumber field",
      "breaking": false
    }
  ],
  "supportedUntil": "2026-12-01"
}
```

### Performance Optimization

```json
{
  "performanceConfig": {
    "lazyLoading": {
      "enabled": true,
      "threshold": 50,
      "mode": "progressive"
    },
    "caching": {
      "enabled": true,
      "strategy": "memory-first",
      "ttl": 300000,
      "maxSize": 100
    },
    "debouncing": {
      "validation": 300,
      "apiCalls": 500,
      "search": 300
    },
    "virtualization": {
      "enabled": true,
      "itemHeight": 48,
      "overscan": 5
    }
  }
}
```

### Security Best Practices

1. **Sanitize Input**: Always validate and sanitize user input on both client and server
2. **Encrypt Sensitive Data**: Use encryption for sensitive fields (tax IDs, passwords)
3. **Access Control**: Implement RBAC at field, section, and form level
4. **Audit Logging**: Log all schema changes and sensitive operations
5. **Token Security**: Use short-lived tokens, rotate regularly
6. **XSS Prevention**: Escape all user-generated content in UI
7. **CSRF Protection**: Implement CSRF tokens for state-changing operations

```json
{
  "security": {
    "csrfProtection": true,
    "xssProtection": true,
    "sanitizeInput": true,
    "auditLog": {
      "enabled": true,
      "logSchemaChanges": true,
      "logDataAccess": true,
      "logActions": ["create", "update", "delete", "transmit"]
    },
    "encryption": {
      "sensitiveFields": ["taxId", "bankAccount", "password"],
      "algorithm": "AES-256-GCM"
    }
  }
}
```

### Error Handling Best Practices

1. **User-Friendly Messages**: Show clear, actionable error messages
2. **Error Codes**: Include error codes for debugging and support
3. **Graceful Degradation**: Fall back to defaults when config fails
4. **Retry Logic**: Implement exponential backoff for transient failures
5. **Error Boundaries**: Catch and handle component errors gracefully
6. **Logging**: Log errors with context for troubleshooting

```json
{
  "errorHandling": {
    "displayMode": "inline",
    "showErrorCodes": true,
    "retryConfig": {
      "enabled": true,
      "maxRetries": 3,
      "backoffMultiplier": 2,
      "initialDelay": 1000
    },
    "fallbackConfig": {
      "useDefaults": true,
      "showFallbackMessage": true
    },
    "logging": {
      "enabled": true,
      "logLevel": "error",
      "includeStackTrace": true,
      "includeContext": true
    }
  }
}
```

### Testing Strategy

1. **Schema Validation**: Validate schemas against JSON Schema spec
2. **Component Testing**: Test each component in isolation
3. **Integration Testing**: Test form submission end-to-end
4. **Accessibility Testing**: Ensure WCAG 2.1 AA compliance
5. **Performance Testing**: Test with large datasets
6. **Cross-browser Testing**: Test on major browsers
7. **User Acceptance Testing**: Validate with real users

---

## 14. React Component Mapping

### Component Architecture

```
src/
├── components/
│   ├── ui/                           # Basic UI components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   └── ...
│   ├── form/                         # Form-specific components
│   │   ├── DynamicFormRenderer.tsx   # Main form renderer
│   │   ├── FieldRenderer.tsx         # Renders individual fields
│   │   ├── ValidationMessage.tsx     # Displays validation errors
│   │   └── FormActions.tsx           # Form action buttons
│   ├── layout/                       # Layout components
│   │   ├── TabLayout.tsx             # Tab-based layout
│   │   ├── WizardLayout.tsx          # Wizard step layout
│   │   ├── PanelLayout.tsx           # Panel groupings
│   │   └── GridLayout.tsx            # Grid/table layout
│   └── dashboard/                    # Dashboard components
│       ├── Dashboard.tsx             # Dashboard container
│       ├── KPIWidget.tsx             # KPI display
│       ├── ChartWidget.tsx           # Chart wrapper
│       └── TableWidget.tsx           # Table display
├── lib/
│   ├── schema/
│   │   ├── schemaLoader.ts           # Load schemas from API/files
│   │   ├── schemaValidator.ts        # Validate schema structure
│   │   └── schemaParser.ts           # Parse schema into renderable structure
│   ├── validation/
│   │   ├── validators.ts             # Built-in validators
│   │   ├── validatorRegistry.ts      # Custom validator registration
│   │   └── validationEngine.ts       # Validation orchestration
│   └── config/
│       ├── componentRegistry.ts      # Component mapping registry
│       └── themeProvider.tsx         # Theme configuration
└── hooks/
    ├── useForm.ts                    # Form state management
    ├── useValidation.ts              # Validation logic
    ├── useConditionalLogic.ts        # Show/hide logic
    └── useAPIIntegration.ts          # API call management
```

### Core Component: DynamicFormRenderer

```typescript
// src/components/form/DynamicFormRenderer.tsx
import React from 'react';
import { FormSchema, FieldConfig } from '@/types/schema';
import { useForm } from '@/hooks/useForm';
import { FieldRenderer } from './FieldRenderer';
import { TabLayout } from '../layout/TabLayout';
import { PanelLayout } from '../layout/PanelLayout';

interface DynamicFormRendererProps {
  schema: FormSchema;
  initialData?: Record<string, any>;
  onChange?: (data: Record<string, any>) => void;
  onSubmit?: (data: Record<string, any>) => Promise<void>;
}

export const DynamicFormRenderer: React.FC<DynamicFormRendererProps> = ({
  schema,
  initialData,
  onChange,
  onSubmit
}) => {
  const {
    data,
    errors,
    handleFieldChange,
    handleSubmit,
    isValid
  } = useForm(schema, initialData);

  // Notify parent of changes
  React.useEffect(() => {
    onChange?.(data);
  }, [data, onChange]);

  // Render based on layout mode
  const renderLayout = () => {
    switch (schema.layout?.mode) {
      case 'tabs':
        return <TabLayout schema={schema} data={data} errors={errors} onChange={handleFieldChange} />;
      case 'wizard':
        return <WizardLayout schema={schema} data={data} errors={errors} onChange={handleFieldChange} />;
      case 'panel':
        return <PanelLayout schema={schema} data={data} errors={errors} onChange={handleFieldChange} />;
      default:
        return renderFields(schema.fields);
    }
  };

  const renderFields = (fields: FieldConfig[]) => {
    return fields
      .filter(field => shouldShowField(field, data))
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(field => (
        <FieldRenderer
          key={field.fieldPath}
          field={field}
          value={data[field.fieldPath]}
          error={errors[field.fieldPath]}
          onChange={(value) => handleFieldChange(field.fieldPath, value)}
        />
      ));
  };

  const shouldShowField = (field: FieldConfig, formData: Record<string, any>): boolean => {
    if (!field.conditional?.visibility) return true;
    return evaluateCondition(field.conditional.visibility.showWhen, formData);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit); }}>
      {renderLayout()}
      <div className="form-actions">
        <button type="submit" disabled={!isValid}>
          Submit
        </button>
      </div>
    </form>
  );
};
```

### Field Renderer Component

```typescript
// src/components/form/FieldRenderer.tsx
import React from 'react';
import { FieldConfig } from '@/types/schema';
import { componentRegistry } from '@/lib/config/componentRegistry';

interface FieldRendererProps {
  field: FieldConfig;
  value: any;
  error?: string;
  onChange: (value: any) => void;
}

export const FieldRenderer: React.FC<FieldRendererProps> = ({
  field,
  value,
  error,
  onChange
}) => {
  const Component = componentRegistry.get(field.fieldType);

  if (!Component) {
    console.error(`No component registered for field type: ${field.fieldType}`);
    return null;
  }

  return (
    <div className={`field-container ${field.styling?.containerClass || ''}`}>
      <label className={field.styling?.labelClass}>
        {field.label}
        {field.required && <span className="required-indicator">*</span>}
      </label>
      <Component
        value={value}
        onChange={onChange}
        placeholder={field.placeholder}
        disabled={field.readOnly || !isFieldEditable(field)}
        className={field.styling?.inputClass}
        {...field.componentMapping?.props}
      />
      {error && (
        <span className={`error-message ${field.styling?.errorClass}`}>
          {error}
        </span>
      )}
      {field.helpText && (
        <span className={`help-text ${field.styling?.helpTextClass}`}>
          {field.helpText}
        </span>
      )}
    </div>
  );
};
```

### Component Registry

```typescript
// src/lib/config/componentRegistry.ts
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/DatePicker';
import { FileUpload } from '@/components/FileUpload';

type ComponentType = React.ComponentType<any>;

class ComponentRegistry {
  private registry: Map<string, ComponentType> = new Map();

  constructor() {
    // Register default components
    this.register('text', Input);
    this.register('email', Input);
    this.register('number', Input);
    this.register('dropdown', Select);
    this.register('textarea', Textarea);
    this.register('date', DatePicker);
    this.register('file', FileUpload);
  }

  register(fieldType: string, component: ComponentType) {
    this.registry.set(fieldType, component);
  }

  get(fieldType: string): ComponentType | undefined {
    return this.registry.get(fieldType);
  }

  has(fieldType: string): boolean {
    return this.registry.has(fieldType);
  }
}

export const componentRegistry = new ComponentRegistry();
```

### Custom Hook: useForm

```typescript
// src/hooks/useForm.ts
import { useState, useCallback } from 'react';
import { FormSchema } from '@/types/schema';
import { validateField, validateForm } from '@/lib/validation/validationEngine';

export const useForm = (schema: FormSchema, initialData?: Record<string, any>) => {
  const [data, setData] = useState<Record<string, any>>(initialData || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleFieldChange = useCallback((fieldPath: string, value: any) => {
    setData(prev => ({ ...prev, [fieldPath]: value }));
    setTouched(prev => ({ ...prev, [fieldPath]: true }));

    // Real-time validation
    const field = schema.fields.find(f => f.fieldPath === fieldPath);
    if (field && touched[fieldPath]) {
      const error = validateField(field, value, data);
      setErrors(prev => ({ ...prev, [fieldPath]: error || '' }));
    }
  }, [schema, data, touched]);

  const handleSubmit = useCallback(async (onSubmit?: (data: Record<string, any>) => Promise<void>) => {
    const validationErrors = validateForm(schema, data);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      await onSubmit?.(data);
    }
  }, [schema, data]);

  const isValid = Object.keys(errors).length === 0;

  return {
    data,
    errors,
    touched,
    handleFieldChange,
    handleSubmit,
    isValid
  };
};
```

---

## 15. Conclusion

This dynamic configuration-driven UI system enables:

✅ **Zero-Code Form Creation** - Build complex forms entirely from JSON  
✅ **Flexible Layouts** - Tabs, wizards, panels, grids configurable via schema  
✅ **Reusable Components** - Leverage existing UI library with minimal new code  
✅ **Smart Validation** - Centralized, reusable validation rules  
✅ **Conditional Logic** - Dynamic show/hide and enable/disable  
✅ **Multi-language** - Built-in i18n support  
✅ **Themeable** - Brand-specific styling and dark mode  
✅ **Role-Based Access** - Field and action-level permissions  
✅ **Workflow Support** - Wizards, approvals, state machines  
✅ **API Integration** - Seamless backend communication  
✅ **Extensible** - Plugin architecture for custom components  
✅ **Analytics Ready** - Dashboard and chart support  

### Next Steps

1. **Phase 1**: Implement core form generation (fields, validation, basic layouts)
2. **Phase 2**: Add advanced layouts (tabs, panels, grids)
3. **Phase 3**: Implement workflow orchestration (wizards, approvals)
4. **Phase 4**: Add dashboard and analytics widgets
5. **Phase 5**: Extensibility (plugins, custom components)

### Maintenance

- **Schema Registry**: Centralize schema storage and versioning
- **Migration Tools**: Automate schema upgrades
- **Documentation**: Auto-generate docs from schemas
- **Testing**: Automated schema validation and component testing
- **Monitoring**: Track schema usage and performance

---

**Document Version**: 1.0.0  
**Last Updated**: 2025-01-XX  
**Author**: AI Assistant  
**Status**: Design Complete - Ready for Implementation

