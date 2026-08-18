/**
 * ValidationEngine
 * 
 * Executes validation rules from UI config JSON at runtime.
 * Supports:
 * - Required fields
 * - Length constraints (minLength, maxLength)
 * - Value constraints (min, max)
 * - Pattern matching (regex)
 * - Format validation (email, url, phone)
 * - Custom validation functions
 */

import type { FieldConfig, FieldValidationRules } from "@/types/ui-config.types";

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

export interface ValidationOptions {
  stopOnFirstError?: boolean;
  validateHidden?: boolean;
}

/**
 * Validate a single field value against its validation rules
 */
export function validateField(
  field: FieldConfig,
  value: any,
  formData?: Record<string, any>
): string | null {
  // Skip if field is not visible (unless explicitly validating hidden fields)
  if (field.isVisible === false) {
    return null;
  }

  const validation = field.validation;
  if (!validation) return null;

  // Required validation
  if (field.isRequired || validation.required) {
    if (value === null || value === undefined || value === '') {
      return validation.message || `${field.fieldLabel} is required`;
    }
  }

  // Skip further validation if value is empty (but not required)
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const stringValue = String(value);

  // MinLength validation
  if (validation.minLength !== undefined && stringValue.length < validation.minLength) {
    return validation.message || `${field.fieldLabel} must be at least ${validation.minLength} characters`;
  }

  // MaxLength validation
  if (validation.maxLength !== undefined && stringValue.length > validation.maxLength) {
    return validation.message || `${field.fieldLabel} must be at most ${validation.maxLength} characters`;
  }

  // Min value validation
  if (validation.min !== undefined) {
    const numValue = Number(value);
    if (!isNaN(numValue) && numValue < validation.min) {
      return validation.message || `${field.fieldLabel} must be at least ${validation.min}`;
    }
  }

  // Max value validation
  if (validation.max !== undefined) {
    const numValue = Number(value);
    if (!isNaN(numValue) && numValue > validation.max) {
      return validation.message || `${field.fieldLabel} must be at most ${validation.max}`;
    }
  }

  // Pattern validation
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(stringValue)) {
        return validation.message || `${field.fieldLabel} format is invalid`;
      }
    } catch (e) {
      console.error(`Invalid regex pattern for field ${field.fieldPath}:`, e);
    }
  }

  // Email validation
  if (validation.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(stringValue)) {
      return validation.message || `${field.fieldLabel} must be a valid email address`;
    }
  }

  // URL validation
  if (validation.url) {
    try {
      new URL(stringValue);
    } catch {
      return validation.message || `${field.fieldLabel} must be a valid URL`;
    }
  }

  // Phone validation (basic)
  if (validation.phone) {
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(stringValue) || stringValue.replace(/\D/g, '').length < 10) {
      return validation.message || `${field.fieldLabel} must be a valid phone number`;
    }
  }

  // Custom validation function
  if (validation.custom) {
    try {
      // Safely evaluate custom validation function
      // Function should return true for valid or an error message string
      const customFn = new Function('value', 'formData', `return (${validation.custom})(value, formData)`);
      const result = customFn(value, formData);
      
      if (result === true || result === undefined || result === null) {
        return null; // Valid
      } else if (typeof result === 'string') {
        return result; // Error message
      } else {
        return `${field.fieldLabel} is invalid`;
      }
    } catch (e) {
      console.error(`Custom validation error for field ${field.fieldPath}:`, e);
      return `${field.fieldLabel} validation failed`;
    }
  }

  return null;
}

/**
 * Validate entire form against UI config
 */
export function validateForm(
  config: any,
  formData: Record<string, any>,
  options: ValidationOptions = {}
): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  if (!config || !config.fields) {
    return { isValid: true, errors, warnings };
  }

  for (const field of config.fields) {
    // Skip hidden fields unless explicitly validating them
    if (!options.validateHidden && field.isVisible === false) {
      continue;
    }

    // Get field value from form data
    const value = getFieldValue(formData, field.fieldPath);

    // Validate field
    const error = validateField(field, value, formData);
    if (error) {
      errors[field.fieldPath] = error;
      
      if (options.stopOnFirstError) {
        break;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    warnings
  };
}

/**
 * Get field value from form data using dot notation path
 */
function getFieldValue(formData: Record<string, any>, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let value: any = formData;
  
  for (const part of parts) {
    if (value == null) return undefined;
    value = value[part];
  }
  
  return value;
}

/**
 * Validate a specific field by path
 */
export function validateFieldByPath(
  config: any,
  formData: Record<string, any>,
  fieldPath: string
): string | null {
  if (!config || !config.fields) {
    return null;
  }

  const field = config.fields.find((f: any) => f.fieldPath === fieldPath);
  if (!field) {
    return null;
  }

  const value = getFieldValue(formData, fieldPath);
  return validateField(field, value, formData);
}

/**
 * Get all fields that have validation errors
 */
export function getInvalidFields(
  config: any,
  formData: Record<string, any>
): string[] {
  const result = validateForm(config, formData);
  return Object.keys(result.errors);
}

/**
 * Check if form is valid
 */
export function isFormValid(
  config: any,
  formData: Record<string, any>
): boolean {
  const result = validateForm(config, formData);
  return result.isValid;
}
