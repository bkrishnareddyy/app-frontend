/**
 * Line Items Manager Component
 * 
 * Manages array fields (line items) with add/remove functionality.
 * Each line item contains multiple fields defined by UI configuration.
 */

"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

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
}

interface MasterDataOption {
  value: string;
  label: string;
}

interface LineItemsManagerProps {
  arrayFields: UIFieldConfig[];
  items: any[];
  onChange: (items: any[]) => void;
  readOnly?: boolean;
  masterDataCache: Record<string, MasterDataOption[]>;
  fetchMasterData: (sourceName: string) => Promise<MasterDataOption[]>;
}

export default function LineItemsManager({
  arrayFields,
  items = [],
  onChange,
  readOnly = false,
  masterDataCache,
  fetchMasterData,
}: LineItemsManagerProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set([0]));

  // Sort fields by display order
  const sortedFields = [...arrayFields].sort((a, b) => a.displayOrder - b.displayOrder);

  // Extract field key from path (e.g., "lineItems[].hsCode6" -> "hsCode6")
  const getFieldKey = (fieldPath: string): string => {
    return fieldPath.split("[].").pop() || fieldPath;
  };

  // Get field value from item
  const getFieldValue = (item: any, fieldPath: string): any => {
    const fieldKey = getFieldKey(fieldPath);
    
    // Handle nested paths like "quantity.value"
    if (fieldKey.includes(".")) {
      const parts = fieldKey.split(".");
      let value = item;
      for (const part of parts) {
        if (value == null) return "";
        value = value[part];
      }
      return value ?? "";
    }
    
    return item[fieldKey] ?? "";
  };

  // Set field value in item
  const setFieldValue = (index: number, fieldPath: string, value: any) => {
    const fieldKey = getFieldKey(fieldPath);
    const newItems = [...items];
    
    // Handle nested paths like "quantity.value"
    if (fieldKey.includes(".")) {
      const parts = fieldKey.split(".");
      let current = newItems[index];
      
      // Navigate to parent object
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      
      // Set the final value
      current[parts[parts.length - 1]] = value;
    } else {
      newItems[index][fieldKey] = value;
    }
    
    onChange(newItems);
  };

  // Add new item
  const addItem = () => {
    const newItem: any = {
      lineNumber: items.length + 1,
    };
    
    // Initialize fields with default values based on type
    sortedFields.forEach(field => {
      const fieldKey = getFieldKey(field.fieldPath);
      if (fieldKey.includes(".")) {
        const parts = fieldKey.split(".");
        let current = newItem;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = field.fieldType === "number" ? 0 : "";
      } else {
        newItem[fieldKey] = field.fieldType === "number" ? 0 : "";
      }
    });
    
    const newItems = [...items, newItem];
    onChange(newItems);
    setExpandedItems(prev => new Set([...prev, items.length]));
  };

  // Remove item
  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    // Renumber line numbers
    newItems.forEach((item, i) => {
      item.lineNumber = i + 1;
    });
    onChange(newItems);
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      newSet.delete(index);
      return newSet;
    });
  };

  // Toggle item expansion
  const toggleExpanded = (index: number) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Render field based on type
  const renderField = (field: UIFieldConfig, item: any, index: number) => {
    const value = getFieldValue(item, field.fieldPath);
    const isDisabled = readOnly || field.isReadOnly;

    switch (field.fieldType) {
      case "number":
        return (
          <Input
            type="number"
            value={value || 0}
            onChange={(e) => setFieldValue(index, field.fieldPath, parseFloat(e.target.value) || 0)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="text-xs"
            step="0.01"
          />
        );

      case "dropdown":
      case "lookup":
        return (
          <DropdownField
            field={field}
            value={value}
            onChange={(newValue) => setFieldValue(index, field.fieldPath, newValue)}
            disabled={isDisabled}
            masterDataCache={masterDataCache}
            fetchMasterData={fetchMasterData}
          />
        );

      case "text":
      default:
        return (
          <Input
            value={value || ""}
            onChange={(e) => setFieldValue(index, field.fieldPath, e.target.value)}
            placeholder={field.placeholder || ""}
            disabled={isDisabled}
            className="text-xs"
          />
        );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink">
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
        {!readOnly && (
          <Button size="sm" variant="secondary" onClick={addItem}>
            <Plus className="w-3 h-3 mr-1" />
            Add Line Item
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-surface-muted rounded-lg p-4 text-center text-xs text-ink-muted">
          <p>No line items added yet.</p>
          <p className="mt-1 text-[10px]">
            Click "Add Line Item" to add items to this declaration.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="border border-border rounded-lg overflow-hidden">
              {/* Item Header */}
              <div
                className="flex items-center justify-between bg-surface-muted px-4 py-2 cursor-pointer hover:bg-surface-hover transition-colors"
                onClick={() => toggleExpanded(index)}
              >
                <div className="flex items-center gap-3">
                  {expandedItems.has(index) ? (
                    <ChevronUp className="w-4 h-4 text-ink-muted" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-ink-muted" />
                  )}
                  <span className="text-xs font-medium text-ink">
                    Line {item.lineNumber}: {item.description || "(No description)"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {item.hsCode6 && (
                    <span className="text-xs text-ink-muted font-mono">
                      HS: {item.hsCode6}
                    </span>
                  )}
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(index);
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Item Fields */}
              {expandedItems.has(index) && (
                <div className="p-4 bg-white space-y-3">
                  <div className="grid grid-cols-12 gap-3">
                    {sortedFields.map((field) => (
                      <div
                        key={field.id}
                        className={`col-span-12 md:col-span-${field.gridColumn}`}
                        style={{ gridColumn: `span ${field.gridColumn} / span ${field.gridColumn}` }}
                      >
                        <label className="text-[10px] text-ink-muted">
                          {field.fieldLabel}
                          {field.isRequired && <span className="text-red-600 ml-1">*</span>}
                        </label>
                        {renderField(field, item, index)}
                        {field.helpText && (
                          <p className="text-[9px] text-ink-muted mt-0.5">{field.helpText}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Dropdown/Lookup field component
function DropdownField({
  field,
  value,
  onChange,
  disabled,
  masterDataCache,
  fetchMasterData,
}: {
  field: UIFieldConfig;
  value: any;
  onChange: (value: any) => void;
  disabled: boolean;
  masterDataCache: Record<string, MasterDataOption[]>;
  fetchMasterData: (sourceName: string) => Promise<MasterDataOption[]>;
}) {
  const [options, setOptions] = useState<MasterDataOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (field.masterDataSource) {
      // Check cache first
      if (masterDataCache[field.masterDataSource]) {
        setOptions(masterDataCache[field.masterDataSource]);
      } else {
        setLoading(true);
        fetchMasterData(field.masterDataSource)
          .then(setOptions)
          .finally(() => setLoading(false));
      }
    }
  }, [field.masterDataSource, masterDataCache, fetchMasterData]);

  if (loading) {
    return <Input value="Loading..." disabled className="text-xs" />;
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
