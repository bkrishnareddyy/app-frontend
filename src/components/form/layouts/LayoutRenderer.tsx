/**
 * LayoutRenderer Component
 * 
 * Orchestrator component that routes to the appropriate layout based on UI config.
 * Supports:
 * - tabs: TabbedFormLayout
 * - accordion: AccordionLayout (future)
 * - single-page: Simple flat layout
 * - panels: PanelLayout (future)
 */

"use client";

import React from "react";
import TabbedFormLayout from "./TabbedFormLayout";
import type { FilingUIConfigData } from "@/types/ui-config.types";

interface LayoutRendererProps {
  config: FilingUIConfigData;
  formData: Record<string, any>;
  onChange: (path: string, value: any) => void;
  errors?: Record<string, string>;
}

export default function LayoutRenderer({
  config,
  formData,
  onChange,
  errors = {}
}: LayoutRendererProps) {
  // If layoutHints exist, use the new dynamic renderer
  if (config.layoutHints && Object.keys(config.layoutHints).length > 0) {
    return (
      <LayoutHintsRenderer
        config={config}
        formData={formData}
        onChange={onChange}
        errors={errors}
      />
    );
  }

  const layoutMode = config.layout?.mode || 'single-page';

  switch (layoutMode) {
    case 'tabs':
      return (
        <TabbedFormLayout
          config={config}
          formData={formData}
          onChange={onChange}
          errors={errors}
        />
      );

    case 'accordion':
      // TODO: Implement AccordionLayout
      return (
        <div className="p-8 text-center">
          <p className="text-ink-muted">Accordion layout coming soon</p>
          <p className="text-xs text-ink-muted mt-2">For now, use tabs or single-page mode</p>
        </div>
      );

    case 'panels':
      // TODO: Implement PanelLayout
      return (
        <div className="p-8 text-center">
          <p className="text-ink-muted">Panel layout coming soon</p>
          <p className="text-xs text-ink-muted mt-2">For now, use tabs or single-page mode</p>
        </div>
      );

    case 'single-page':
    default:
      // Render all sections in a single page
      return (
        <SinglePageLayout
          config={config}
          formData={formData}
          onChange={onChange}
          errors={errors}
        />
      );
  }
}

/**
 * SinglePageLayout - Simple flat layout without tabs
 */
