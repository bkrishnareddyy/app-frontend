/**
 * UI Config Validator
 * 
 * Validates FilingUIConfigData structures for consistency and correctness.
 * Detects common errors like duplicate IDs, orphaned fields, and invalid references.
 */

import { FilingUIConfigData } from '@/types/ui-config.types';

export interface ValidationError {
  type: 'error' | 'warning';
  category: 'structure' | 'reference' | 'duplicate' | 'missing' | 'orphaned';
  message: string;
  details?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate a UI configuration
 */
export function validateConfig(config: FilingUIConfigData): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  
  // Run all validation checks
  validateStructure(config, errors, warnings);
  validateDuplicates(config, errors, warnings);
  validateReferences(config, errors, warnings);
  validateOrphans(config, errors, warnings);
  validateFieldPaths(config, errors, warnings);
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// STRUCTURE VALIDATION
// ============================================================================

function validateStructure(
  config: FilingUIConfigData,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Check version
  if (!config.version) {
    errors.push({
      type: 'error',
      category: 'missing',
      message: 'Configuration version is missing',
    });
  }
  
  // Check metadata
  if (!config.metadata) {
    errors.push({
      type: 'error',
      category: 'missing',
      message: 'Configuration metadata is missing',
    });
  } else {
    if (!config.metadata.title) {
      warnings.push({
        type: 'warning',
        category: 'missing',
        message: 'Configuration title is missing',
      });
    }
  }
  
  // Check layout
  if (!config.layout) {
    errors.push({
      type: 'error',
      category: 'missing',
      message: 'Configuration layout is missing',
    });
  } else {
    if (!config.layout.mode) {
      errors.push({
        type: 'error',
        category: 'missing',
        message: 'Layout mode is missing',
      });
    }
    
    const validModes = ['tabs', 'accordion', 'single-page'];
    if (config.layout.mode && !validModes.includes(config.layout.mode)) {
      errors.push({
        type: 'error',
        category: 'structure',
        message: `Invalid layout mode: "${config.layout.mode}". Must be one of: ${validModes.join(', ')}`,
      });
    }
    
    // If layout mode is tabs, tabs array should exist
    if (config.layout.mode === 'tabs' && (!config.tabs || config.tabs.length === 0)) {
      warnings.push({
        type: 'warning',
        category: 'missing',
        message: 'Layout mode is "tabs" but no tabs are defined',
      });
    }
  }
  
  // Check sections
  if (!config.sections || config.sections.length === 0) {
    warnings.push({
      type: 'warning',
      category: 'missing',
      message: 'No sections defined in configuration',
    });
  }
  
  // Check fields
  if (!config.fields || config.fields.length === 0) {
    warnings.push({
      type: 'warning',
      category: 'missing',
      message: 'No fields defined in configuration',
    });
  }
}

// ============================================================================
// DUPLICATE ID VALIDATION
// ============================================================================

function validateDuplicates(
  config: FilingUIConfigData,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Check duplicate tab IDs
  if (config.tabs) {
    const tabIds = new Set<string>();
    config.tabs.forEach(tab => {
      if (tabIds.has(tab.tabId)) {
        errors.push({
          type: 'error',
          category: 'duplicate',
          message: `Duplicate tab ID: "${tab.tabId}"`,
          details: { tabId: tab.tabId },
        });
      }
      tabIds.add(tab.tabId);
    });
  }
  
  // Check duplicate section IDs
  const sectionIds = new Set<string>();
  config.sections.forEach(section => {
    if (sectionIds.has(section.sectionId)) {
      errors.push({
        type: 'error',
        category: 'duplicate',
        message: `Duplicate section ID: "${section.sectionId}"`,
        details: { sectionId: section.sectionId },
      });
    }
    sectionIds.add(section.sectionId);
  });
  
  // Check duplicate panel IDs
  if (config.panels) {
    const panelIds = new Set<string>();
    config.panels.forEach(panel => {
      if (panelIds.has(panel.panelId)) {
        errors.push({
          type: 'error',
          category: 'duplicate',
          message: `Duplicate panel ID: "${panel.panelId}"`,
          details: { panelId: panel.panelId },
        });
      }
      panelIds.add(panel.panelId);
    });
  }
  
  // Check duplicate field paths
  const fieldPaths = new Set<string>();
  config.fields.forEach(field => {
    if (fieldPaths.has(field.fieldPath)) {
      errors.push({
        type: 'error',
        category: 'duplicate',
        message: `Duplicate field path: "${field.fieldPath}"`,
        details: { fieldPath: field.fieldPath },
      });
    }
    fieldPaths.add(field.fieldPath);
  });
}

// ============================================================================
// REFERENCE VALIDATION
// ============================================================================

function validateReferences(
  config: FilingUIConfigData,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  const sectionIds = new Set(config.sections.map(s => s.sectionId));
  const panelIds = new Set(config.panels?.map(p => p.panelId) || []);
  const tabIds = new Set(config.tabs?.map(t => t.tabId) || []);
  
  // Validate tab → section references
  if (config.tabs) {
    config.tabs.forEach(tab => {
      tab.sections.forEach(sectionId => {
        if (!sectionIds.has(sectionId)) {
          errors.push({
            type: 'error',
            category: 'reference',
            message: `Tab "${tab.tabId}" references non-existent section: "${sectionId}"`,
            details: { tabId: tab.tabId, sectionId },
          });
        }
      });
    });
  }
  
  // Validate section → panel references
  config.sections.forEach(section => {
    if (section.panels) {
      section.panels.forEach(panelId => {
        if (!panelIds.has(panelId)) {
          errors.push({
            type: 'error',
            category: 'reference',
            message: `Section "${section.sectionId}" references non-existent panel: "${panelId}"`,
            details: { sectionId: section.sectionId, panelId },
          });
        }
      });
    }
  });
  
  // Validate panel → section references
  if (config.panels) {
    config.panels.forEach(panel => {
      if (!sectionIds.has(panel.sectionId)) {
        errors.push({
          type: 'error',
          category: 'reference',
          message: `Panel "${panel.panelId}" references non-existent section: "${panel.sectionId}"`,
          details: { panelId: panel.panelId, sectionId: panel.sectionId },
        });
      }
    });
  }
  
  // Validate field → section references
  config.fields.forEach(field => {
    if (!sectionIds.has(field.section)) {
      errors.push({
        type: 'error',
        category: 'reference',
        message: `Field "${field.fieldPath}" references non-existent section: "${field.section}"`,
        details: { fieldPath: field.fieldPath, section: field.section },
      });
    }
    
    // Validate field → panel references
    if (field.panelId && !panelIds.has(field.panelId)) {
      errors.push({
        type: 'error',
        category: 'reference',
        message: `Field "${field.fieldPath}" references non-existent panel: "${field.panelId}"`,
        details: { fieldPath: field.fieldPath, panelId: field.panelId },
      });
    }
    
    // Validate field → tab references
    if (field.tabId && !tabIds.has(field.tabId)) {
      errors.push({
        type: 'error',
        category: 'reference',
        message: `Field "${field.fieldPath}" references non-existent tab: "${field.tabId}"`,
        details: { fieldPath: field.fieldPath, tabId: field.tabId },
      });
    }
  });
}

// ============================================================================
// ORPHAN DETECTION
// ============================================================================

function validateOrphans(
  config: FilingUIConfigData,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Detect orphaned sections (not linked to any tab in tab mode)
  if (config.layout.mode === 'tabs' && config.tabs) {
    const linkedSections = new Set<string>();
    config.tabs.forEach(tab => {
      tab.sections.forEach(sectionId => linkedSections.add(sectionId));
    });
    
    config.sections.forEach(section => {
      if (!linkedSections.has(section.sectionId)) {
        warnings.push({
          type: 'warning',
          category: 'orphaned',
          message: `Section "${section.sectionId}" is not linked to any tab`,
          details: { sectionId: section.sectionId },
        });
      }
    });
  }
  
  // Detect orphaned panels (not linked to section.panels array)
  if (config.panels) {
    const linkedPanels = new Set<string>();
    config.sections.forEach(section => {
      if (section.panels) {
        section.panels.forEach(panelId => linkedPanels.add(panelId));
      }
    });
    
    config.panels.forEach(panel => {
      if (!linkedPanels.has(panel.panelId)) {
        warnings.push({
          type: 'warning',
          category: 'orphaned',
          message: `Panel "${panel.panelId}" is not linked to its section's panels array`,
          details: { panelId: panel.panelId, sectionId: panel.sectionId },
        });
      }
    });
  }
  
  // Detect orphaned fields (not linked to section.fields array)
  const linkedFields = new Set<string>();
  config.sections.forEach(section => {
    if (section.fields) {
      section.fields.forEach(fieldPath => linkedFields.add(fieldPath));
    }
  });
  
  config.fields.forEach(field => {
    if (!linkedFields.has(field.fieldPath)) {
      warnings.push({
        type: 'warning',
        category: 'orphaned',
        message: `Field "${field.fieldPath}" is not linked to its section's fields array`,
        details: { fieldPath: field.fieldPath, section: field.section },
      });
    }
  });
}

// ============================================================================
// FIELD PATH VALIDATION
// ============================================================================

function validateFieldPaths(
  config: FilingUIConfigData,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  config.fields.forEach(field => {
    // Check field path format
    if (!field.fieldPath) {
      errors.push({
        type: 'error',
        category: 'missing',
        message: 'Field is missing fieldPath property',
        details: { fieldLabel: field.fieldLabel },
      });
      return;
    }
    
    // Warn about potential issues
    if (field.fieldPath.includes(' ')) {
      warnings.push({
        type: 'warning',
        category: 'structure',
        message: `Field path contains spaces: "${field.fieldPath}"`,
        details: { fieldPath: field.fieldPath },
      });
    }
    
    if (field.fieldPath.startsWith('.') || field.fieldPath.endsWith('.')) {
      warnings.push({
        type: 'warning',
        category: 'structure',
        message: `Field path starts or ends with dot: "${field.fieldPath}"`,
        details: { fieldPath: field.fieldPath },
      });
    }
    
    // Check required properties
    if (!field.fieldLabel) {
      errors.push({
        type: 'error',
        category: 'missing',
        message: `Field "${field.fieldPath}" is missing fieldLabel`,
        details: { fieldPath: field.fieldPath },
      });
    }
    
    if (!field.fieldType) {
      errors.push({
        type: 'error',
        category: 'missing',
        message: `Field "${field.fieldPath}" is missing fieldType`,
        details: { fieldPath: field.fieldPath },
      });
    }
    
    if (!field.section) {
      errors.push({
        type: 'error',
        category: 'missing',
        message: `Field "${field.fieldPath}" is missing section reference`,
        details: { fieldPath: field.fieldPath },
      });
    }
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a human-readable validation summary
 */
export function getValidationSummary(
  errors: ValidationError[], 
  warnings: ValidationError[]
): string {
  if (errors.length === 0 && warnings.length === 0) {
    return 'Configuration is valid with no issues.';
  }
  
  const parts: string[] = [];
  
  if (errors.length > 0) {
    parts.push(`${errors.length} error(s)`);
  }
  
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s)`);
  }
  
  return `Configuration has ${parts.join(' and ')}.`;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string[] {
  return errors.map(error => {
    let message = `[${error.category.toUpperCase()}] ${error.message}`;
    if (error.details) {
      const details = Object.entries(error.details)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      message += ` (${details})`;
    }
    return message;
  });
}

/**
 * Check if configuration has critical errors
 */
export function hasCriticalErrors(result: ValidationResult): boolean {
  return result.errors.some(
    error => error.category === 'reference' || error.category === 'duplicate'
  );
}
