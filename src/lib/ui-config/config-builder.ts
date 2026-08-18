/**
 * UI Config Builder
 * 
 * Helper functions for creating and manipulating FilingUIConfigData structures.
 * Provides type-safe methods to build configurations programmatically.
 */

import {
  FilingUIConfigData,
  UITab,
  UISection,
  UIPanel,
  FieldConfig,
  LayoutMode,
} from '@/types/ui-config.types';

// ============================================================================
// EMPTY CONFIG CREATION
// ============================================================================

export interface CreateConfigOptions {
  country: string;
  procedure: string;
  message: string;
  title?: string;
  description?: string;
  layoutMode?: LayoutMode;
}

/**
 * Create an empty UI configuration with sensible defaults
 */
export function createEmptyConfig(options: CreateConfigOptions): FilingUIConfigData {
  const { country, procedure, message, title, description, layoutMode = 'single-page' } = options;
  
  const configTitle = title || `${country} ${procedure} ${message} Configuration`;
  
  return {
    version: '1.0.0',
    metadata: {
      title: configTitle,
      description: description || `UI configuration for ${country} ${procedure} ${message}`,
      tags: [country, procedure, message],
      lastModifiedAt: new Date().toISOString(),
    },
    layout: {
      mode: layoutMode,
      tabPosition: 'top',
      defaultColumns: 2,
    },
    tabs: layoutMode === 'tabs' ? [] : undefined,
    sections: [],
    panels: [],
    fields: [],
    validation: {
      crossFieldRules: [],
      strategy: {
        realTime: true,
        triggerOn: ['blur', 'change'],
        debounce: 300,
        onSubmit: true,
        stopOnFirstError: false,
        scrollToFirstError: true,
      },
    },
    conditionalLogic: {
      rules: [],
      debug: false,
    },
    translations: {
      locales: ['en'],
      defaultLocale: 'en',
    },
    permissions: {
      roles: {},
      defaultRole: 'operator',
    },
  };
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================

export interface AddTabOptions {
  tabId: string;
  label: string;
  icon?: string;
  tabOrder?: number;
  description?: string;
}

/**
 * Add a tab to the configuration
 */
export function addTab(config: FilingUIConfigData, options: AddTabOptions): void {
  if (!config.tabs) {
    config.tabs = [];
  }
  
  // Check for duplicate tabId
  if (config.tabs.some(tab => tab.tabId === options.tabId)) {
    throw new Error(`Tab with ID "${options.tabId}" already exists`);
  }
  
  const tab: UITab = {
    tabId: options.tabId,
    label: options.label,
    icon: options.icon,
    tabOrder: options.tabOrder ?? (config.tabs.length + 1) * 10,
    isVisible: true,
    sections: [],
    description: options.description,
  };
  
  config.tabs.push(tab);
  
  // Sort tabs by tabOrder
  config.tabs.sort((a, b) => a.tabOrder - b.tabOrder);
}

/**
 * Remove a tab from the configuration
 */
export function removeTab(config: FilingUIConfigData, tabId: string): void {
  if (!config.tabs) return;
  
  const index = config.tabs.findIndex(tab => tab.tabId === tabId);
  if (index === -1) {
    throw new Error(`Tab with ID "${tabId}" not found`);
  }
  
  // Remove the tab
  config.tabs.splice(index, 1);
  
  // Remove sections that belonged to this tab
  config.sections = config.sections.filter(section => {
    const tab = config.tabs?.find(t => t.sections.includes(section.sectionId));
    return tab?.tabId !== tabId;
  });
}

/**
 * Update an existing tab
 */
export function updateTab(
  config: FilingUIConfigData, 
  tabId: string, 
  updates: Partial<Pick<UITab, 'title' | 'description' | 'icon' | 'isVisible'>>
): FilingUIConfigData {
  if (!config.tabs) {
    throw new Error('No tabs in configuration');
  }
  
  const tabIndex = config.tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) {
    throw new Error(`Tab with ID "${tabId}" not found`);
  }
  
  // Create updated config with modified tab
  const updatedConfig = { ...config };
  updatedConfig.tabs = [...config.tabs];
  updatedConfig.tabs[tabIndex] = {
    ...config.tabs[tabIndex],
    ...updates
  };
  
  return updatedConfig;
}

/**
 * Link a section to a tab
 */
export function linkSectionToTab(config: FilingUIConfigData, sectionId: string, tabId: string): void {
  if (!config.tabs) {
    throw new Error('Configuration has no tabs');
  }
  
  const tab = config.tabs.find(t => t.tabId === tabId);
  if (!tab) {
    throw new Error(`Tab with ID "${tabId}" not found`);
  }
  
  const section = config.sections.find(s => s.sectionId === sectionId);
  if (!section) {
    throw new Error(`Section with ID "${sectionId}" not found`);
  }
  
  // Remove section from any other tabs
  config.tabs.forEach(t => {
    t.sections = t.sections.filter(s => s !== sectionId);
  });
  
  // Add to the specified tab
  if (!tab.sections.includes(sectionId)) {
    tab.sections.push(sectionId);
  }
}

