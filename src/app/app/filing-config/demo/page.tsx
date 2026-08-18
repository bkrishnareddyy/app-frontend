"use client";

import React, { useState } from "react";
import TabbedFormLayout from "@/components/form/layouts/TabbedFormLayout";
import type { FilingUIConfigData } from "@/types/ui-config.types";

/**
 * Demo: Trader Parties as Tabs
 * 
 * Shows how GoodsDeclaration.Traders would render as tabs:
 * - Tab 1: Consignor
 * - Tab 2: Consignee
 * - Tab 3: Seller
 * - Tab 4: Buyer
 */

// Sample configuration with trader parties as tabs
const traderTabsConfig: FilingUIConfigData = {
  version: "1.0.0",
  metadata: {
    title: "Trader Parties Configuration (Demo)",
    description: "Shows trader party types as separate tabs",
    tags: ["demo", "traders", "tabs"],
    lastModifiedAt: new Date().toISOString()
  },
  layout: {
    mode: "tabs",
    tabPosition: "top",
    defaultColumns: 2
  },
  tabs: [
    {
      tabId: "consignor-tab",
      label: "Consignor",
      icon: "Building",
      tabOrder: 1,
      isVisible: true,
      sections: ["consignor-section"]
    },
    {
      tabId: "consignee-tab",
      label: "Consignee",
      icon: "Package",
      tabOrder: 2,
      isVisible: true,
      sections: ["consignee-section"]
    },
    {
      tabId: "seller-tab",
      label: "Seller",
      icon: "Store",
      tabOrder: 3,
      isVisible: true,
      sections: ["seller-section"]
    },
    {
      tabId: "buyer-tab",
      label: "Buyer",
      icon: "ShoppingCart",
      tabOrder: 4,
      isVisible: true,
      sections: ["buyer-section"]
    }
  ],
  sections: [
    {
      sectionId: "consignor-section",
      title: "Consignor Details",
      sectionOrder: 1,
      layout: "grid",
      columns: 2,
      isVisible: true,
      isCollapsible: false,
      defaultExpanded: true,
      fields: [
        "GoodsDeclaration.Consignor.name",
        "GoodsDeclaration.Consignor.ID",
        "GoodsDeclaration.Consignor.Address.line",
        "GoodsDeclaration.Consignor.Address.cityName",
        "GoodsDeclaration.Consignor.Address.countryCode",
        "GoodsDeclaration.Consignor.Address.postcodeID"
      ]
    },
    {
      sectionId: "consignee-section",
      title: "Consignee Details",
      sectionOrder: 1,
      layout: "grid",
      columns: 2,
      isVisible: true,
      isCollapsible: false,
      defaultExpanded: true,
      fields: [
        "GoodsDeclaration.Consignee.name",
        "GoodsDeclaration.Consignee.ID",
        "GoodsDeclaration.Consignee.Address.line",
        "GoodsDeclaration.Consignee.Address.cityName",
        "GoodsDeclaration.Consignee.Address.countryCode",
        "GoodsDeclaration.Consignee.Address.postcodeID"
      ]
    },
    {
      sectionId: "seller-section",
      title: "Seller Details",
      sectionOrder: 1,
      layout: "grid",
      columns: 2,
      isVisible: true,
      isCollapsible: false,
      defaultExpanded: true,
      fields: [
        "GoodsDeclaration.Seller.name",
        "GoodsDeclaration.Seller.ID",
        "GoodsDeclaration.Seller.Address.line",
        "GoodsDeclaration.Seller.Address.cityName"
      ]
    },
    {
      sectionId: "buyer-section",
      title: "Buyer Details",
      sectionOrder: 1,
      layout: "grid",
      columns: 2,
      isVisible: true,
      isCollapsible: false,
      defaultExpanded: true,
      fields: [
        "GoodsDeclaration.Buyer.name",
        "GoodsDeclaration.Buyer.ID",
        "GoodsDeclaration.Buyer.Address.line",
        "GoodsDeclaration.Buyer.Address.cityName"
      ]
    }
  ],
  panels: [],
  fields: [
    // Consignor Fields
    {
      fieldPath: "GoodsDeclaration.Consignor.name",
      fieldLabel: "Company Name",
      fieldType: "text",
      section: "consignor-section",
      displayOrder: 1,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false,
      placeholder: "Enter consignor company name",
      helpText: "Legal name of the consigning company"
    },
    {
      fieldPath: "GoodsDeclaration.Consignor.ID",
      fieldLabel: "Tax ID / EORI",
      fieldType: "text",
      section: "consignor-section",
      displayOrder: 2,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false,
      placeholder: "e.g., NL123456789B01",
      helpText: "EORI or Tax identification number"
    },
    {
      fieldPath: "GoodsDeclaration.Consignor.Address.line",
      fieldLabel: "Street Address",
      fieldType: "text",
      section: "consignor-section",
      displayOrder: 3,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignor.Address.cityName",
      fieldLabel: "City",
      fieldType: "text",
      section: "consignor-section",
      displayOrder: 4,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignor.Address.postcodeID",
      fieldLabel: "Postal Code",
      fieldType: "text",
      section: "consignor-section",
      displayOrder: 5,
      gridColumn: 6,
      isVisible: true,
      isRequired: false,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignor.Address.countryCode",
      fieldLabel: "Country",
      fieldType: "dropdown",
      section: "consignor-section",
      displayOrder: 6,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false,
      dataSource: {
        type: "static",
        options: [
          { value: "NL", label: "Netherlands" },
          { value: "BE", label: "Belgium" },
          { value: "DE", label: "Germany" },
          { value: "FR", label: "France" }
        ]
      }
    },

    // Consignee Fields (similar structure)
    {
      fieldPath: "GoodsDeclaration.Consignee.name",
      fieldLabel: "Company Name",
      fieldType: "text",
      section: "consignee-section",
      displayOrder: 1,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false,
      placeholder: "Enter consignee company name"
    },
    {
      fieldPath: "GoodsDeclaration.Consignee.ID",
      fieldLabel: "Tax ID / EORI",
      fieldType: "text",
      section: "consignee-section",
      displayOrder: 2,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignee.Address.line",
      fieldLabel: "Street Address",
      fieldType: "text",
      section: "consignee-section",
      displayOrder: 3,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignee.Address.cityName",
      fieldLabel: "City",
      fieldType: "text",
      section: "consignee-section",
      displayOrder: 4,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignee.Address.postcodeID",
      fieldLabel: "Postal Code",
      fieldType: "text",
      section: "consignee-section",
      displayOrder: 5,
      gridColumn: 6,
      isVisible: true,
      isRequired: false,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Consignee.Address.countryCode",
      fieldLabel: "Country",
      fieldType: "dropdown",
      section: "consignee-section",
      displayOrder: 6,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false,
      dataSource: {
        type: "static",
        options: [
          { value: "NL", label: "Netherlands" },
          { value: "BE", label: "Belgium" },
          { value: "DE", label: "Germany" },
          { value: "FR", label: "France" }
        ]
      }
    },

    // Seller Fields
    {
      fieldPath: "GoodsDeclaration.Seller.name",
      fieldLabel: "Company Name",
      fieldType: "text",
      section: "seller-section",
      displayOrder: 1,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Seller.ID",
      fieldLabel: "Tax ID",
      fieldType: "text",
      section: "seller-section",
      displayOrder: 2,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Seller.Address.line",
      fieldLabel: "Address",
      fieldType: "text",
      section: "seller-section",
      displayOrder: 3,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Seller.Address.cityName",
      fieldLabel: "City",
      fieldType: "text",
      section: "seller-section",
      displayOrder: 4,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },

    // Buyer Fields
    {
      fieldPath: "GoodsDeclaration.Buyer.name",
      fieldLabel: "Company Name",
      fieldType: "text",
      section: "buyer-section",
      displayOrder: 1,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Buyer.ID",
      fieldLabel: "Tax ID",
      fieldType: "text",
      section: "buyer-section",
      displayOrder: 2,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Buyer.Address.line",
      fieldLabel: "Address",
      fieldType: "text",
      section: "buyer-section",
      displayOrder: 3,
      gridColumn: 12,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    },
    {
      fieldPath: "GoodsDeclaration.Buyer.Address.cityName",
      fieldLabel: "City",
      fieldType: "text",
      section: "buyer-section",
      displayOrder: 4,
      gridColumn: 6,
      isVisible: true,
      isRequired: true,
      isReadOnly: false
    }
  ],
  validation: {
    crossFieldRules: [],
    strategy: {
      realTime: true,
      triggerOn: ["blur", "change"],
      debounce: 300,
      onSubmit: true,
      stopOnFirstError: false,
      scrollToFirstError: true
    }
  },
  conditionalLogic: {
    rules: [],
    debug: false
  },
  translations: {
    locales: ["en"],
    defaultLocale: "en"
  },
  permissions: {
    roles: {},
    defaultRole: "operator"
  }
};

