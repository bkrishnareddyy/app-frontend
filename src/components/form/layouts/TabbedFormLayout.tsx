/**
 * TabbedFormLayout Component
 * 
 * Renders a form with tab-based navigation based on UI config JSON.
 * Features:
 * - Tab navigation from config.tabs
 * - Section rendering within tabs
 * - Field rendering with validation
 * - Conditional visibility
 * - Responsive design
 */

"use client";

import React, { useState } from "react";
import type { FilingUIConfigData, UITab, UISection, FieldConfig } from "@/types/ui-config.types";

interface TabbedFormLayoutProps {
  config: FilingUIConfigData;
  formData: Record<string, any>;
  onChange: (path: string, value: any) => void;
  errors?: Record<string, string>;
}

export default function TabbedFormLayout({
  config,
  formData,
  onChange,
  errors = {}
}: TabbedFormLayoutProps) {
  // Get visible tabs sorted by tab order
  const visibleTabs = (config.tabs || [])
    .filter(tab => tab.isVisible !== false)
    .sort((a, b) => a.tabOrder - b.tabOrder); // Changed from displayOrder

  const [activeTabId, setActiveTabId] = useState(visibleTabs[0]?.tabId || ''); // Changed from id

  // Get sections for a tab
  const getTabSections = (tabId: string): UISection[] => {
    const tab = config.tabs?.find(t => t.tabId === tabId);
    if (!tab) return [];
    
    // Get section IDs from tab.sections array
    const sectionIds = new Set(tab.sections);
    
    return config.sections
      .filter(section => sectionIds.has(section.sectionId) && section.isVisible !== false)
      .sort((a, b) => a.sectionOrder - b.sectionOrder); // Changed from displayOrder
  };

  // Get fields for a section
  const getSectionFields = (sectionId: string): FieldConfig[] => {
    return config.fields
      .filter(field => field.section === sectionId && field.isVisible !== false) // Changed from sectionId
      .sort((a, b) => a.displayOrder - b.displayOrder);
  };

  // Get field value from form data
  const getFieldValue = (fieldPath: string): any => {
    const parts = fieldPath.split('.');
    let value: any = formData;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  };

  // Check if field should be visible based on conditional logic
  const isFieldVisible = (field: FieldConfig): boolean => {
    if (field.isVisible === false) return false;
    
    // Check showWhen condition
    if (field.showWhen) {
      try {
        const condition = typeof field.showWhen === 'string' 
          ? JSON.parse(field.showWhen) 
          : field.showWhen;
        const fieldValue = getFieldValue(condition.field);
        if (fieldValue !== condition.equals) return false;
      } catch {}
    }

    // Check hideWhen condition
    if (field.hideWhen) {
      try {
        const condition = typeof field.hideWhen === 'string'
          ? JSON.parse(field.hideWhen)
          : field.hideWhen;
        const fieldValue = getFieldValue(condition.field);
        if (fieldValue === condition.equals) return false;
      } catch {}
    }

    return true;
  };

  // Check if field is disabled
  const isFieldDisabled = (field: FieldConfig): boolean => {
    if (field.isReadOnly) return true;

    if (field.disableWhen) {
      try {
        const condition = typeof field.disableWhen === 'string'
          ? JSON.parse(field.disableWhen)
          : field.disableWhen;
        const fieldValue = getFieldValue(condition.field);
        return fieldValue === condition.equals;
      } catch {}
    }

    return false;
  };

  // Render a single field
  const renderField = (field: FieldConfig) => {
    if (!isFieldVisible(field)) return null;

    const value = getFieldValue(field.fieldPath);
    const error = errors[field.fieldPath];
    const disabled = isFieldDisabled(field);
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
        
        {renderFieldInput(field, value, disabled, required)}
        
        {field.helpText && (
          <p className="text-xs text-ink-muted mt-1">{field.helpText}</p>
        )}
        
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
      </div>
    );
  };

  // Render field input based on type
  const renderFieldInput = (field: FieldConfig, value: any, disabled: boolean, required: boolean) => {
    const commonProps = {
      value: value || '',
      onChange: (e: any) => onChange(field.fieldPath, e.target.value),
      disabled,
      required,
      placeholder: field.placeholder,
      className: `w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
        errors[field.fieldPath] ? 'border-red-500' : 'border-border'
      } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`
    };

    switch (field.fieldType) {
      case 'textarea':
        return <textarea {...commonProps} rows={3} />;
      
      case 'number':
      case 'currency':
        return <input {...commonProps} type="number" />;
      
      case 'email':
        return <input {...commonProps} type="email" />;
      
      case 'date':
        return <input {...commonProps} type="date" />;
      
      case 'datetime':
        return <input {...commonProps} type="datetime-local" />;
      
      case 'time':
        return <input {...commonProps} type="time" />;
      
      case 'checkbox':
        return (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(field.fieldPath, e.target.checked)}
              disabled={disabled}
              className="w-4 h-4 text-primary border-border rounded"
            />
          </div>
        );
      
      case 'dropdown':
      case 'multiselect':
        return (
          <select
            {...commonProps}
            multiple={field.fieldType === 'multiselect'}
          >
            <option value="">Select...</option>
            {/* TODO: Load options from field.dataSource or field.masterDataSource */}
          </select>
        );
      
      case 'phone':
        return <input {...commonProps} type="tel" />;
      
      case 'url':
        return <input {...commonProps} type="url" />;
      
      case 'file':
        return <input {...commonProps} type="file" />;
      
      default:
        return <input {...commonProps} type="text" />;
    }
  };

  // Render a section
  const renderSection = (section: UISection) => {
    const fields = getSectionFields(section.id);
    if (fields.length === 0) return null;

    return (
      <div key={section.id} className="mb-6">
        <div className="mb-4">
          <h3 className="text-base font-bold text-ink">{section.title}</h3>
          {section.description && (
            <p className="text-sm text-ink-muted mt-1">{section.description}</p>
          )}
        </div>
        
        <div className={`grid grid-cols-12 gap-4 ${
          section.layout === 'grid' ? '' : 'flex flex-col' // Changed from layoutMode
        }`}>
          {fields.map(renderField)}
        </div>
      </div>
    );
  };

  if (visibleTabs.length === 0) {
    return (
      <div className="p-8 text-center text-ink-muted">
        <p>No form configuration available</p>
      </div>
    );
  }

  const activeTab = visibleTabs.find(t => t.tabId === activeTabId) || visibleTabs[0]; // Changed from id
  const activeSections = getTabSections(activeTab.tabId); // Changed from id

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="border-b border-border bg-white">
        <div className="flex gap-1 px-6">
          {visibleTabs.map(tab => {
            const isActive = tab.tabId === activeTabId; // Changed from id
            return (
              <button
                key={tab.tabId} // Changed from id
                onClick={() => setActiveTabId(tab.tabId)} // Changed from id
                className={`
                  px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${isActive
                    ? 'border-primary text-primary bg-blue-50'
                    : 'border-transparent text-ink-muted hover:text-ink hover:border-gray-300'
                  }
                `}
              >
                {tab.label} {/* Changed from title */}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeSections.length === 0 ? (
          <div className="text-center text-ink-muted py-12">
            <p>No fields configured for this tab</p>
          </div>
        ) : (
          activeSections.map(renderSection)
        )}
      </div>
    </div>
  );
}