// ============================================================================
// SECTION MANAGEMENT
// ============================================================================

export interface AddSectionOptions {
  sectionId: string;
  title: string;
  layout?: 'grid' | 'panels' | 'cards' | 'list';
  columns?: number;
  sectionOrder?: number;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  description?: string;
  tabId?: string;
}

/**
 * Add a section to the configuration
 */
export function addSection(config: FilingUIConfigData, options: AddSectionOptions): void {
  // Check for duplicate sectionId
  if (config.sections.some(section => section.sectionId === options.sectionId)) {
    throw new Error(`Section with ID "${options.sectionId}" already exists`);
  }
  
  const section: UISection = {
    sectionId: options.sectionId,
    title: options.title,
    sectionOrder: options.sectionOrder ?? (config.sections.length + 1) * 10,
    layout: options.layout ?? 'grid',
    columns: options.columns ?? 2,
    isVisible: true,
    isCollapsible: options.isCollapsible ?? false,
    defaultExpanded: options.defaultExpanded ?? true,
    fields: [],
    description: options.description,
  };
  
  config.sections.push(section);
  
  // Sort sections by sectionOrder
  config.sections.sort((a, b) => a.sectionOrder - b.sectionOrder);
  
  // Link to tab if specified
  if (options.tabId) {
    linkSectionToTab(config, options.sectionId, options.tabId);
  }
}

/**
 * Remove a section from the configuration
 */
export function removeSection(config: FilingUIConfigData, sectionId: string): void {
  const index = config.sections.findIndex(section => section.sectionId === sectionId);
  if (index === -1) {
    throw new Error(`Section with ID "${sectionId}" not found`);
  }
  
  // Remove the section
  config.sections.splice(index, 1);
  
  // Remove from any tabs
  config.tabs?.forEach(tab => {
    tab.sections = tab.sections.filter(s => s !== sectionId);
  });
  
  // Remove fields that belonged to this section
  config.fields = config.fields.filter(field => field.section !== sectionId);
  
  // Remove panels that belonged to this section
  if (config.panels) {
    config.panels = config.panels.filter(panel => panel.sectionId !== sectionId);
  }
}

// ============================================================================
// PANEL MANAGEMENT
// ============================================================================

export interface AddPanelOptions {
  panelId: string;
  sectionId: string;
  title: string;
  panelOrder?: number;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  borderStyle?: 'solid' | 'dashed' | 'none';
}

/**
 * Add a panel to the configuration
 */
export function addPanel(config: FilingUIConfigData, options: AddPanelOptions): void {
  if (!config.panels) {
    config.panels = [];
  }
  
  // Check for duplicate panelId
  if (config.panels.some(panel => panel.panelId === options.panelId)) {
    throw new Error(`Panel with ID "${options.panelId}" already exists`);
  }
  
  // Verify section exists
  const section = config.sections.find(s => s.sectionId === options.sectionId);
  if (!section) {
    throw new Error(`Section with ID "${options.sectionId}" not found`);
  }
  
  const panel: UIPanel = {
    panelId: options.panelId,
    sectionId: options.sectionId,
    title: options.title,
    panelOrder: options.panelOrder ?? (config.panels.filter(p => p.sectionId === options.sectionId).length + 1) * 10,
    isCollapsible: options.isCollapsible ?? true,
    defaultExpanded: options.defaultExpanded ?? true,
    borderStyle: options.borderStyle ?? 'solid',
    fields: [],
  };
  
  config.panels.push(panel);
  
  // Update section layout to panels if not already
  if (section.layout !== 'panels') {
    section.layout = 'panels';
  }
  
  // Add panel reference to section if not already there
  if (!section.panels) {
    section.panels = [];
  }
  if (!section.panels.includes(options.panelId)) {
    section.panels.push(options.panelId);
  }
  
  // Sort panels by panelOrder
  config.panels.sort((a, b) => a.panelOrder - b.panelOrder);
}

/**
 * Remove a panel from the configuration
 */
export function removePanel(config: FilingUIConfigData, panelId: string): void {
  if (!config.panels) return;
  
  const index = config.panels.findIndex(panel => panel.panelId === panelId);
  if (index === -1) {
    throw new Error(`Panel with ID "${panelId}" not found`);
  }
  
  const panel = config.panels[index];
  
  // Remove the panel
  config.panels.splice(index, 1);
  
  // Remove panel reference from section
  const section = config.sections.find(s => s.sectionId === panel.sectionId);
  if (section?.panels) {
    section.panels = section.panels.filter(p => p !== panelId);
  }
  
  // Unlink fields from this panel
  config.fields.forEach(field => {
    if (field.panelId === panelId) {
      field.panelId = undefined;
    }
  });
}

// ============================================================================
// FIELD MANAGEMENT
// ============================================================================

export interface AddFieldOptions {
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  section: string;
  panelId?: string;
  displayOrder?: number;
  gridColumn?: number;
  isRequired?: boolean;
  isReadOnly?: boolean;
  isVisible?: boolean;
  placeholder?: string;
  helpText?: string;
  isArrayField?: boolean;
}

/**
 * Add a field to the configuration
 */