export default function TraderTabsDemo() {
  const [formData, setFormData] = useState<Record<string, any>>({});

  const handleChange = (fieldPath: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldPath]: value
    }));
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-white border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">
              📋
            </div>
            <div>
              <h1 className="text-2xl font-bold text-ink">Trader Parties Demo</h1>
              <p className="text-sm text-ink-muted mt-1">
                Preview: Tab-based layout for GoodsDeclaration.Traders
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="bg-white rounded-lg border border-border shadow-sm overflow-hidden">
          {/* Info Banner */}
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-4">
            <div className="flex items-start gap-3">
              <div className="text-blue-600 text-xl">ℹ️</div>
              <div>
                <h3 className="text-sm font-semibold text-blue-900">
                  This is how your Trader Parties would look as tabs
                </h3>
                <p className="text-xs text-blue-700 mt-1">
                  Each tab (Consignor, Consignee, Seller, Buyer) contains relevant party fields.
                  Click the tabs to navigate between different trader types.
                </p>
              </div>
            </div>
          </div>

          {/* Render the form */}
          <TabbedFormLayout
            config={traderTabsConfig}
            formData={formData}
            onChange={handleChange}
            errors={{}}
          />
        </div>

        {/* Configuration Explanation */}
        <div className="mt-8 bg-white rounded-lg border border-border p-6">
          <h2 className="text-lg font-bold text-ink mb-4">📐 Configuration Structure</h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">1. Layout Mode</h3>
              <code className="block bg-surface-muted p-3 rounded text-xs">
                layout.mode = "tabs"
              </code>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">2. Tabs Definition</h3>
              <code className="block bg-surface-muted p-3 rounded text-xs whitespace-pre">
{`tabs: [
  { tabId: "consignor-tab", label: "Consignor", sections: ["consignor-section"] },
  { tabId: "consignee-tab", label: "Consignee", sections: ["consignee-section"] },
  { tabId: "seller-tab", label: "Seller", sections: ["seller-section"] },
  { tabId: "buyer-tab", label: "Buyer", sections: ["buyer-section"] }
]`}
              </code>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">3. Sections (One per Tab)</h3>
              <code className="block bg-surface-muted p-3 rounded text-xs whitespace-pre">
{`sections: [
  { sectionId: "consignor-section", title: "Consignor Details", layout: "grid" },
  { sectionId: "consignee-section", title: "Consignee Details", layout: "grid" },
  ...
]`}
              </code>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">4. Fields Assignment</h3>
              <code className="block bg-surface-muted p-3 rounded text-xs whitespace-pre">
{`fields: [
  { fieldPath: "GoodsDeclaration.Consignor.name", section: "consignor-section" },
  { fieldPath: "GoodsDeclaration.Consignor.ID", section: "consignor-section" },
  ...
]`}
              </code>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="mt-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 p-6">
          <h2 className="text-lg font-bold text-ink mb-3">✅ Next Steps</h2>
          <ul className="space-y-2 text-sm text-ink-muted">
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">1.</span>
              <span>If you like this layout, I can integrate TabManager into the UIConfigEditor</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">2.</span>
              <span>Or I can generate this JSON config for you to save directly</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">3.</span>
              <span>The TabbedFormLayout component will render it just like you see above</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
