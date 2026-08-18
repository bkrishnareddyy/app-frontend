/**
 * Enhanced Field Configuration Panel
 * 
 * Comprehensive field property editor with:
 * - Basic properties (label, type, visibility)
 * - Validation rules (required, pattern, minLength, custom)
 * - Conditional logic (showWhen, hideWhen, enableWhen)
 * - Data sources (dropdowns, API endpoints)
 * - Translations (multi-language support)
 * - Hooks (onChange, onLoad, onBlur)
 * - Grid config (for array fields)
 * - RBAC permissions
 */

"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Save, X, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { FieldConfig } from "@/types/ui-config.types";

interface FieldConfigPanelProps {
  fieldPath: string;
  fieldSchema: any;
  currentConfig?: FieldConfig;
  onConfigChange: (config: Partial<FieldConfig>) => void;
  onCancel: () => void;
}

type TabId = 'basic' | 'validation' | 'conditional' | 'datasource' | 'translations' | 'hooks' | 'permissions';

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "time", label: "Time" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-Select" },
  { value: "lookup", label: "Lookup" },
  { value: "autocomplete", label: "Autocomplete" },
  { value: "file", label: "File Upload" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
];

export default function FieldConfigPanel({
  fieldPath,
  fieldSchema,
  currentConfig,
  onConfigChange,
  onCancel
}: FieldConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [config, setConfig] = useState<Partial<FieldConfig>>({
    fieldPath,
    fieldLabel: currentConfig?.fieldLabel || fieldPath.split('.').pop() || '',
    fieldType: currentConfig?.fieldType || 'text',
    section: currentConfig?.section || 'default-section', // Changed from sectionId
    displayOrder: currentConfig?.displayOrder || 0,
    isVisible: currentConfig?.isVisible ?? false, // Default to false
    isRequired: currentConfig?.isRequired ?? false,
    isReadOnly: currentConfig?.isReadOnly ?? false,
    ...currentConfig
  });

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic-props']));

  // Reset state when fieldPath or currentConfig changes
  useEffect(() => {
    setConfig({
      fieldPath,
      fieldLabel: currentConfig?.fieldLabel || fieldPath.split('.').pop() || '',
      fieldType: currentConfig?.fieldType || 'text',
      section: currentConfig?.section || 'default-section',
      displayOrder: currentConfig?.displayOrder || 0,
      isVisible: currentConfig?.isVisible ?? false, // Default to false
      isRequired: currentConfig?.isRequired ?? false,
      isReadOnly: currentConfig?.isReadOnly ?? false,
      ...currentConfig
    });
    // Reset to basic tab when field changes
    setActiveTab('basic');
  }, [fieldPath, currentConfig]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const updateConfig = (updates: Partial<FieldConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'basic', label: 'Basic' },
    { id: 'validation', label: 'Validation' },
    { id: 'conditional', label: 'Conditional' },
    { id: 'datasource', label: 'Data Source' },
    { id: 'translations', label: 'Translations' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'permissions', label: 'Permissions' },
  ];

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-ink">Field Configuration</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-ink-muted font-mono truncate">{fieldPath}</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border bg-gray-50 px-4">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-gray-300'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'basic' && (
          <div className="space-y-4">
            {/* Basic Properties */}
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Field Label <span className="text-red-600">*</span>
              </label>
              <Input
                value={config.fieldLabel || ''}
                onChange={(e) => updateConfig({ fieldLabel: e.target.value })}
                placeholder="Display label for the field"
                className="text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Field Type <span className="text-red-600">*</span>
              </label>
              <select
                value={config.fieldType || 'text'}
                onChange={(e) => updateConfig({ fieldType: e.target.value as any })}
                className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {FIELD_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Display Order</label>
                <Input
                  type="number"
                  value={config.displayOrder || 0}
                  onChange={(e) => updateConfig({ displayOrder: parseInt(e.target.value) || 0 })}
                  className="text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Grid Column</label>
                <select
                  value={config.gridColumn || 6}
                  onChange={(e) => updateConfig({ gridColumn: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 text-xs border border-border rounded-md"
                >
                  <option value="3">3 (25%)</option>
                  <option value="4">4 (33%)</option>
                  <option value="6">6 (50%)</option>
                  <option value="8">8 (66%)</option>
                  <option value="12">12 (100%)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Placeholder</label>
              <Input
                value={config.placeholder || ''}
                onChange={(e) => updateConfig({ placeholder: e.target.value })}
                placeholder="Placeholder text..."
                className="text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Help Text</label>
              <textarea
                value={config.helpText || ''}
                onChange={(e) => updateConfig({ helpText: e.target.value })}
                placeholder="Help text to guide users..."
                className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Default Value</label>
              <Input
                value={config.defaultValue || ''}
                onChange={(e) => updateConfig({ defaultValue: e.target.value })}
                placeholder="Default value for the field"
                className="text-xs"
              />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.isVisible ?? false}
                  onChange={(e) => updateConfig({ isVisible: e.target.checked })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Visible</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.isRequired ?? false}
                  onChange={(e) => updateConfig({ isRequired: e.target.checked })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Required</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.isReadOnly ?? false}
                  onChange={(e) => updateConfig({ isReadOnly: e.target.checked })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Read Only</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Configure validation rules for this field
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Min Length</label>
                <Input
                  type="number"
                  value={config.validation?.minLength || ''}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, minLength: parseInt(e.target.value) || undefined }
                  })}
                  placeholder="Minimum length"
                  className="text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Max Length</label>
                <Input
                  type="number"
                  value={config.validation?.maxLength || ''}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, maxLength: parseInt(e.target.value) || undefined }
                  })}
                  placeholder="Maximum length"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Min Value</label>
                <Input
                  type="number"
                  value={config.validation?.min || ''}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, min: parseFloat(e.target.value) || undefined }
                  })}
                  placeholder="Minimum value"
                  className="text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-ink block mb-1">Max Value</label>
                <Input
                  type="number"
                  value={config.validation?.max || ''}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, max: parseFloat(e.target.value) || undefined }
                  })}
                  placeholder="Maximum value"
                  className="text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Pattern (Regex)</label>
              <Input
                value={config.validation?.pattern || ''}
                onChange={(e) => updateConfig({ 
                  validation: { ...config.validation, pattern: e.target.value }
                })}
                placeholder="^[A-Z]{2}\d{4}$"
                className="text-xs font-mono"
              />
              <p className="text-xs text-ink-muted mt-1">Regular expression for validation</p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Custom Error Message</label>
              <Input
                value={config.validation?.message || ''}
                onChange={(e) => updateConfig({ 
                  validation: { ...config.validation, message: e.target.value }
                })}
                placeholder="Error message to display"
                className="text-xs"
              />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.validation?.email ?? false}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, email: e.target.checked || undefined }
                  })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Email format</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.validation?.url ?? false}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, url: e.target.checked || undefined }
                  })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">URL format</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.validation?.phone ?? false}
                  onChange={(e) => updateConfig({ 
                    validation: { ...config.validation, phone: e.target.checked || undefined }
                  })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Phone format</span>
              </label>
            </div>

            <div className="pt-2 border-t">
              <label className="text-xs font-medium text-ink block mb-1">Custom Validation Function</label>
              <textarea
                value={config.validation?.custom || ''}
                onChange={(e) => updateConfig({ 
                  validation: { ...config.validation, custom: e.target.value }
                })}
                placeholder="(value) => value.length > 5 || 'Must be longer than 5'"
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
              <p className="text-xs text-ink-muted mt-1">
                JavaScript function returning true or error message
              </p>
            </div>
          </div>
        )}

        {activeTab === 'conditional' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Control field visibility and behavior based on other field values
            </p>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Show When</label>
              <textarea
                value={config.showWhen || ''}
                onChange={(e) => updateConfig({ showWhen: e.target.value })}
                placeholder={'{"field": "transactionType", "equals": "import"}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
              <p className="text-xs text-ink-muted mt-1">
                JSON condition - field appears when condition is true
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Hide When</label>
              <textarea
                value={config.hideWhen || ''}
                onChange={(e) => updateConfig({ hideWhen: e.target.value })}
                placeholder={'{"field": "isExempt", "equals": true}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
              <p className="text-xs text-ink-muted mt-1">
                JSON condition - field hides when condition is true
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Enable When</label>
              <textarea
                value={config.enableWhen || ''}
                onChange={(e) => updateConfig({ enableWhen: e.target.value })}
                placeholder={'{"field": "canEdit", "equals": true}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
              <p className="text-xs text-ink-muted mt-1">
                JSON condition - field becomes editable when condition is true
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Disable When</label>
              <textarea
                value={config.disableWhen || ''}
                onChange={(e) => updateConfig({ disableWhen: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md"
                rows={3}
                placeholder={'{"field": "isLocked", "equals": true}'}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Required When</label>
              <textarea
                value={config.requiredWhen || ''}
                onChange={(e) => updateConfig({ requiredWhen: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md"
                rows={3}
                placeholder={'{"field": "procedureCode", "equals": "H1"}'}
              />
            </div>
          </div>
        )}

        {activeTab === 'datasource' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Configure data source for dropdowns, lookups, and autocomplete fields
            </p>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">Master Data Source</label>
              <Input
                value={config.masterDataSource || ''}
                onChange={(e) => updateConfig({ masterDataSource: e.target.value })}
                placeholder="e.g., countries, currencies, ports"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">
                Reference to master data table
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.isMultiSelect ?? false}
                  onChange={(e) => updateConfig({ isMultiSelect: e.target.checked })}
                  className="w-4 h-4 text-primary border-border rounded"
                />
                <span className="text-xs font-medium text-ink">Allow Multiple Selection</span>
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">API Data Source</label>
              <div className="space-y-2">
                <Input
                  value={config.dataSource?.apiEndpoint || ''}
                  onChange={(e) => updateConfig({ 
                    dataSource: { ...config.dataSource, apiEndpoint: e.target.value }
                  })}
                  placeholder="/api/master-data/countries"
                  className="text-xs"
                />
                <Input
                  value={config.dataSource?.valueField || ''}
                  onChange={(e) => updateConfig({ 
                    dataSource: { ...config.dataSource, valueField: e.target.value }
                  })}
                  placeholder="Value field (e.g., 'code')"
                  className="text-xs"
                />
                <Input
                  value={config.dataSource?.labelField || ''}
                  onChange={(e) => updateConfig({ 
                    dataSource: { ...config.dataSource, labelField: e.target.value }
                  })}
                  placeholder="Label field (e.g., 'name')"
                  className="text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Cascading Dependency</label>
              <Input
                value={config.dataSource?.dependsOn || ''}
                onChange={(e) => updateConfig({ 
                  dataSource: { ...config.dataSource, dependsOn: e.target.value }
                })}
                placeholder="Field path this depends on (e.g., 'country')"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">
                Field that triggers data refresh
              </p>
            </div>
          </div>
        )}

        {activeTab === 'translations' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Add translations for labels, placeholders, and help text
            </p>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Field Label Translations</label>
              <textarea
                value={JSON.stringify(config.translations?.label || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateConfig({ translations: { ...config.translations, label: parsed }});
                  } catch {}
                }}
                placeholder={'{\n  "en": "Country",\n  "nl": "Land",\n  "fr": "Pays"\n}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={5}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Placeholder Translations</label>
              <textarea
                value={JSON.stringify(config.translations?.placeholder || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateConfig({ translations: { ...config.translations, placeholder: parsed }});
                  } catch {}
                }}
                placeholder={'{\n  "en": "Select a country",\n  "nl": "Selecteer een land"\n}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md"
                rows={4}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Help Text Translations</label>
              <textarea
                value={JSON.stringify(config.translations?.helpText || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateConfig({ translations: { ...config.translations, helpText: parsed }});
                  } catch {}
                }}
                placeholder={'{\n  "en": "ISO 2-letter code",\n  "nl": "ISO 2-letter code"\n}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md"
                rows={4}
              />
            </div>
          </div>
        )}

        {activeTab === 'hooks' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Configure event hooks to trigger API calls or custom logic
            </p>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">On Load</label>
              <Input
                value={config.hooks?.onLoad || ''}
                onChange={(e) => updateConfig({ 
                  hooks: { ...config.hooks, onLoad: e.target.value }
                })}
                placeholder="/api/field-data/load?field=country"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">API endpoint called when field loads</p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">On Change</label>
              <Input
                value={config.hooks?.onChange || ''}
                onChange={(e) => updateConfig({ 
                  hooks: { ...config.hooks, onChange: e.target.value }
                })}
                placeholder="/api/field-data/changed?field=country"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">API endpoint called when value changes</p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">On Blur</label>
              <Input
                value={config.hooks?.onBlur || ''}
                onChange={(e) => updateConfig({ 
                  hooks: { ...config.hooks, onBlur: e.target.value }
                })}
                placeholder="/api/field-data/validate?field=country"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">API endpoint called when field loses focus</p>
            </div>

            <div>
              <label className="text-xs font-medium text-ink block mb-1">On Focus</label>
              <Input
                value={config.hooks?.onFocus || ''}
                onChange={(e) => updateConfig({ 
                  hooks: { ...config.hooks, onFocus: e.target.value }
                })}
                placeholder="/api/field-data/focus?field=country"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">API endpoint called when field gains focus</p>
            </div>
          </div>
        )}

        {activeTab === 'permissions' && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted mb-3">
              Control field visibility and editability by user role
            </p>

            <div>
              <label className="text-xs font-medium text-ink block mb-2">Permission Rules</label>
              <textarea
                value={JSON.stringify(config.permissions || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateConfig({ permissions: parsed });
                  } catch {}
                }}
                placeholder={'{\n  "admin": { "read": true, "write": true },\n  "operator": { "read": true, "write": false },\n  "viewer": { "read": true, "write": false }\n}'}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={8}
              />
              <p className="text-xs text-ink-muted mt-1">
                Define read/write/mask permissions per role
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="px-4 py-3 border-t border-border bg-gray-50 text-xs text-ink-muted">
        <div className="flex items-center justify-between">
          <div>
            Editing: <span className="font-mono font-semibold">{fieldPath}</span>
          </div>
          <div className="flex items-center gap-2">
            {config.isRequired && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded">Required</span>}
            {config.isReadOnly && <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded">Read-only</span>}
            {!config.isVisible && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">Hidden</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
