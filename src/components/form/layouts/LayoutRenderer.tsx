"use client";

import React from "react";
import TabbedFormLayout from "./TabbedFormLayout";
import type { FieldConfig, FilingUIConfigData } from "@/types/ui-config.types";

interface LayoutRendererProps {
  config: FilingUIConfigData;
  formData: Record<string, any>;
  onChange: (path: string, value: any) => void;
  errors?: Record<string, string>;
}

const gridColumns: Record<number, string> = {
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
  8: "col-span-8",
  12: "col-span-12",
};

function getNestedValue(data: Record<string, any>, fieldPath: string): any {
  let value: any = data;
  for (const part of fieldPath.split(".")) {
    if (value == null) return undefined;
    value = value[part];
  }
  return value;
}

function BasicField({
  field,
  formData,
  onChange,
  errors = {},
}: {
  field: FieldConfig;
  formData: Record<string, any>;
  onChange: (path: string, value: any) => void;
  errors?: Record<string, string>;
}) {
  const value = getNestedValue(formData, field.fieldPath);
  const error = errors[field.fieldPath];
  const disabled = Boolean(field.isReadOnly);
  const required = Boolean(field.isRequired);
  const gridColClass = gridColumns[field.gridColumn || 6] ?? "col-span-6";

  return (
    <div className={gridColClass}>
      <label className="block text-sm font-medium text-ink mb-1">
        {field.fieldLabel}{required && <span className="text-red-600 ml-1">*</span>}
      </label>
      <input
        type={field.fieldType === "number" ? "number" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(field.fieldPath, e.target.value)}
        disabled={disabled}
        required={required}
        placeholder={field.placeholder}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-red-500" : "border-border"} ${disabled ? "bg-gray-100 cursor-not-allowed" : "bg-white"}`}
      />
      {field.helpText && <p className="text-xs text-ink-muted mt-1">{field.helpText}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export default function LayoutRenderer({ config, formData, onChange, errors = {} }: LayoutRendererProps) {
  if (config.layoutHints && Object.keys(config.layoutHints).length > 0) {
    return <LayoutHintsRenderer config={config} formData={formData} onChange={onChange} errors={errors} />;
  }

  switch (config.layout?.mode || "single-page") {
    case "tabs":
      return <TabbedFormLayout config={config} formData={formData} onChange={onChange} errors={errors} />;
    case "accordion":
      return <ComingSoonLayout name="Accordion" />;
    case "panels":
      return <ComingSoonLayout name="Panel" />;
    default:
      return <SinglePageLayout config={config} formData={formData} onChange={onChange} errors={errors} />;
  }
}

function ComingSoonLayout({ name }: { name: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-ink-muted">{name} layout coming soon</p>
      <p className="text-xs text-ink-muted mt-2">For now, use tabs or single-page mode</p>
    </div>
  );
}

function SinglePageLayout({ config, formData, onChange, errors = {} }: LayoutRendererProps) {
  const visibleSections = [...config.sections]
    .filter((section) => section.isVisible !== false)
    .sort((a, b) => (a.sectionOrder ?? a.displayOrder ?? 0) - (b.sectionOrder ?? b.displayOrder ?? 0));

  return (
    <div className="p-6">
      {visibleSections.map((section) => {
        const fields = config.fields
          .filter((field) => (field.sectionId ?? field.section) === section.sectionId && field.isVisible !== false)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        if (fields.length === 0) return null;
        return (
          <div key={section.sectionId} className="mb-8">
            <div className="mb-4">
              <h3 className="text-base font-bold text-ink">{section.title}</h3>
              {section.description && <p className="text-sm text-ink-muted mt-1">{section.description}</p>}
            </div>
            <div className="grid grid-cols-12 gap-4">
              {fields.map((field) => <BasicField key={field.fieldPath} field={field} formData={formData} onChange={onChange} errors={errors} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LayoutHintsRenderer({ config, formData, onChange, errors = {} }: LayoutRendererProps) {
  const [activeTab, setActiveTab] = React.useState("");
  const visibleFields = config.fields.filter((field) => field.isVisible !== false);
  const layoutHints = React.useMemo(() => config.layoutHints || {}, [config.layoutHints]);
  const tabsheetEntry = Object.entries(layoutHints).find(([, type]) => type === "tabsheet");
  const tabsheetPath = tabsheetEntry?.[0] ?? "";
  const tabPaths = React.useMemo(
    () => Object.entries(layoutHints)
      .filter(([path, type]) => Boolean(tabsheetPath) && type === "tab" && path.startsWith(`${tabsheetPath}.`))
      .map(([path]) => path)
      .sort((a, b) => b.length - a.length),
    [layoutHints, tabsheetPath]
  );

  React.useEffect(() => {
    if (!activeTab && tabPaths.length > 0) setActiveTab(tabPaths[0]);
    if (activeTab && !tabPaths.includes(activeTab)) setActiveTab(tabPaths[0] ?? "");
  }, [activeTab, tabPaths]);

  const renderField = (field: FieldConfig) => (
    <BasicField key={field.fieldPath} field={field} formData={formData} onChange={onChange} errors={errors} />
  );

  if (!tabsheetEntry) {
    return (
      <div className="p-6">
        <h3 className="text-sm font-semibold text-ink mb-4">Form Fields</h3>
        <div className="grid grid-cols-12 gap-4">{visibleFields.map(renderField)}</div>
      </div>
    );
  }

  const headerFields: FieldConfig[] = [];
  const tabs: Record<string, FieldConfig[]> = {};
  for (const field of visibleFields) {
    let assignedTab: string | undefined;
    for (const tabPath of tabPaths) {
      if (field.fieldPath.startsWith(`${tabPath}.`)) {
        assignedTab = tabPath;
        break;
      }
    }
    if (assignedTab) {
      (tabs[assignedTab] ??= []).push(field);
    } else {
      headerFields.push(field);
    }
  }

  const renderTabContent = (fields: FieldConfig[], tabPath: string) => {
    const panelPaths = Object.entries(layoutHints)
      .filter(([path, type]) => type === "panel" && path.startsWith(`${tabPath}.`))
      .map(([path]) => path)
      .sort((a, b) => b.length - a.length);

    if (panelPaths.length === 0) return <div className="grid grid-cols-12 gap-4">{fields.map(renderField)}</div>;

    const panels: Record<string, FieldConfig[]> = {};
    const ungrouped: FieldConfig[] = [];
    for (const field of fields) {
      const panelPath = panelPaths.find((path) => field.fieldPath.startsWith(`${path}.`));
      if (panelPath) (panels[panelPath] ??= []).push(field);
      else ungrouped.push(field);
    }

    return (
      <div className="space-y-6">
        {ungrouped.length > 0 && <div className="grid grid-cols-12 gap-4">{ungrouped.map(renderField)}</div>}
        {panelPaths.map((panelPath) => {
          const panelFields = panels[panelPath] ?? [];
          if (panelFields.length === 0) return null;
          return (
            <details key={panelPath} open className="border border-border rounded-lg">
              <summary className="px-4 py-3 bg-surface-muted cursor-pointer hover:bg-surface font-medium text-sm text-ink">{panelPath.split(".").pop()}</summary>
              <div className="p-4 grid grid-cols-12 gap-4">{panelFields.map(renderField)}</div>
            </details>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {headerFields.length > 0 && (
        <details open className="border border-border rounded-lg bg-white">
          <summary className="px-4 py-3 bg-surface-muted cursor-pointer hover:bg-surface font-semibold text-sm text-ink">Declaration</summary>
          <div className="p-4 grid grid-cols-12 gap-4">{headerFields.map(renderField)}</div>
        </details>
      )}
      {tabPaths.length > 0 && (
        <>
          <div className="flex gap-2 border-b border-border">
            {tabPaths.map((tabPath) => (
              <button key={tabPath} type="button" onClick={() => setActiveTab(tabPath)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tabPath ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}>
                {tabPath.split(".").pop()}
              </button>
            ))}
          </div>
          {activeTab && tabs[activeTab] && <div>{renderTabContent(tabs[activeTab], activeTab)}</div>}
        </>
      )}
    </div>
  );
}
