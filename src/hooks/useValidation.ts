/**
 * useValidation Hook
 * 
 * React hook for form validation using UI config JSON.
 * Features:
 * - Real-time field validation
 * - Form-level validation
 * - Error state management
 * - Validation on blur/change/submit
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { validateForm, validateFieldByPath, type ValidationResult } from "@/lib/validation/ValidationEngine";
import type { FilingUIConfigData } from "@/types/ui-config.types";

export interface UseValidationOptions {
  validateOnBlur?: boolean;
  validateOnChange?: boolean;
  validateOnMount?: boolean;
}

export interface UseValidationReturn {
  errors: Record<string, string>;
  warnings: Record<string, string>;
  isValid: boolean;
  isValidating: boolean;
  validateField: (fieldPath: string) => Promise<void>;
  validateForm: () => Promise<ValidationResult>;
  clearErrors: () => void;
  clearFieldError: (fieldPath: string) => void;
  setFieldError: (fieldPath: string, error: string) => void;
}

export function useValidation(
  config: FilingUIConfigData,
  formData: Record<string, any>,
  options: UseValidationOptions = {}
): UseValidationReturn {
  const {
    validateOnChange = false,
    validateOnMount = false
  } = options;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [isValidating, setIsValidating] = useState(false);

  // Validate entire form
  const handleValidateForm = useCallback(async (): Promise<ValidationResult> => {
    setIsValidating(true);
    
    try {
      const result = validateForm(config, formData);
      setErrors(result.errors);
      setWarnings(result.warnings);
      return result;
    } finally {
      setIsValidating(false);
    }
  }, [config, formData]);

  // Validate single field
  const handleValidateField = useCallback(async (fieldPath: string): Promise<void> => {
    setIsValidating(true);
    
    try {
      const error = validateFieldByPath(config, formData, fieldPath);
      
      setErrors(prev => {
        const next = { ...prev };
        if (error) {
          next[fieldPath] = error;
        } else {
          delete next[fieldPath];
        }
        return next;
      });
    } finally {
      setIsValidating(false);
    }
  }, [config, formData]);

  // Clear all errors
  const clearErrors = useCallback(() => {
    setErrors({});
    setWarnings({});
  }, []);

  // Clear specific field error
  const clearFieldError = useCallback((fieldPath: string) => {
    setErrors(prev => {
      const next = { ...prev };
      delete next[fieldPath];
      return next;
    });
  }, []);

  // Set specific field error (for custom validation)
  const setFieldError = useCallback((fieldPath: string, error: string) => {
    setErrors(prev => ({
      ...prev,
      [fieldPath]: error
    }));
  }, []);

  // Validate on mount if requested
  useEffect(() => {
    if (validateOnMount) {
      handleValidateForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateOnMount]); // Only run on mount

  // Validate on change if requested
  useEffect(() => {
    if (validateOnChange && Object.keys(errors).length > 0) {
      // Re-validate only fields that have errors
      const fieldsWithErrors = Object.keys(errors);
      fieldsWithErrors.forEach(fieldPath => {
        handleValidateField(fieldPath);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, validateOnChange]); // Run when formData changes

  const isValid = Object.keys(errors).length === 0;

  return {
    errors,
    warnings,
    isValid,
    isValidating,
    validateField: handleValidateField,
    validateForm: handleValidateForm,
    clearErrors,
    clearFieldError,
    setFieldError
  };
}

/**
 * Hook for validating a single field
 */
export function useFieldValidation(
  config: FilingUIConfigData,
  formData: Record<string, any>,
  fieldPath: string
) {
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const validate = useCallback(async () => {
    setIsValidating(true);
    
    try {
      const validationError = validateFieldByPath(config, formData, fieldPath);
      setError(validationError);
      return validationError === null;
    } finally {
      setIsValidating(false);
    }
  }, [config, formData, fieldPath]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    isValidating,
    validate,
    clearError,
    isValid: error === null
  };
}
