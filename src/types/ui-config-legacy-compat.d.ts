import "@/types/ui-config.types";
import "@/lib/ui-config/config-builder";
import "@/lib/ui-config/config-validator";

declare module "@/types/ui-config.types" {
  interface FilingUIConfigData {
    /** Transitional renderer hints retained for legacy filing-config layouts. */
    layoutHints?: Record<string, unknown>;
  }

  interface UITab {
    /** Legacy editor aliases; canonical fields remain tabId/label/tabOrder. */
    id?: string;
    title?: string;
    displayOrder?: number;
  }

  interface UISection {
    /** Legacy editor aliases; canonical fields remain sectionId/sectionOrder. */
    id?: string;
    tabId?: string;
    displayOrder?: number;
  }

  interface FieldConfig {
    /** Legacy alias for section used by the visual editor. */
    sectionId?: string;
    /** Legacy flattened conditional fields. */
    showWhen?: ConditionalExpression;
    hideWhen?: ConditionalExpression;
    enableWhen?: ConditionalExpression;
    disableWhen?: ConditionalExpression;
    requiredWhen?: ConditionalExpression;
  }

  interface DataSourceConfig {
    /** Legacy name retained while editor migrates to endpoint. */
    apiEndpoint?: string;
  }

  interface FieldValidationRules {
    /** Legacy shared validation message used by the visual editor. */
    message?: string;
  }
}

declare module "@/lib/ui-config/config-builder" {
  interface CreateConfigOptions {
    /** Optional editor metadata tags. */
    tags?: string[];
  }
}

declare module "@/lib/ui-config/config-validator" {
  interface ValidationError {
    /** Legacy editor path alias for fieldPath. */
    path?: string;
  }
}