export function addField(config: FilingUIConfigData, options: AddFieldOptions): void {
  // Check for duplicate fieldPath
  if (config.fields.some(field => field.fieldPath === options.fieldPath)) {
    throw new Error(`Field with path "${options.fieldPath}" already exists`);
  }
  
  // Verify section exists
  const section = config.sections.find(s => s.sectionId === options.section);
  if (!section) {
    throw new Error(`Section with ID "${options.section}" not found`);
  }
  
  // Verify panel exists if specified
  if (options.panelId) {
    const panel = config.panels?.find(p => p.panelId === options.panelId);
    if (!panel) {
      throw new Error(`Panel with ID "${options.panelId}" not found`);
    }
    if (panel.sectionId !== options.section) {
      throw new Error(`Panel "${options.panelId}" does not belong to section "${options.section}"`);
    }
  }
  
  const field: FieldConfig = {
    fieldPath: options.fieldPath,
    fieldLabel: options.fieldLabel,
    fieldType: options.fieldType as any,
    section: options.section,
    panelId: options.panelId,
    displayOrder: options.displayOrder ?? (config.fields.filter(f => f.section === options.section).length + 1) * 10,
    gridColumn: options.gridColumn ?? 6,
    isVisible: options.isVisible ?? true,
    isRequired: options.isRequired ?? false,
    isReadOnly: options.isReadOnly ?? false,
    placeholder: options.placeholder,
    helpText: options.helpText,
    isMultiSelect: false,
    isArrayField: options.isArrayField ?? false,
  };
  
  config.fields.push(field);
  
  // Add field reference to section
  if (!section.fields) {
    section.fields = [];
  }
  if (!section.fields.includes(options.fieldPath)) {
    section.fields.push(options.fieldPath);
  }
  
  // Add field reference to panel if specified
  if (options.panelId) {
    const panel = config.panels?.find(p => p.panelId === options.panelId);
    if (panel && !panel.fields.includes(options.fieldPath)) {
      panel.fields.push(options.fieldPath);
    }
  }
  
  // Sort fields by displayOrder
  config.fields.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Remove a field from the configuration
 */
export function removeField(config: FilingUIConfigData, fieldPath: string): void {
  const index = config.fields.findIndex(field => field.fieldPath === fieldPath);
  if (index === -1) {
    throw new Error(`Field with path "${fieldPath}" not found`);
  }
  
  const field = config.fields[index];
  
  // Remove the field
  config.fields.splice(index, 1);
  
  // Remove field reference from section
  const section = config.sections.find(s => s.sectionId === field.section);
  if (section?.fields) {
    section.fields = section.fields.filter(f => f !== fieldPath);
  }
  
  // Remove field reference from panel if applicable
  if (field.panelId) {
    const panel = config.panels?.find(p => p.panelId === field.panelId);
    if (panel) {
      panel.fields = panel.fields.filter(f => f !== fieldPath);
    }
  }
}

/**
 * Update a field in the configuration
 */
export function updateField(
  config: FilingUIConfigData,
  fieldPath: string,
  updates: Partial<FieldConfig>
): void {
  const field = config.fields.find(f => f.fieldPath === fieldPath);
  if (!field) {
    throw new Error(`Field with path "${fieldPath}" not found`);
  }
  
  // Apply updates
  Object.assign(field, updates);
  
  // If section changed, update references
  if (updates.section && updates.section !== field.section) {
    // Remove from old section
    const oldSection = config.sections.find(s => s.sectionId === field.section);
    if (oldSection?.fields) {
      oldSection.fields = oldSection.fields.filter(f => f !== fieldPath);
    }
    
    // Add to new section
    const newSection = config.sections.find(s => s.sectionId === updates.section);
    if (newSection) {
      if (!newSection.fields) newSection.fields = [];
      if (!newSection.fields.includes(fieldPath)) {
        newSection.fields.push(fieldPath);
      }
    }
  }
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Clone a configuration
 */
export function cloneConfig(config: FilingUIConfigData): FilingUIConfigData {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Get field by path
 */
export function getField(config: FilingUIConfigData, fieldPath: string): FieldConfig | undefined {
  return config.fields.find(f => f.fieldPath === fieldPath);
}

/**
 * Get all fields in a section
 */
export function getFieldsBySection(config: FilingUIConfigData, sectionId: string): FieldConfig[] {
  return config.fields.filter(f => f.section === sectionId);
}

/**
 * Get all fields in a panel
 */
export function getFieldsByPanel(config: FilingUIConfigData, panelId: string): FieldConfig[] {
  return config.fields.filter(f => f.panelId === panelId);
}

/**
 * Get section by ID
 */
export function getSection(config: FilingUIConfigData, sectionId: string): UISection | undefined {
  return config.sections.find(s => s.sectionId === sectionId);
}

/**
 * Get tab by ID
 */
export function getTab(config: FilingUIConfigData, tabId: string): UITab | undefined {
  return config.tabs?.find(t => t.tabId === tabId);
}

/**
 * Get panel by ID
 */
export function getPanel(config: FilingUIConfigData, panelId: string): UIPanel | undefined {
  return config.panels?.find(p => p.panelId === panelId);
}
