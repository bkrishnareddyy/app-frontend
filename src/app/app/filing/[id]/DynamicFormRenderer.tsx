/**
 * Dynamic Form Renderer Component
 * 
 * Renders form fields dynamically based on UI configuration fetched from the database.
 * Supports various field types: text, number, date, datetime, checkbox, textarea, dropdown, lookup.
 * Handles nested object paths (e.g., "importer.name") and array fields (e.g., "lineItems[].hsCode6").
 */

"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import LineItemsManager from "./LineItemsManager";
import DefaultSchemaRenderer from "./DefaultSchemaRenderer";

interface UIFieldConfig {
  id: string;
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  displayOrder: number;
  gridColumn: number;
  isRequired: boolean;
  isReadOnly: boolean;
  placeholder?: string | null;
  helpText?: string | null;
  masterDataSource?: string | null;
  isMultiSelect: boolean;
  isArrayField: boolean;
  validationRules?: any;
}

interface UIConfigSection {
  [sectionName: string]: UIFieldConfig[];
}

interface DynamicFormRendererProps {
  country: string;
  procedureCode: string;
  messageName: string;
  messageType: "request" | "response";
  data: Record<string, any>;
  onChange: (fieldPath: string, value: any) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

interface MasterDataOption {
  value: string;
  label: string;
}

export default function DynamicFormRenderer({
  country,
  procedureCode,
  messageName,
  messageType,
  data,
  onChange,
  onSave,
  readOnly = false,
}: DynamicFormRendererProps) {
  const [uiConfig, setUiConfig] = useState<UIConfigSection | null>(null);
  const [masterDataCache, setMasterDataCache] = useState<Record<string, MasterDataOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<any>(null);
  const [useDefaultRenderer, setUseDefaultRenderer] = useState(false);

  // Fetch UI configuration and schema
  useEffect(() => {
    async function fetchUIConfig() {
      try {
        setLoading(true);
        setError(null);

        // Try to fetch UI configuration
        const response = await fetch(
          `/api/filing/ui-config?country=${country}&procedureCode=${procedureCode}&messageName=${messageName}&messageType=${messageType}`
        );

        if (response.ok) {
          const result = await response.json();
          
          // Check if any configs exist
          const hasConfigs = result.sections && Object.keys(result.sections).length > 0;
          
          if (hasConfigs) {
            // Filter out fields where isVisible = false
            const filteredSections: UIConfigSection = {};
            Object.entries(result.sections).forEach(([section, fields]: [string, any]) => {
              const visibleFields = fields.filter((field: UIFieldConfig) => field.isVisible !== false);
              if (visibleFields.length > 0) {
                filteredSections[section] = visibleFields;
              }
            });
            
            setUiConfig(filteredSections);
            setUseDefaultRenderer(false);
          } else {
            // No configs found, will use default renderer
            setUseDefaultRenderer(true);
            await loadSchema();
          }
        } else if (response.status === 404) {
          // No configuration found, use default renderer
          setUseDefaultRenderer(true);
          await loadSchema();
        } else {
          throw new Error("Failed to fetch UI configuration");
        }
      } catch (err) {
        console.error("Error fetching UI config:", err);
        // On error, try to fall back to default renderer
        setUseDefaultRenderer(true);
        await loadSchema();
      } finally {
        setLoading(false);
      }
    }

    fetchUIConfig();
  }, [country, procedureCode, messageName, messageType]);

  // Load schema for default renderer
  const loadSchema = async () => {
    try {
      // Determine transaction type from procedure code
      // H* = import, E* = export
      const transactionType = procedureCode.toUpperCase().startsWith('H') ? 'import' : 'export';
      const schemaFileName = transactionType === "import" 
        ? "ImportDeclaration.schema.json" 
        : "ExportDeclaration.schema.json";
      
      const response = await fetch(
        `/schemas/customs-filing/filing-schemas/${transactionType}/1.0.0/${schemaFileName}`
      );
      
      if (response.ok) {
        const schemaData = await response.json();
        setSchema(schemaData);
      } else {
        console.error("Failed to load schema for default renderer");
      }
    } catch (err) {
      console.error("Error loading schema:", err);
    }
  };

  // Fetch master data for dropdown/lookup fields
  const fetchMasterData = async (sourceName: string): Promise<MasterDataOption[]> => {
    if (masterDataCache[sourceName]) {
      return masterDataCache[sourceName];
    }

    try {
      const response = await fetch(`/api/filing/master-data?source=${sourceName}`);
      if (!response.ok) {
        console.error(`Failed to fetch master data for ${sourceName}`);
        return [];
      }

      const result = await response.json();
      const options = result.options || [];
      
      setMasterDataCache(prev => ({ ...prev, [sourceName]: options }));
      return options;
    } catch (err) {
      console.error(`Error fetching master data for ${sourceName}:`, err);
      return [];
    }
  };

  // Get nested value from data object using dot notation
  const getNestedValue = (obj: any, path: string): any => {
    // Handle array field paths like "lineItems[].hsCode6"
    if (path.includes("[]")) {
      const [arrayPath, ...rest] = path.split("[].");
      const arrayData = obj[arrayPath] || [];
      if (rest.length === 0) return arrayData;
      // For now, return empty string for array field rendering
      return "";
    }

    return path.split(".").reduce((current, key) => current?.[key], obj);
  };

  // Set nested value in data object using dot notation
  const setNestedValue = (path: string, value: any) => {
    onChange(path, value);
  };

  // Render field based on type
  const renderField = (field: UIFieldConfig) => {
    const value = getNestedValue(data, field.fieldPath);
    const isDisabled = readOnly || field.isReadOnly;

    // Skip array fields for now (will be handled separately)
    if (field.isArrayField) {
      return null;
    }

    switch (field.fieldType) {
      case "text":
        return (
          <Input
            value={value || ""}
            onChange={(e) => setNestedValue(field.fieldPath, e.target.value)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="text-xs"
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={value || 0}
            onChange={(e) => setNestedValue(field.fieldPath, parseFloat(e.target.value) || 0)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="text-xs"
            step="0.01"
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={value || ""}
            onChange={(e) => setNestedValue(field.fieldPath, e.target.value)}
            disabled={isDisabled}
            className="text-xs"
          />
        );

      case "datetime":
        return (
          <Input
            type="datetime-local"
            value={value || ""}
            onChange={(e) => setNestedValue(field.fieldPath, e.target.value)}
            disabled={isDisabled}
            className="text-xs"
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => setNestedValue(field.fieldPath, e.target.checked)}
              disabled={isDisabled}
              className="w-4 h-4 rounded border-border text-brand focus:ring-brand"
            />
          </div>
        );

      case "textarea":
        return (
          <textarea
            value={value || ""}
            onChange={(e) => setNestedValue(field.fieldPath, e.target.value)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="w-full text-xs px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand"
            rows={3}
          />
        );

      case "dropdown":
      case "lookup":
        return (
          <DropdownField
            field={field}
            value={value}
            onChange={(newValue) => setNestedValue(field.fieldPath, newValue)}
            disabled={isDisabled}
            fetchMasterData={fetchMasterData}
          />
        );

      default:
        return (
          <Input
            value={value || ""}
            onChange={(e) => setNestedValue(field.fieldPath, e.target.value)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="text-xs"
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-ink-muted">Loading form configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-800">Error loading form: {error}</p>
      </div>
    );
  }

  // Use default schema renderer if no UI config found
  if (useDefaultRenderer && schema) {
    return (
      <DefaultSchemaRenderer
        schema={schema}
        data={data}
        onChange={onChange}
        onSave={onSave}
        readOnly={readOnly}
        maxDepth={3}
      />
    );
  }

  // Fallback if neither config nor schema available
  if (!uiConfig) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">
          No form configuration or schema available for {country} / {procedureCode} / {messageName} ({messageType})
        </p>
        <p className="text-xs text-yellow-700 mt-2">
          Please configure fields in the Filing Configuration section.
        </p>
      </div>
    );
  }

  // Section title mapping for better display
  const sectionTitles: Record<string, string> = {
    header: "Declaration Header",
    parties: "Parties",
    transport: "Transport Information",
    commercial: "Commercial Details",
    lineItems: "Line Items",
    valuation: "Valuation",
    totals: "Totals & Summary",
    compliance: "Compliance",
    evidence: "Evidence & Documentation",
    assessment: "Assessment Results",
    release: "Release Information",
    errors: "Errors & Warnings",
    notes: "Notes & Remarks",
  };

  return (
    <div className="space-y-6">
      {Object.entries(uiConfig).map(([sectionName, fields]) => (
        <div key={sectionName} className="space-y-3 pt-4 border-t border-border">
          <h4 className="text-xs font-bold text-ink uppercase tracking-wider">
            {sectionTitles[sectionName] || sectionName}
          </h4>

          {/* Handle array fields (lineItems) separately */}
          {sectionName === "lineItems" || sectionName === "errors" ? (
            <LineItemsManager
              arrayFields={fields}
              items={data[sectionName.replace("[]", "")] || []}
              onChange={(items) => onChange(sectionName.replace("[]", ""), items)}
              readOnly={readOnly}
              masterDataCache={masterDataCache}
              fetchMasterData={fetchMasterData}
            />
          ) : (
            <div className="grid grid-cols-12 gap-4">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className={`col-span-12 md:col-span-${field.gridColumn}`}
                  style={{ gridColumn: `span ${field.gridColumn} / span ${field.gridColumn}` }}
                >
                  <label className="text-xs text-ink-muted">
                    {field.fieldLabel}
                    {field.isRequired && <span className="text-red-600 ml-1">*</span>}
                  </label>
                  {renderField(field)}
                  {field.helpText && (
                    <p className="text-[10px] text-ink-muted mt-1">{field.helpText}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {onSave && !readOnly && (
        <div className="flex justify-end pt-4 border-t border-border">
          <Button onClick={onSave} size="sm">
            Save Draft
          </Button>
        </div>
      )}
    </div>
  );
}

// Dropdown/Lookup field component with async data loading
function DropdownField({
  field,
  value,
  onChange,
  disabled,
  fetchMasterData,
}: {
  field: UIFieldConfig;
  value: any;
  onChange: (value: any) => void;
  disabled: boolean;
  fetchMasterData: (sourceName: string) => Promise<MasterDataOption[]>;
}) {
  const [options, setOptions] = useState<MasterDataOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (field.masterDataSource) {
      setLoading(true);
      fetchMasterData(field.masterDataSource)
        .then(setOptions)
        .finally(() => setLoading(false));
    }
  }, [field.masterDataSource, fetchMasterData]);

  if (loading) {
    return (
      <Input
        value="Loading..."
        disabled
        className="text-xs"
      />
    );
  }

  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full text-xs px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-white"
    >
      <option value="">{field.placeholder || "Select..."}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
