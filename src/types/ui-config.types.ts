// Transitional compatibility types for the filing-config editor/runtime.
// Canonical identifiers/order fields remain required; legacy visual-editor
// aliases are readable during migration. Runtime validation remains authoritative.

export type LayoutMode = "tabs" | "accordion" | "single-page" | "panels";
export type FieldType = string;
export type DisplayMode = "input" | "grid" | "cards" | "readonly" | string;
export type DataSourceType = "api" | "static" | "masterData" | "computed" | string;
export type SectionLayout = "grid" | "panels" | "cards" | "list" | string;

export interface FilingUIConfigData {
  version: string;
  metadata: Record<string, any> & { title?: string; description?: string; tags?: string[] };
  layout: Record<string, any> & { mode?: LayoutMode };
  layoutHints?: Record<string, any>;
  tabs?: UITab[];
  sections: UISection[];
  panels?: UIPanel[];
  fields: FieldConfig[];
  validation?: any;
  conditionalLogic?: any;
  translations?: any;
  theme?: any;
  permissions?: any;
  [key: string]: any;
}

export interface UITab {
  tabId: string;
  label: string;
  tabOrder: number;
  sections: string[];
  id?: string;
  title?: string;
  displayOrder?: number;
  icon?: string;
  isVisible?: boolean;
  conditional?: any;
  description?: string;
  badge?: string;
  badgeColor?: string;
  [key: string]: any;
}

export interface UISection {
  sectionId: string;
  title: string;
  sectionOrder: number;
  fields: string[];
  id?: string;
  tabId?: string;
  displayOrder?: number;
  layout?: SectionLayout;
  columns?: number;
  isVisible?: boolean;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  panels?: string[];
  conditional?: any;
  description?: string;
  className?: string;
  [key: string]: any;
}

export interface UIPanel {
  panelId: string;
  sectionId: string;
  panelOrder: number;
  fields: string[];
  id?: string;
  title?: string;
  displayOrder?: number;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  borderStyle?: string;
  backgroundColor?: string;
  conditional?: any;
  className?: string;
  [key: string]: any;
}

export interface FieldConfig {
  fieldPath: string;
  fieldLabel: string;
  fieldType: FieldType;
  tabId?: string;
  section: string;
  sectionId?: string;
  panelId?: string;
  displayOrder: number;
  gridColumn: number;
  gridColumnOrder?: number;
  isVisible: boolean;
  isRequired: boolean;
  isReadOnly: boolean;
  displayMode?: DisplayMode;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
  computeDefault?: any;
  suffix?: string;
  prefix?: string;
  masterDataSource?: string;
  isMultiSelect?: boolean;
  dataSource?: DataSourceConfig;
  validation?: FieldValidationRules;
  conditional?: FieldConditional;
  showWhen?: any;
  hideWhen?: any;
  enableWhen?: any;
  disableWhen?: any;
  requiredWhen?: any;
  hooks?: FieldHooks;
  translations?: any;
  styleOverrides?: any;
  isArrayField?: boolean;
  gridConfig?: any;
  permissions?: any;
  [key: string]: any;
}

export interface DataSourceConfig {
  type?: DataSourceType;
  endpoint?: string;
  apiEndpoint?: string;
  method?: "GET" | "POST";
  options?: Array<{ value: string | number; label: string; disabled?: boolean; metadata?: Record<string, any> }>;
  valueField?: string;
  labelField?: string;
  displayFields?: string[];
  filters?: Record<string, any>;
  dependsOn?: string[] | string;
  cacheKey?: string;
  cacheTTL?: number;
  searchConfig?: any;
  [key: string]: any;
}

export interface FieldValidationRules {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  email?: boolean;
  url?: boolean;
  phone?: boolean;
  custom?: string;
  message?: string;
  asyncValidation?: any;
  conditionalRequired?: any;
  [key: string]: any;
}

export interface FieldConditional {
  showWhen?: any;
  hideWhen?: any;
  enableWhen?: any;
  disableWhen?: any;
  requiredWhen?: any;
  [key: string]: any;
}

export interface FieldHooks {
  onLoad?: string;
  onChange?: string;
  onBlur?: string;
  onFocus?: string;
  [key: string]: any;
}

export interface ValidationRule<T> { value: T; message: string }
export interface CustomValidator { validator: string; async: boolean; message?: string }
export interface HookConfig { endpoint?: string; method?: string; payload?: any; [key: string]: any }
export interface ConditionalExpression { [key: string]: any }
export interface ComputedDefault { [key: string]: any }
export interface DataSourceOption { value: string | number; label: string; disabled?: boolean; metadata?: Record<string, any> }
export interface SearchConfig { [key: string]: any }
export interface AsyncValidation { [key: string]: any }
export interface ConditionalValidation { [key: string]: any }
export interface FieldTranslations { [key: string]: any }
export interface StyleOverrides { [key: string]: any }
export interface GridConfig { [key: string]: any }
export interface FieldPermissions { [key: string]: any }
export interface ValidationConfig { [key: string]: any }
export interface ConditionalLogicConfig { [key: string]: any }
export interface TranslationConfig { [key: string]: any }
export interface ThemeConfig { [key: string]: any }
export interface PermissionConfig { [key: string]: any }
export interface UIMetadata { [key: string]: any }
export interface UILayout { mode?: LayoutMode; [key: string]: any }
export interface ResponsiveConfig { [key: string]: any }
export type TabPosition = "top" | "left" | "right";
export type ConditionalOperator = string;
export type LogicalOperator = "AND" | "OR";
