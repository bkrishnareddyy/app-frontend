"use client";

import React, { useState } from "react";
import type { FilingUIConfigData, UISection, FieldConfig } from "@/types/ui-config.types";

interface TabbedFormLayoutProps {
  config: FilingUIConfigData;
  formData: Record<string, any>;
  onChange: (path: string, value: any) => void;
  errors?: Record<string, string>;
}

export default function TabbedFormLayout({ config, formData, onChange, errors = {} }: TabbedFormLayoutProps) {
  const visibleTabs = [...(config.tabs || [])]
    .filter((tab) => tab.isVisible !== false)
    .sort((a, b) => a.tabOrder - b.tabOrder);

  const [activeTabId, setActiveTabId] = useState(visibleTabs[0]?.tabId || "");

  const getTabSections = (tabId: string): UISection[] => {
    const tab = config.tabs?.find((candidate) => candidate.tabId === tabId);
    if (!tab) return [];
    const sectionIds = new Set(tab.sections);
    return [...config.sections]
      .filter((section) => sectionIds.has(section.sectionId) && section.isVisible !== false)
      .sort((a, b) => a.sectionOrder - b.sectionOrder);
  };

  const getSectionFields = (sectionId: string): FieldConfig[] => {
    return config.fields
      .filter((field) => (field.sectionId ?? field.section) === sectionId && field.isVisible !== false)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  };

  const getFieldValue = (fieldPath: string): any => {
    const parts = fieldPath.split(".");
    let value: any = formData;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  };

  const readCondition = (condition: unknown): Record<string, any> | null => {
    if (!condition) return null;
    if (typeof condition === "string") {
      try {
        return JSON.parse(condition) as Record<string, any>;
      } catch {
        return null;
      }
    }
    return typeof condition === "object" ? condition as Record<string, any> : null;
  };

  const isFieldVisible = (field: FieldConfig): boolean => {
    if (field.isVisible === false) return false;
    const showWhen = readCondition(field.showWhen);
    if (showWhen && getFieldValue(showWhen.field) !== showWhen.equals) return false;
    const hideWhen = readCondition(field.hideWhen);
    if (hideWhen && getFieldValue(hideWhen.field) === hideWhen.equals) return false;
    return true;
  };

  const isFieldDisabled = (field: FieldConfig): boolean => {
    if (field.isReadOnly) return true;
    const disableWhen = readCondition(field.disableWhen);
    return Boolean(disableWhen && getFieldValue(disableWhen.field) === disableWhen.equals);
  };

  const renderFieldInput = (field: FieldConfig, value: any, disabled: boolean, required: boolean) => {
    const commonProps = {
      value: value ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(field.fieldPath, e.target.value),
      disabled,
      required,
      placeholder: field.placeholder,
      className: `w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${errors[field.fieldPath] ? "border-red-500" : "border-border"} ${disabled ? "bg-gray-100 cursor-not-allowed" : "bg-white"}`,
    };

    switch (field.fieldType) {
      case "textarea":
        return <textarea {...commonProps} rows={3} />;
      case "number":
      case "currency":
        return <input {...commonProps} type="number" />;
      case "email":
        return <input {...commonProps} type="email" />;
      case "date":
        return <input {...commonProps} type="date" />;
      case "datetime":
        return <input {...commonProps} type="datetime-local" />;
      case "time":
        return <input {...commonProps} type="time" />;
      case "checkbox":
        return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field.fieldPath, e.target.checked)} disabled={disabled} className="w-4 h-4 text-primary border-border rounded" />;
      case "dropdown":
      case "multiselect":
        return <select {...commonProps} multiple={field.fieldType === "multiselect"}><option value="">Select...</option></select>;
      case "phone":
        return <input {...commonProps} type="tel" />;
      case "url":
        return <input {...commonProps} type="url" />;
      case "file":
        return <input {...commonProps} type="file" value={undefined} />;
      default:
        return <input {...commonProps} type="text" />;
    }
  };

  const renderField = (field: FieldConfig) => {
    if (!isFieldVisible(field)) return null;
    const value = getFieldValue(field.fieldPath);
    const error = errors[field.fieldPath];
    const disabled = isFieldDisabled(field);
    const required = Boolean(field.isRequired);
    const gridColClass = ({ 3: "col-span-3", 4: "col-span-4", 6: "col-span-6", 8: "col-span-8", 12: "col-span-12" } as Record<number, string>)[field.gridColumn || 6] || "col-span-6";

    return (
      <div key={field.fieldPath} className={gridColClass}>
        <label className="block text-sm font-medium text-ink mb-1">{field.fieldLabel}{required && <span className="text-red-600 ml-1">*</span>}</label>
        {renderFieldInput(field, value, disabled, required)}
        {field.helpText && <p className="text-xs text-ink-muted mt-1">{field.helpText}</p>}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    );
  };

  const renderSection = (section: UISection) => {
    const fields = getSectionFields(section.sectionId);
    if (fields.length === 0) return null;
    return (
      <div key={section.sectionId} className="mb-6">
        <div className="mb-4">
          <h3 className="text-base font-bold text-ink">{section.title}</h3>
          {section.description && <p className="text-sm text-ink-muted mt-1">{section.description}</p>}
        </div>
        <div className={`grid grid-cols-12 gap-4 ${section.layout === "grid" ? "" : "flex flex-col"}`}>{fields.map(renderField)}</div>
      </div>
    );
  };

  if (visibleTabs.length === 0) {
    return <div className="p-8 text-center text-ink-muted"><p>No form configuration available</p></div>;
  }

  const activeTab = visibleTabs.find((tab) => tab.tabId === activeTabId) || visibleTabs[0];
  const activeSections = getTabSections(activeTab.tabId);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-white">
        <div className="flex gap-1 px-6">
          {visibleTabs.map((tab) => {
            const isActive = tab.tabId === activeTabId;
            return (
              <button key={tab.tabId} type="button" onClick={() => setActiveTabId(tab.tabId)} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${isActive ? "border-primary text-primary bg-blue-50" : "border-transparent text-ink-muted hover:text-ink hover:border-gray-300"}`}>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeSections.length === 0 ? <div className="text-center text-ink-muted py-12"><p>No fields configured for this tab</p></div> : activeSections.map(renderSection)}
      </div>
    </div>
  );
}
