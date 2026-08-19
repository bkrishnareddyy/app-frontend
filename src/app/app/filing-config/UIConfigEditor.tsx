/**
 * UI Configuration Editor Page (Refactored)
 * 
 * Enhanced split-screen interface for configuring comprehensive UI behavior.
 * Left: Schema tree viewer
 * Right: Field configuration panel with full property support
 * 
 * Features:
 * - Full FilingUIConfigData structure support
 * - Real-time validation with error display
 * - Type-safe config builders
 * - Tabs, sections, panels management (foundation ready)
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { ArrowLeft, Plus, Save, X, Eye, AlertCircle, AlertTriangle, CheckCircle, Layout, Layers } from "lucide-react";
import SchemaTreeViewer from "./SchemaTreeViewer";
import FieldConfigPanel from "./FieldConfigPanel";
import ComplexObjectConfigPanel from "./ComplexObjectConfigPanel";
import TabManager from "./TabManager";
import LayoutRenderer from "@/components/form/layouts/LayoutRenderer";

// Import UI Config types and utilities
import type { FilingUIConfigData, FieldConfig, LayoutMode } from "@/types/ui-config.types";
import {
  createEmptyConfig,
  addSection,
  addField,
  updateField,
  getField
} from "@/lib/ui-config/config-builder";
import {
  validateConfig,
  getValidationSummary,
  type ValidationError
} from "@/lib/ui-config/config-validator";

// Add animation styles
const styles = `
  @keyframes slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  .animate-slide-in {
    animation: slide-in 0.3s ease-out;
  }
`;

interface ConfigSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (country: string, procedureCode: string, messageName: string, messageType: string, schemaVersion: string) => void;
}

function ConfigSelectorModal({ isOpen, onClose, onSelect }: ConfigSelectorModalProps) {
  const [country, setCountry] = useState("NL");
  const [procedureCode, setProcedureCode] = useState("H1");
  const [messageName, setMessageName] = useState("IE501");
  const [messageType, setMessageType] = useState("request");
  const [schemaVersion, setSchemaVersion] = useState("1.0.0");

  const handleSubmit = () => {
    if (country && procedureCode && messageName && messageType && schemaVersion) {
      onSelect(country, procedureCode, messageName, messageType, schemaVersion);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="config-selector">
      <ModalHeader titleId="config-selector">
        <h2 className="text-lg font-bold text-ink">Select Configuration Target</h2>
        <p className="text-xs text-ink-muted mt-1">
          Choose the country, procedure, and message to configure
        </p>
      </ModalHeader>

      <ModalBody>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink">Country <span className="text-red-600">*</span></label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              placeholder="e.g., NL, IE, FR"
              maxLength={2}
              className="text-xs mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink">Procedure Code <span className="text-red-600">*</span></label>
            <Input
              value={procedureCode}
              onChange={(e) => setProcedureCode(e.target.value.toUpperCase())}
              placeholder="e.g., H1, H4, H7"
              className="text-xs mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink">Message Name <span className="text-xs font-medium text-ink">*</span></label>
            <Input
              value={messageName}
              onChange={(e) => setMessageName(e.target.value.toUpperCase())}
              placeholder="e.g., IE501, IE503, IE015"
              className="text-xs mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink">Message Type <span className="text-red-600">*</span></label>
            <select
              value={messageType}
              onChange={(e) => setMessageType(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="request">Request</option>
              <option value="response">Response</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-ink">Schema Version <span className="text-red-600">*</span></label>
            <Input
              value={schemaVersion}
              onChange={(e) => setSchemaVersion(e.target.value)}
              placeholder="e.g., 1.0.0"
              className="text-xs mt-1"
            />
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button 
          variant="primary" 
          size="sm" 
          onClick={handleSubmit}
          disabled={!country || !procedureCode || !messageName || !messageType || !schemaVersion}
        >
          Continue
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface UIConfigEditorProps {
  configId?: string;
  onBack: () => void;
}

export default function UIConfigEditor({ configId, onBack }: UIConfigEditorProps) {
  // Configuration target state
  const [country, setCountry] = useState<string>("");
  const [procedureCode, setProcedureCode] = useState<string>("");
  const [messageName, setMessageName] = useState<string>("");
  const [messageType, setMessageType] = useState<string>("");
  const [schemaVersion, setSchemaVersion] = useState<string>("");
  const [showSelectorModal, setShowSelectorModal] = useState(!configId);
  
  // UI Config data state (NEW: FilingUIConfigData structure)
  const [config, setConfig] = useState<FilingUIConfigData | null>(null);
  const [originalConfig, setOriginalConfig] = useState<FilingUIConfigData | null>(null);
  const [isActive, setIsActive] = useState(true);
  
  // Validation state (NEW)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<ValidationError[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  
  // Schema state
  const [schema, setSchema] = useState<any>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<any>(null);
  
  // UI state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    show: boolean;
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showStructureManager, setShowStructureManager] = useState(false);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);

  // Load existing config or create new
  useEffect(() => {
    if (configId) {
      loadExistingConfig();
    } else if (country && procedureCode && messageName && messageType) {
      initializeNewConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, country, procedureCode, messageName, messageType]);

  // Load schema when target is selected
  useEffect(() => {
    if (country && procedureCode && messageName && messageType && schemaVersion) {
      loadSchema();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, procedureCode, messageName, messageType, schemaVersion]);

  // Track unsaved changes
  useEffect(() => {
    if (config && originalConfig) {
      const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig);
      setHasUnsavedChanges(hasChanges);
    }
  }, [config, originalConfig]);

  // Run validation when config changes
  useEffect(() => {
    if (config) {
      runValidation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const loadExistingConfig = async () => {
    try {
      const response = await fetch(`/api/filing-config/ui-configuration/${configId}`);
      if (!response.ok) throw new Error("Failed to load configuration");
      
      const data = await response.json();
      
      // Set target info
      setCountry(data.country);
      setProcedureCode(data.procedureCode);
      setMessageName(data.messageName);
      setMessageType(data.messageType);
      // Fix version: database has integer 1, but folder is "1.0.0"
      const versionStr = data.version?.toString() || "1";
      const normalizedVersion = versionStr.includes('.') ? versionStr : `${versionStr}.0.0`;
      setSchemaVersion(normalizedVersion);
      setIsActive(data.isActive ?? true);
      
      // Set config data (handle both new and legacy formats)
      let configData: FilingUIConfigData;
      
      if (data.configData?.version) {
        // New format - already FilingUIConfigData
        configData = data.configData;
      } else {
        // Legacy format or empty - convert
        configData = createEmptyConfig({
          country: data.country,
          procedure: data.procedureCode,
          message: data.messageName,
          layoutMode: 'single-page'
        });
        
        // Migrate legacy fields if they exist
        if (data.configData?.fields && Array.isArray(data.configData.fields)) {
          // Create a default section for legacy fields
          // addSection mutates in place (returns void)
          addSection(configData, {
            sectionId: 'default-section',
            title: 'Form Fields',
            description: 'Migrated from legacy configuration',
            layout: 'grid', // Changed from layoutMode
            sectionOrder: 0, // Changed from displayOrder
            isCollapsible: false,
            defaultExpanded: true
          });
          
          // Add each legacy field
          data.configData.fields.forEach((legacyField: any, index: number) => {
            // addField mutates in place (returns void)
            addField(configData, {
              fieldPath: legacyField.fieldPath,
              fieldLabel: legacyField.fieldLabel || legacyField.fieldPath,
              fieldType: legacyField.fieldType || 'text',
              section: 'default-section', // Changed from sectionId
              displayOrder: index,
              isVisible: legacyField.isVisible ?? false,
              isRequired: legacyField.isRequired ?? false,
              isReadOnly: legacyField.isReadOnly ?? false,
              placeholder: legacyField.placeholder,
              helpText: legacyField.helpText
            });
          });
        }
      }
      
      setConfig(configData);
      setOriginalConfig(JSON.parse(JSON.stringify(configData))); // Deep clone
    } catch (error) {
      console.error("Error loading config:", error);
      setSaveStatus({
        show: true,
        type: "error",
        message: "Failed to load configuration"
      });
    }
  };

  const initializeNewConfig = () => {
    const newConfig = createEmptyConfig({
      country,
      procedure: procedureCode,
      message: messageName,
      layoutMode: 'single-page', // Default layout
      tags: [messageType]
    });
    
    setConfig(newConfig);
    setOriginalConfig(JSON.parse(JSON.stringify(newConfig)));
  };

  const loadSchema = async () => {
    // Validate all required params before attempting to load
    if (!country || !procedureCode || !messageName || !messageType || !schemaVersion) {
      console.warn('⚠️ Schema load skipped - missing params:', { 
        country, procedureCode, messageName, messageType, schemaVersion 
      });
      return;
    }

    setSchemaLoading(true);
    setSchemaError(null);
    
    try {
      const url = `/api/schemas/${country}/${procedureCode}/${messageName}/${messageType}?version=${schemaVersion}`;
      console.log('🔍 Loading schema from:', url);
      console.log('📋 All params:', { country, procedureCode, messageName, messageType, schemaVersion });
      
      const response = await fetch(url);
      
      console.log('📡 Response:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Schema API error response:', errorData);
        throw new Error(`Failed to load schema: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('✅ Schema loaded successfully');
      setSchema(data.schema);
      setSchemaError(null);
    } catch (error: any) {
      console.error("❌ Error loading schema:", error);
      const errorMessage = error.message || "Failed to load schema. Please check your configuration.";
      setSchemaError(errorMessage);
      setSaveStatus({
        show: true,
        type: "error",
        message: errorMessage
      });
      // Set an empty schema so UI can still render
      setSchema({});
    } finally {
      setSchemaLoading(false);
    }
  };

  const runValidation = () => {
    if (!config) return;
    
    const result = validateConfig(config);
    setValidationErrors(result.errors);
    setValidationWarnings(result.warnings);
  };

  const handleSelectTarget = (
    newCountry: string,
    newProcedureCode: string,
    newMessageName: string,
    newMessageType: string,
    newSchemaVersion: string
  ) => {
    setCountry(newCountry);
    setProcedureCode(newProcedureCode);
    setMessageName(newMessageName);
    setMessageType(newMessageType);
    setSchemaVersion(newSchemaVersion);
    setShowSelectorModal(false);
  };

  const handleSelectField = useCallback((path: string, fieldSchema: any) => {
    console.log('🔍 handleSelectField called:', { path, fieldSchema });
    setSelectedPath(path);
    setSelectedSchema(fieldSchema);
  }, []);

  const handleFieldConfigChange = (fieldPath: string, fieldConfig: Partial<FieldConfig>) => {
    if (!config) return;
    
    const existingField = getField(config, fieldPath);
    
    if (existingField) {
      // Update existing field - updateField mutates in place
      const updatedConfig = JSON.parse(JSON.stringify(config)); // Deep clone
      updateField(updatedConfig, fieldPath, fieldConfig);
      setConfig(updatedConfig);
    } else {
      // Add new field to default section
      const updatedConfig = JSON.parse(JSON.stringify(config)); // Deep clone
      
      // Ensure default section exists
      if (!updatedConfig.sections || updatedConfig.sections.length === 0) {
        // Initialize sections array if undefined
        if (!updatedConfig.sections) {
          updatedConfig.sections = [];
        }
        
        // addSection mutates in place (returns void)
        addSection(updatedConfig, {
          sectionId: 'default-section',
          title: 'Form Fields',
          layout: 'grid', // Changed from layoutMode
          sectionOrder: 0, // Changed from displayOrder
          isCollapsible: false,
          defaultExpanded: true
        });
      }
      
      const defaultSectionId = updatedConfig.sections[0].sectionId;
      
      // addField mutates in place (returns void)
      addField(updatedConfig, {
        fieldPath,
        fieldLabel: fieldConfig.fieldLabel || fieldPath,
        fieldType: fieldConfig.fieldType || 'text',
        section: defaultSectionId, // Changed from sectionId
        displayOrder: updatedConfig.fields.length,
        isVisible: fieldConfig.isVisible ?? false,
        isRequired: fieldConfig.isRequired ?? false,
        isReadOnly: fieldConfig.isReadOnly ?? false,
        placeholder: fieldConfig.placeholder,
        helpText: fieldConfig.helpText
      });
      
      setConfig(updatedConfig);
    }
  };

  const handleGenerateLayout = (fieldPath: string, fieldSchema: any, layoutType: 'panel' | 'tabsheet' | 'tab' | 'card') => {
    if (!config) return;

    console.log('Saving layout hint:', { fieldPath, layoutType });
    
    const updatedConfig = JSON.parse(JSON.stringify(config)); // Deep clone
    
    // Just store a simple hint - renderer will figure out the rest
    if (!updatedConfig.layoutHints) {
      updatedConfig.layoutHints = {};
    }
    
    updatedConfig.layoutHints[fieldPath] = layoutType;
    
    setConfig(updatedConfig);
    setHasUnsavedChanges(true);
  };

  const handleSaveAll = async () => {
    if (!config) return;
    
    // Run validation before saving
    const validationResult = validateConfig(config);
    
    if (validationResult.errors.length > 0) {
      setShowValidation(true);
      setSaveStatus({
        show: true,
        type: "error",
        message: `Cannot save: ${validationResult.errors.length} validation error(s) found`
      });
      setTimeout(() => setSaveStatus(null), 5000);
      return;
    }
    
    try {
      // Update metadata before saving
      const configToSave = {
        ...config,
        metadata: {
          ...config.metadata,
          lastModifiedBy: "current-user", // TODO: Get from auth context
          lastModifiedAt: new Date().toISOString()
        }
      };
      
      const payload = {
        country,
        procedureCode,
        messageName,
        messageType,
        configData: configToSave,
        isActive,
        version: parseInt(schemaVersion) || 1
      };

      const response = await fetch(
        configId
          ? `/api/filing-config/ui-configuration/${configId}`
          : "/api/filing-config/ui-configuration",
        {
          method: configId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save configuration");
      }

      await response.json();

      // Update state with saved config
      setOriginalConfig(JSON.parse(JSON.stringify(configToSave)));
      setHasUnsavedChanges(false);
      
      setSaveStatus({
        show: true,
        type: "success",
        message: `Successfully saved ${config.fields.length} field configuration(s)`
      });
      
      setTimeout(() => setSaveStatus(null), 5000);
    } catch (error: any) {
      console.error("Error saving configurations:", error);
      setSaveStatus({
        show: true,
        type: "error",
        message: error.message || "Failed to save configurations"
      });
      setTimeout(() => setSaveStatus(null), 5000);
    }
  };

  const handleCancel = () => {
    setSelectedPath(null);
    setSelectedSchema(null);
  };

  // Get current field config for selected path
  const getCurrentFieldConfig = (): FieldConfig | undefined => {
    if (!config || !selectedPath) return undefined;
    return getField(config, selectedPath);
  };

  // Compute stats for header
  const configStats = config ? {
    fieldCount: config.fields.length,
    sectionCount: config.sections.length,
    tabCount: config.tabs?.length || 0,
    layoutMode: config.layout.mode,
    hasErrors: validationErrors.length > 0,
    hasWarnings: validationWarnings.length > 0
  } : null;

  if (!country || !procedureCode || !messageName || !messageType || !schemaVersion) {
    return (
      <ConfigSelectorModal
        isOpen={showSelectorModal}
        onClose={onBack}
        onSelect={handleSelectTarget}
      />
    );
  }

  if (schemaLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-sm text-ink-muted mb-2">Loading schema...</div>
          <div className="text-xs text-ink-muted">
            {country}/{procedureCode}/{messageName}/{messageType}
          </div>
        </div>
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md p-6">
          <div className="text-red-600 mb-4">
            <AlertCircle className="w-12 h-12 mx-auto mb-2" />
            <h3 className="text-lg font-bold">Schema Load Error</h3>
          </div>
          <p className="text-sm text-ink-muted mb-4">{schemaError}</p>
          <div className="space-y-2">
            <Button onClick={() => loadSchema()} variant="primary" size="sm">
              Retry
            </Button>
            <Button onClick={onBack} variant="ghost" size="sm">
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-sm text-ink-muted">Loading schema...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <style>{styles}</style>
      
      {/* Success/Error Notification */}
      {saveStatus?.show && (
        <div
          className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-lg shadow-lg border animate-slide-in ${
            saveStatus.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${saveStatus.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-semibold">{saveStatus.message}</span>
            <button
              onClick={() => setSaveStatus(null)}
              className="ml-4 text-lg font-bold opacity-50 hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Validation Banner */}
      {(validationErrors.length > 0 || validationWarnings.length > 0) && (
        <div className={`px-6 py-3 border-b ${validationErrors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {validationErrors.length > 0 ? (
                <AlertCircle className="w-5 h-5 text-red-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              )}
              <div>
                <div className="text-sm font-semibold text-ink">
                  {validationErrors.length > 0 
                    ? `${validationErrors.length} Validation Error(s)` 
                    : `${validationWarnings.length} Warning(s)`}
                </div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {getValidationSummary(validationErrors, validationWarnings)}
                </div>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setShowValidation(!showValidation)}
            >
              {showValidation ? 'Hide Details' : 'Show Details'}
            </Button>
          </div>
          
          {/* Validation Details */}
          {showValidation && (
            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
              {validationErrors.map((error, idx) => (
                <div key={idx} className="text-xs bg-white border border-red-200 rounded px-3 py-2">
                  <span className="font-semibold text-red-700">[{error.category}]</span>{' '}
                  <span className="text-ink">{error.message}</span>
                  {error.path && <span className="text-ink-muted ml-2">at {error.path}</span>}
                </div>
              ))}
              {validationWarnings.map((warning, idx) => (
                <div key={idx} className="text-xs bg-white border border-yellow-200 rounded px-3 py-2">
                  <span className="font-semibold text-yellow-700">[{warning.category}]</span>{' '}
                  <span className="text-ink">{warning.message}</span>
                  {warning.path && <span className="text-ink-muted ml-2">at {warning.path}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <Button onClick={onBack} variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-lg font-bold text-ink">UI Configuration Editor</h1>
              <p className="text-xs text-ink-muted mt-0.5">
                {configId ? "Editing existing configuration" : "Creating new configuration"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Unsaved changes indicator */}
            {hasUnsavedChanges && (
              <span className="text-xs text-orange-600 font-semibold">
                • Unsaved changes
              </span>
            )}
            
            {/* Config Stats */}
            {configStats && (
              <div className="flex items-center gap-4 text-xs text-ink-muted">
                <span className="font-medium">
                  {configStats.fieldCount} field{configStats.fieldCount !== 1 ? 's' : ''}
                </span>
                <span className="font-medium">
                  {configStats.sectionCount} section{configStats.sectionCount !== 1 ? 's' : ''}
                </span>
                {configStats.tabCount > 0 && (
                  <span className="font-medium">
                    {configStats.tabCount} tab{configStats.tabCount !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="px-2 py-1 bg-gray-100 rounded text-xs font-semibold">
                  {configStats.layoutMode}
                </span>
                {configStats.hasErrors && (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertCircle className="w-3 h-3" />
                    Errors
                  </span>
                )}
                {configStats.hasWarnings && !configStats.hasErrors && (
                  <span className="flex items-center gap-1 text-yellow-600">
                    <AlertTriangle className="w-3 h-3" />
                    Warnings
                  </span>
                )}
              </div>
            )}
            
            {/* Reset Button */}
            <Button
              onClick={() => {
                if (confirm('Reset configuration to empty state? This will clear all tabs, sections, and fields.')) {
                  const resetConfig = createEmptyConfig({
                    country,
                    procedure: procedureCode,
                    message: messageName,
                    layoutMode: 'single-page'
                  });
                  setConfig(resetConfig);
                  setHasUnsavedChanges(true);
                }
              }}
              variant="danger"
              size="sm"
            >
              <X className="w-4 h-4 mr-2" />
              Reset
            </Button>
            
            {/* Active/Inactive Toggle */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-ink-muted">Status:</label>
              <button
                onClick={() => setIsActive(!isActive)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  isActive 
                    ? "bg-green-100 text-green-700 border border-green-300" 
                    : "bg-gray-100 text-gray-600 border border-gray-300"
                }`}
              >
                {isActive ? "Active" : "Inactive"}
              </button>
            </div>
            
            {/* Preview Button */}
            <Button
              onClick={() => setShowPreview(true)}
              variant="secondary"
              size="sm"
              disabled={!config}
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
            
            {/* Save Button */}
            <Button
              onClick={handleSaveAll}
              variant="primary"
              size="sm"
              disabled={!hasUnsavedChanges || validationErrors.length > 0}
            >
              <Save className="w-4 h-4 mr-2" />
              Save All
            </Button>
          </div>
        </div>

        {/* Target Info */}
        <div className="flex items-center gap-6 text-xs text-ink-muted">
          <span><strong>Country:</strong> {country}</span>
          <span><strong>Procedure:</strong> {procedureCode}</span>
          <span><strong>Message:</strong> {messageName}</span>
          <span><strong>Type:</strong> {messageType}</span>
          <span><strong>Version:</strong> {schemaVersion}</span>
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Schema Tree */}
        <div className="w-1/2 border-r border-border overflow-auto bg-gray-50">
          <SchemaTreeViewer
            schema={schema}
            onSelectPath={handleSelectField}
            selectedPath={selectedPath}
          />
        </div>

        {/* Right Panel - Field/Complex Object Config */}
        <div className="w-1/2 overflow-auto bg-white">
          {(() => {
            console.log('🎯 Right Panel State:', { selectedPath, selectedSchema: !!selectedSchema });
            return selectedPath && selectedSchema;
          })() ? (
            (() => {
              // Check if this is a complex object or leaf field
              const hasProperties = selectedSchema.properties && Object.keys(selectedSchema.properties).length > 0;
              const hasItems = selectedSchema.items !== undefined;
              const isObjectType = selectedSchema.type === 'object';
              const isArrayType = selectedSchema.type === 'array';
              
              const isComplexObject = hasProperties || hasItems || isObjectType || isArrayType;
              
              // Debug logging
              console.log('Selected:', {
                path: selectedPath,
                schema: selectedSchema,
                hasProperties,
                hasItems,
                isObjectType,
                isArrayType,
                isComplexObject
              });
              
              if (isComplexObject) {
                // Show Complex Object Config Panel
                return (
                  <ComplexObjectConfigPanel
                    fieldPath={selectedPath!}
                    fieldSchema={selectedSchema}
                    onSave={(layoutType) => handleGenerateLayout(selectedPath!, selectedSchema, layoutType)}
                    onCancel={handleCancel}
                  />
                );
              } else {
                // Show Field Config Panel
                return (
                  <FieldConfigPanel
                    fieldPath={selectedPath!}
                    fieldSchema={selectedSchema}
                    currentConfig={getCurrentFieldConfig()}
                    onConfigChange={(newConfig) => handleFieldConfigChange(selectedPath!, newConfig)}
                    onCancel={handleCancel}
                  />
                );
              }
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <Plus className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-sm font-bold text-ink mb-2">Nothing Selected</h3>
              <p className="text-xs text-ink-muted max-w-sm">
                Select from the schema tree:
              </p>
              <div className="mt-4 space-y-2 text-xs text-ink-muted">
                <p>📁 <strong>Complex Object</strong> → Configure layout (Panel, TabSheet, Tab, Card)</p>
                <p>📄 <strong>Leaf Field</strong> → Configure field properties</p>
              </div>
              {config && config.fields.length > 0 && (
                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <CheckCircle className="w-4 h-4 inline mr-1" />
                    {config.fields.length} field{config.fields.length !== 1 ? 's' : ''} configured
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Structure Manager Modal */}
      {showStructureManager && config && (
        <Modal isOpen={showStructureManager} onClose={() => setShowStructureManager(false)} size="xl">
          <ModalHeader onClose={() => setShowStructureManager(false)}>
            <div className="flex items-center gap-3">
              <Layers className="w-6 h-6 text-brand" />
              <div>
                <h2 className="text-lg font-bold text-ink">Manage Tabs & Sections</h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Organize your form with tabs and sections
                </p>
              </div>
            </div>
          </ModalHeader>
          
          <ModalBody>
            <div className="space-y-6">
              {/* Layout Mode Switcher */}
              <div className="bg-surface-muted rounded-lg p-4 border border-border">
                <label className="block text-sm font-semibold text-ink mb-3">
                  <Layout className="w-4 h-4 inline mr-2" />
                  Layout Mode
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const updatedConfig = { ...config, layout: { ...config.layout, mode: 'single-page' as LayoutMode } };
                      setConfig(updatedConfig);
                    }}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      config.layout.mode === 'single-page'
                        ? 'border-brand bg-blue-50 text-brand font-semibold'
                        : 'border-border bg-white text-ink-muted hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-medium">Single Page</div>
                    <div className="text-[10px] mt-1">All fields on one page</div>
                  </button>
                  <button
                    onClick={() => {
                      const updatedConfig = { 
                        ...config, 
                        layout: { ...config.layout, mode: 'tabs' as LayoutMode },
                        tabs: config.tabs || []
                      };
                      setConfig(updatedConfig);
                    }}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      config.layout.mode === 'tabs'
                        ? 'border-brand bg-blue-50 text-brand font-semibold'
                        : 'border-border bg-white text-ink-muted hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-medium">Tabs</div>
                    <div className="text-[10px] mt-1">Organize with tabs</div>
                  </button>
                </div>
              </div>

              {/* Tab Manager (shown only if tabs mode) */}
              {config.layout.mode === 'tabs' && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <TabManager
                    config={config}
                    onChange={(updatedConfig) => setConfig(updatedConfig)}
                    onSelectTab={(tabId) => setSelectedTabId(tabId)}
                    selectedTabId={selectedTabId}
                  />
                </div>
              )}

              {/* Single Page Info */}
              {config.layout.mode === 'single-page' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-blue-600 text-xl">ℹ️</div>
                    <div>
                      <h4 className="text-sm font-semibold text-blue-900">Single Page Layout</h4>
                      <p className="text-xs text-blue-700 mt-1">
                        All fields will be displayed on a single scrollable page.
                        Fields are organized by sections. Add fields by selecting them from the schema tree.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ModalBody>
          
          <ModalFooter>
            <Button onClick={() => setShowStructureManager(false)} variant="primary">
              Done
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Preview Modal */}
      {showPreview && config && (
        <Modal isOpen={showPreview} onClose={() => setShowPreview(false)} size="xl" titleId="preview-modal">
          <ModalHeader 
            titleId="preview-modal" 
            title="Form Preview" 
            subtitle="This is how the Declaration tab will look with your configuration"
            icon={<Eye className="w-5 h-5" />}
            onClose={() => setShowPreview(false)}
          />
          
          <ModalBody>
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <LayoutRenderer
                  config={config}
                  formData={{}}
                  onChange={(path: string, value: any) => {
                    console.log('Preview field change:', path, value);
                  }}
                  errors={{}}
                />
              </div>
            </div>
            
            {/* Empty State */}
            {(!config.fields || config.fields.filter((f: any) => f.isVisible !== false).length === 0) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center mt-4">
                <p className="text-sm text-gray-600">No visible fields configured yet</p>
                <p className="text-xs text-gray-500 mt-2">Select fields and check "Visible" to include them in the form</p>
              </div>
            )}

            {/* Full JSON */}
            <details className="mt-4">
              <summary className="text-sm font-semibold text-ink cursor-pointer hover:text-brand">
                View Full Configuration JSON
              </summary>
              <pre className="mt-2 bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-64">
                {JSON.stringify(config, null, 2)}
              </pre>
            </details>
          </ModalBody>
          
          <ModalFooter>
            <Button onClick={() => setShowPreview(false)} variant="primary">
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