function SinglePageLayout({
  config,
  formData,
  onChange,
  errors
}: LayoutRendererProps) {
  const visibleSections = config.sections
    .filter(section => section.isVisible !== false)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const getSectionFields = (sectionId: string) => {
    return config.fields
      .filter(field => field.sectionId === sectionId && field.isVisible !== false)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  };

  const getFieldValue = (fieldPath: string): any => {
    const parts = fieldPath.split('.');
    let value: any = formData;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  };

  const renderField = (field: any) => {
    const value = getFieldValue(field.fieldPath);
    const error = errors[field.fieldPath];
    const disabled = field.isReadOnly || false;
    const required = field.isRequired || false;

    const gridColClass = {
      3: 'col-span-3',
      4: 'col-span-4',
      6: 'col-span-6',
      8: 'col-span-8',
      12: 'col-span-12',
    }[field.gridColumn || 6] || 'col-span-6';

    return (
      <div key={field.fieldPath} className={gridColClass}>
        <label className="block text-sm font-medium text-ink mb-1">
          {field.fieldLabel}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
        
        <input
          type={field.fieldType === 'number' ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(field.fieldPath, e.target.value)}
          disabled={disabled}
          required={required}
          placeholder={field.placeholder}
          className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
            error ? 'border-red-500' : 'border-border'
          } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
        />
        
        {field.helpText && (
          <p className="text-xs text-ink-muted mt-1">{field.helpText}</p>
        )}
        
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
      </div>
    );
  };

  return (
    <div className="p-6">
      {visibleSections.map(section => {
        const fields = getSectionFields(section.id);
        if (fields.length === 0) return null;

        return (
          <div key={section.id} className="mb-8">
            <div className="mb-4">
              <h3 className="text-base font-bold text-ink">{section.title}</h3>
              {section.description && (
                <p className="text-sm text-ink-muted mt-1">{section.description}</p>
              )}
            </div>
            
            <div className="grid grid-cols-12 gap-4">
              {fields.map(renderField)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * LayoutHintsRenderer - Dynamic layout based on layoutHints metadata
 * 
 * Reads layoutHints from config and builds UI accordingly:
 * - "tabsheet" or "tab" → Creates tabs
 * - "panel" → Creates collapsible panels
 * - "card" → Creates bordered cards
 */
function LayoutHintsRenderer({
  config,
  formData,
  onChange,
  errors
}: LayoutRendererProps) {
  const [activeTab, setActiveTab] = React.useState<string>('');

  const getFieldValue = (fieldPath: string): any => {
    const parts = fieldPath.split('.');
    let value: any = formData;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  };

  const renderField = (field: any) => {
    const value = getFieldValue(field.fieldPath);
    const error = errors[field.fieldPath];
    const disabled = field.isReadOnly || false;
    const required = field.isRequired || false;

    const gridColClass = {
      3: 'col-span-3',
      4: 'col-span-4',
      6: 'col-span-6',
      8: 'col-span-8',
      12: 'col-span-12',
    }[field.gridColumn || 6] || 'col-span-6';

    return (
      <div key={field.fieldPath} className={gridColClass}>
        <label className="block text-sm font-medium text-ink mb-1">
          {field.fieldLabel}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
        
        <input
          type={field.fieldType === 'number' ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(field.fieldPath, e.target.value)}
          disabled={disabled}
          required={required}
          placeholder={field.placeholder}
          className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
            error ? 'border-red-500' : 'border-border'
          } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
        />
        
        {field.helpText && (
          <p className="text-xs text-ink-muted mt-1">{field.helpText}</p>
        )}
        
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
      </div>
    );
  };

  // Group fields by their parent paths from layoutHints
  const visibleFields = config.fields.filter(f => f.isVisible !== false);
  const layoutHints = config.layoutHints || {};
  
  // Find tabsheet (container that creates tabs from its children)
  const tabsheetEntry = Object.entries(layoutHints).find(([_, type]) => type === 'tabsheet');
  
  if (!tabsheetEntry) {
    // No tabsheet, show flat layout
    return (
      <div className="p-6">
        <h3 className="text-sm font-semibold text-ink mb-4">Form Fields</h3>
        <div className="grid grid-cols-12 gap-4">
          {visibleFields.map(renderField)}
        </div>
      </div>
    );
  }
  
  const [tabsheetPath, _] = tabsheetEntry;
  
  // Find all "tab" paths that are children of the tabsheet
  const tabPaths = Object.entries(layoutHints)
    .filter(([path, type]) => 
      type === 'tab' && path.startsWith(tabsheetPath + '.')
    )
    .map(([path]) => path)
    .sort((a, b) => b.length - a.length); // Longest first
  
  // Separate fields into:
  // 1. Header fields (directly under tabsheet, not in any tab)
  // 2. Tab fields (under specific tab paths)
  const headerFields: any[] = [];
  const tabs: { [key: string]: any[] } = {};
  
  visibleFields.forEach(field => {
    const fieldPath = field.fieldPath;
    
    // Check if field is directly under tabsheet (not in a sub-path)
    if (fieldPath.startsWith(tabsheetPath + '.')) {
      const remainder = fieldPath.substring(tabsheetPath.length + 1);
      const nextDot = remainder.indexOf('.');
      
      // If no more dots, or if it's before any tab path, it's a header field
      let isHeader = true;
      let assignedTab = null;
      
      for (const tabPath of tabPaths) {
        if (fieldPath.startsWith(tabPath + '.')) {
          isHeader = false;
          assignedTab = tabPath;
          break;
        }
      }
      
      if (isHeader && nextDot === -1) {
        // Direct child of tabsheet (e.g., GoodsDeclaration.KindOfDeclaration)
        headerFields.push(field);
      } else if (assignedTab) {
        if (!tabs[assignedTab]) {
          tabs[assignedTab] = [];
        }
        tabs[assignedTab].push(field);
      } else {
        headerFields.push(field);
      }
    } else {
      // Field not under tabsheet, put in headers
      headerFields.push(field);
    }
  });

  // Set initial active tab
  React.useEffect(() => {
    if (!activeTab && tabPaths.length > 0) {
      setActiveTab(tabPaths[0]);
    }
  }, [tabPaths, activeTab]);

  return (
    <div className="p-6 space-y-6">
      {/* Header Panel - Fields directly under tabsheet */}
      {headerFields.length > 0 && (
        <details open className="border border-border rounded-lg bg-white">
          <summary className="px-4 py-3 bg-surface-muted cursor-pointer hover:bg-surface font-semibold text-sm text-ink">
            Declaration
          </summary>
          <div className="p-4 grid grid-cols-12 gap-4">
            {headerFields.map(renderField)}
          </div>
        </details>
      )}

      {/* Tab Headers */}
      {tabPaths.length > 0 && (
        <>
          <div className="flex gap-2 border-b border-border">
            {tabPaths.map(tabPath => (
              <button
                key={tabPath}
                onClick={() => setActiveTab(tabPath)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tabPath
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {tabPath.split('.').pop()}
              </button>
            ))}
          </div>

          {/* Active Tab Content */}
          {activeTab && tabs[activeTab] && (
            <div>
              {renderTabContent(tabs[activeTab], activeTab)}
            </div>
          )}
        </>
      )}
    </div>
  );

  // Render tab content with panels if layoutHints specify "panel"
  function renderTabContent(fields: any[], tabPath: string) {
    // Find all panel paths within this tab
    const panelPaths = Object.entries(layoutHints)
      .filter(([path, type]) => type === 'panel' && path.startsWith(tabPath + '.'))
      .map(([path]) => path)
      .sort((a, b) => b.length - a.length); // Longest first

    // If no panels, just render all fields in a grid
    if (panelPaths.length === 0) {
      return (
        <div className="grid grid-cols-12 gap-4">
          {fields.map(renderField)}
        </div>
      );
    }

    // Group fields by panel
    const panels: { [key: string]: any[] } = {};
    const ungroupedFields: any[] = [];

    fields.forEach(field => {
      const fieldPath = field.fieldPath;
      let assignedPanel = null;

      for (const panelPath of panelPaths) {
        if (fieldPath.startsWith(panelPath + '.')) {
          assignedPanel = panelPath;
          break;
        }
      }

      if (assignedPanel) {
        if (!panels[assignedPanel]) {
          panels[assignedPanel] = [];
        }
        panels[assignedPanel].push(field);
      } else {
        ungroupedFields.push(field);
      }
    });

    return (
      <div className="space-y-6">
        {/* Ungrouped fields (not in any panel) */}
        {ungroupedFields.length > 0 && (
          <div className="grid grid-cols-12 gap-4">
            {ungroupedFields.map(renderField)}
          </div>
        )}

        {/* Panel fields */}
        {panelPaths.map(panelPath => {
          const panelFields = panels[panelPath];
          if (!panelFields || panelFields.length === 0) return null;

          const panelTitle = panelPath.split('.').pop();

          return (
            <details key={panelPath} open className="border border-border rounded-lg">
              <summary className="px-4 py-3 bg-surface-muted cursor-pointer hover:bg-surface font-medium text-sm text-ink">
                {panelTitle}
              </summary>
              <div className="p-4 grid grid-cols-12 gap-4">
                {panelFields.map(renderField)}
              </div>
            </details>
          );
        })}
      </div>
    );
  }
}
