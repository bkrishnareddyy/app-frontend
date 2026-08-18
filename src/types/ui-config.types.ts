/**
 * UI Configuration Types
 * 
 * Complete TypeScript interfaces for the FilingUIConfig.configData JSON schema.
 * This defines the structure for dynamic, schema-driven UI configuration.
 * 
 * Architecture: Single-table JSON-based (all config stored in FilingUIConfig.configData)
 * Focus: UI presentation and behavior only (no workflow orchestration)
 */

// ============================================================================
// ROOT CONFIGURATION
// ============================================================================

/**
 * Root interface for FilingUIConfig.configData JSON
 * This is the complete structure stored in the database
 */
export interface FilingUIConfigData {
  /** Schema version for migration compatibility */
  version: string;
  
  /** Configuration metadata */
  metadata: UIMetadata;
  
  /** Layout mode and configuration */
  layout: UILayout;
  
  /** Tab definitions (for tab-based layouts) */
  tabs?: UITab[];
  
  /** Section definitions (groups of fields) */
  sections: UISection[];
  
  /** Panel definitions (bordered containers within sections) */
  panels?: UIPanel[];
  
  /** Field configurations (the actual form fields) */
  fields: FieldConfig[];
  
  /** Validation configuration (cross-field rules, strategy) */
  validation?: ValidationConfig;
  
  /** Conditional logic rules (show/hide, enable/disable) */
  conditionalLogic?: ConditionalLogicConfig;
  
  /** Translation keys for multi-language support */
  translations?: TranslationConfig;
  
  /** Theme and styling overrides */
  theme?: ThemeConfig;
  
  /** Role-based access control configuration */
  permissions?: PermissionConfig;
}

// ============================================================================
// METADATA
// ============================================================================

export interface UIMetadata {
  /** Human-readable title for this configuration */
  title: string;
  
  /** Optional description */
  description?: string;
  
  /** Tags for categorization/search */
  tags?: string[];
  
  /** Last modified by */
  lastModifiedBy?: string;
  
  /** Last modified timestamp */
  lastModifiedAt?: string;
}

// ============================================================================
// LAYOUT CONFIGURATION
// ============================================================================

export type LayoutMode = 'tabs' | 'accordion' | 'single-page';
export type TabPosition = 'top' | 'left' | 'right';

export interface UILayout {
  /** Layout rendering mode */
  mode: LayoutMode;
  
  /** Tab position (only for tab mode) */
  tabPosition?: TabPosition;
  
  /** Responsive layout configuration */
  responsive?: ResponsiveConfig;
  
  /** Default columns for grid layouts */
  defaultColumns?: number;
}

export interface ResponsiveConfig {
  /** Breakpoint definitions */
  breakpoints: {
    mobile: { maxWidth: number; columns: number };
    tablet: { minWidth: number; maxWidth: number; columns: number };
    desktop: { minWidth: number; columns: number };
  };
  
  /** Adaptive layout switching (e.g., tabs → accordion on mobile) */
  adaptiveLayouts?: {
    tabs?: { mobile: LayoutMode; tablet: LayoutMode; desktop: LayoutMode };
    grid?: { mobile: string; tablet: string; desktop: string };
  };
}

// ============================================================================
// TAB DEFINITIONS
// ============================================================================

export interface UITab {
  /** Unique tab identifier */
  tabId: string;
  
  /** Display label */
  label: string;
  
  /** Icon name (lucide-react icon) */
  icon?: string;
  
  /** Sort order (lower numbers appear first) */
  tabOrder: number;
  
  /** Whether this tab is visible */
  isVisible: boolean;
  
  /** Section IDs that belong to this tab */
  sections: string[];
  
  /** Conditional visibility rules */
  conditional?: ConditionalExpression;
  
  /** Description/help text for the tab */
  description?: string;
  
  /** Badge text (e.g., "Required", "3 errors") */
  badge?: string;
  
  /** Badge color */
  badgeColor?: 'red' | 'yellow' | 'green' | 'blue' | 'gray';
}

// ============================================================================
// SECTION DEFINITIONS
// ============================================================================

export type SectionLayout = 'grid' | 'panels' | 'cards' | 'list';

export interface UISection {
  /** Unique section identifier */
  sectionId: string;
  
  /** Display title */
  title: string;
  
  /** Sort order within tab */
  sectionOrder: number;
  
  /** Section layout mode */
  layout: SectionLayout;
  
  /** Number of columns (for grid layout) */
  columns?: number;
  
  /** Whether this section is visible */
  isVisible: boolean;
  
  /** Whether section can be collapsed */
  isCollapsible: boolean;
  
  /** Default expanded state */
  defaultExpanded: boolean;
  
  /** Field paths that belong to this section */
  fields?: string[];
  
  /** Panel IDs (for panel-based layouts) */
  panels?: string[];
  
  /** Conditional visibility rules */
  conditional?: ConditionalExpression;
  
  /** Description/help text */
  description?: string;
  
  /** Custom CSS classes */
  className?: string;
}

// ============================================================================
// PANEL DEFINITIONS
// ============================================================================

export interface UIPanel {
  /** Unique panel identifier */
  panelId: string;
  
  /** Parent section ID */
  sectionId: string;
  
  /** Display title */
  title: string;
  
  /** Sort order within section */
  panelOrder: number;
  
  /** Whether panel can be collapsed */
  isCollapsible: boolean;
  
  /** Default expanded state */
  defaultExpanded: boolean;
  
  /** Border style */
  borderStyle?: 'solid' | 'dashed' | 'none';
  
  /** Background color */
  backgroundColor?: string;
  
  /** Field paths that belong to this panel */
  fields: string[];
  
  /** Conditional visibility rules */
  conditional?: ConditionalExpression;
  
  /** Custom CSS classes */
  className?: string;
}

// ============================================================================
// FIELD CONFIGURATION
// ============================================================================

export type FieldType = 
  | 'text' 
  | 'textarea' 
  | 'number' 
  | 'email'
  | 'currency'
  | 'date' 
  | 'datetime'
  | 'time'
  | 'checkbox' 
  | 'radio'
  | 'dropdown' 
  | 'multiselect'
  | 'lookup'
  | 'autocomplete'
  | 'richtext'
  | 'file'
  | 'phone'
  | 'url'
  | 'password'
  | 'color'
  | 'rating'
  | 'slider'
  | 'switch';

export type DisplayMode = 'input' | 'grid' | 'cards' | 'readonly';

export interface FieldConfig {
  // ===== Identification =====
  /** Field path (e.g., "goodsDeclaration.declarationNumber") */
  fieldPath: string;
  
  /** Display label */
  fieldLabel: string;
  
  /** Field type (input control) */
  fieldType: FieldType;
  
  // ===== Organization =====
  /** Tab ID this field belongs to */
  tabId?: string;
  
  /** Section ID this field belongs to */
  section: string;
  
  /** Panel ID (if panel-based layout) */
  panelId?: string;
  
  /** Display order within section/panel */
  displayOrder: number;
  
  /** Grid column span (1-12) */
  gridColumn: number;
  
  /** Order within grid column */
  gridColumnOrder?: number;
  
  // ===== Visibility & Interaction =====
  /** Whether field is visible */
  isVisible: boolean;
  
  /** Whether field is required */
  isRequired: boolean;
  
  /** Whether field is read-only */
  isReadOnly: boolean;
  
  /** Display mode (for array fields) */
  displayMode?: DisplayMode;
  
  // ===== UI Properties =====
  /** Placeholder text */
  placeholder?: string;
  
  /** Help text / description */
  helpText?: string;
  
  /** Default value (static) */
  defaultValue?: string | number | boolean;
  
  /** Computed default value expression */
  computeDefault?: ComputedDefault;
  
  /** Suffix/prefix text (e.g., "EUR", "kg") */
  suffix?: string;
  prefix?: string;
  
  // ===== Data Source =====
  /** Master data source (for dropdowns/lookups) */
  masterDataSource?: string;
  
  /** Whether multi-select is enabled */
  isMultiSelect: boolean;
  
  /** Data source configuration */
  dataSource?: DataSourceConfig;
  
  // ===== Validation =====
  /** Validation rules */
  validation?: FieldValidationRules;
  
  // ===== Conditional Logic =====
  /** Conditional visibility/behavior rules */
  conditional?: FieldConditional;
  
  // ===== API Hooks =====
  /** Field-level API hooks */
  hooks?: FieldHooks;
  
  // ===== Translations =====
  /** Multi-language translations */
  translations?: FieldTranslations;
  
  // ===== Styling =====
  /** Custom style overrides */
  styleOverrides?: StyleOverrides;
  
  // ===== Array Fields =====
  /** Whether this is an array field */
  isArrayField: boolean;
  
  /** Grid configuration (for array fields) */
  gridConfig?: GridConfig;
  
  // ===== RBAC =====
  /** Role-based permissions */
  permissions?: FieldPermissions;
}

// ============================================================================
// COMPUTED DEFAULTS
// ============================================================================

export interface ComputedDefault {
  /** Expression type */
  type: 'expression' | 'function' | 'api';
  
  /** Expression string (e.g., "concat(${country}, '-', timestamp())") */
  expression?: string;
  
  /** Function name (for registered custom functions) */
  function?: string;
  
  /** API endpoint (for API-based defaults) */
  endpoint?: string;
  
  /** Dependencies (field paths that trigger recomputation) */
  dependsOn?: string[];
}

// ============================================================================
// DATA SOURCE CONFIGURATION
// ============================================================================

export type DataSourceType = 'api' | 'static' | 'masterData' | 'computed';

export interface DataSourceConfig {
  /** Data source type */
  type: DataSourceType;
  
  /** API endpoint (for api type) */
  endpoint?: string;
  
  /** HTTP method */
  method?: 'GET' | 'POST';
  
  /** Static options (for static type) */
  options?: DataSourceOption[];
  
  /** Value field name */
  valueField: string;
  
  /** Label field name */
  labelField: string;
  
  /** Additional display fields */
  displayFields?: string[];
  
  /** Filter configuration */
  filters?: Record<string, any>;
  
  /** Depends on other fields (for cascading dropdowns) */
  dependsOn?: string[];
  
  /** Cache key */
  cacheKey?: string;
  
  /** Cache TTL (seconds) */
  cacheTTL?: number;
  
  /** Search configuration (for autocomplete) */
  searchConfig?: SearchConfig;
}

export interface DataSourceOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  metadata?: Record<string, any>;
}

export interface SearchConfig {
  /** Minimum characters before search */
  minChars: number;
  
  /** Debounce delay (ms) */
  debounce: number;
  
  /** Search fields */
  searchFields: string[];
  
  /** Case sensitive */
  caseSensitive?: boolean;
}

// ============================================================================
// VALIDATION RULES
// ============================================================================

export interface FieldValidationRules {
  /** Required validation */
  required?: ValidationRule<boolean>;
  
  /** Minimum length */
  minLength?: ValidationRule<number>;
  
  /** Maximum length */
  maxLength?: ValidationRule<number>;
  
  /** Regex pattern */
  pattern?: ValidationRule<string>;
  
  /** Minimum value (for numbers) */
  min?: ValidationRule<number>;
  
  /** Maximum value (for numbers) */
  max?: ValidationRule<number>;
  
  /** Email format validation */
  email?: ValidationRule<boolean>;
  
  /** URL format validation */
  url?: ValidationRule<boolean>;
  
  /** Phone format validation */
  phone?: ValidationRule<boolean>;
  
  /** Custom validator function name */
  custom?: CustomValidator;
  
  /** Async validation (e.g., uniqueness check) */
  asyncValidation?: AsyncValidation;
  
  /** Conditional required (required only when condition is true) */
  conditionalRequired?: ConditionalValidation;
}

export interface ValidationRule<T> {
  value: T;
  message: string;
}

export interface CustomValidator {
  /** Validator function name (must be registered) */
  validator: string;
  
  /** Whether validation is async */
  async: boolean;
  
  /** Custom error message */
  message?: string;
}

export interface AsyncValidation {
  /** API endpoint for validation */
  endpoint: string;
  
  /** HTTP method */
  method: 'GET' | 'POST';
  
  /** Debounce delay (ms) */
  debounce: number;
  
  /** Request payload template */
  payload?: Record<string, any>;
  
  /** Success condition (expression to evaluate response) */
  successCondition: string;
  
  /** Error message */
  errorMessage: string;
}

export interface ConditionalValidation {
  /** Condition for when this validation applies */
  condition: ConditionalExpression;
  
  /** Error message */
  message: string;
}

// ============================================================================
// CONDITIONAL LOGIC
// ============================================================================

export type ConditionalOperator = 
  | 'equals' 
  | 'notEquals' 
  | 'in' 
  | 'notIn' 
  | 'greaterThan' 
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'isEmpty'
  | 'isNotEmpty';

export type LogicalOperator = 'AND' | 'OR';

export interface ConditionalExpression {
  /** Field path to check */
  field?: string;
  
  /** Comparison operator */
  operator?: ConditionalOperator;
  
  /** Value to compare against */
  value?: any;
  
  /** Nested conditions (for complex logic) */
  conditions?: ConditionalExpression[];
  
  /** Logical operator for nested conditions */
  logicalOperator?: LogicalOperator;
}

export interface FieldConditional {
  /** Show field when condition is true */
  showWhen?: ConditionalExpression;
  
  /** Hide field when condition is true */
  hideWhen?: ConditionalExpression;
  
  /** Enable field when condition is true */
  enableWhen?: ConditionalExpression;
  
  /** Disable field when condition is true */
  disableWhen?: ConditionalExpression;
  
  /** Make required when condition is true */
  requiredWhen?: ConditionalExpression;
}

// ============================================================================
// FIELD HOOKS
// ============================================================================

export interface FieldHooks {
  /** Hook executed when field loads */
  onLoad?: HookConfig;
  
  /** Hook executed when value changes */
  onChange?: HookConfig;
  
  /** Hook executed when field loses focus */
  onBlur?: HookConfig;
  
  /** Hook executed when field gains focus */
  onFocus?: HookConfig;
}

export interface HookConfig {
  /** API endpoint */
  endpoint: string;
  
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  
  /** Request payload template */
  payload?: Record<string, any>;
  
  /** Fields to update with response */
  updateFields?: Record<string, string>;
  
  /** Debounce delay (ms) */
  debounce?: number;
}

// ============================================================================
// TRANSLATIONS
// ============================================================================

export interface FieldTranslations {
  /** Label translations */
  label?: Record<string, string>;
  
  /** Placeholder translations */
  placeholder?: Record<string, string>;
  
  /** Help text translations */
  helpText?: Record<string, string>;
  
  /** Validation message translations */
  validation?: Record<string, Record<string, string>>;
}

export interface TranslationConfig {
  /** Available locales */
  locales: string[];
  
  /** Default locale */
  defaultLocale: string;
  
  /** Translation key prefix */
  keyPrefix?: string;
  
  /** Global translations (for common terms) */
  global?: Record<string, Record<string, string>>;
}

// ============================================================================
// STYLING
// ============================================================================

export interface StyleOverrides {
  /** Input element CSS classes */
  inputClass?: string;
  
  /** Label element CSS classes */
  labelClass?: string;
  
  /** Container CSS classes */
  containerClass?: string;
  
  /** Error message CSS classes */
  errorClass?: string;
  
  /** Help text CSS classes */
  helpTextClass?: string;
}

export interface ThemeConfig {
  /** Color palette overrides */
  colorPalette?: ColorPalette;
  
  /** Component variant overrides */
  componentVariants?: ComponentVariants;
  
  /** Dark mode support */
  darkMode?: boolean;
  
  /** Custom CSS variables */
  cssVariables?: Record<string, string>;
}

export interface ColorPalette {
  primary?: string;
  secondary?: string;
  success?: string;
  warning?: string;
  error?: string;
  info?: string;
  background?: string;
  foreground?: string;
  border?: string;
}

export interface ComponentVariants {
  button?: 'default' | 'outline' | 'ghost' | 'link';
  input?: 'default' | 'bordered' | 'filled';
  card?: 'default' | 'elevated' | 'outlined';
}

// ============================================================================
// GRID CONFIGURATION (Array Fields)
// ============================================================================

export interface GridConfig {
  /** Enable add button */
  enableAdd: boolean;
  
  /** Enable edit button */
  enableEdit: boolean;
  
  /** Enable delete button */
  enableDelete: boolean;
  
  /** Enable bulk edit */
  enableBulkEdit: boolean;
  
  /** Enable bulk delete */
  enableBulkDelete?: boolean;
  
  /** Column definitions */
  columns: GridColumn[];
  
  /** Default sort column */
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
  
  /** Enable pagination */
  enablePagination?: boolean;
  
  /** Rows per page */
  rowsPerPage?: number;
  
  /** Enable row selection */
  enableSelection?: boolean;
}

export interface GridColumn {
  /** Field path */
  field: string;
  
  /** Column header */
  header: string;
  
  /** Column width (px or %) */
  width?: number | string;
  
  /** Whether column is sortable */
  sortable?: boolean;
  
  /** Whether column is filterable */
  filterable?: boolean;
  
  /** Whether column is editable (inline edit) */
  editable?: boolean;
  
  /** Whether column is resizable */
  resizable?: boolean;
  
  /** Cell renderer (for custom formatting) */
  cellRenderer?: string;
  
  /** Alignment */
  align?: 'left' | 'center' | 'right';
}

// ============================================================================
// PERMISSIONS (RBAC)
// ============================================================================

export interface FieldPermissions {
  /** Roles that can read this field */
  read?: string[];
  
  /** Roles that can write this field */
  write?: string[];
  
  /** Roles that should see masked value */
  maskFor?: string[];
  
  /** Masking character */
  maskChar?: string;
}

export interface PermissionConfig {
  /** Role definitions */
  roles: Record<string, RolePermissions>;
  
  /** Default role (if user has no specific role) */
  defaultRole?: string;
}

export interface RolePermissions {
  /** Role display name */
  name: string;
  
  /** Sections accessible by this role */
  sections?: string[];
  
  /** Tabs accessible by this role */
  tabs?: string[];
  
  /** Actions accessible by this role */
  actions?: string[];
}

// ============================================================================
// VALIDATION CONFIGURATION
// ============================================================================

export interface ValidationConfig {
  /** Cross-field validation rules */
  crossFieldRules?: CrossFieldRule[];
  
  /** Validation strategy */
  strategy?: ValidationStrategy;
}

export interface CrossFieldRule {
  /** Unique rule identifier */
  ruleId: string;
  
  /** Rule type */
  type: 'date-range' | 'value-sum' | 'value-consistency' | 'custom';
  
  /** Fields involved in validation */
  fields: string[];
  
  /** Validation expression/rule */
  rule: string;
  
  /** Error message */
  message: string;
  
  /** Severity level */
  level: 'error' | 'warning' | 'info';
}

export interface ValidationStrategy {
  /** Enable real-time validation */
  realTime: boolean;
  
  /** Trigger events for real-time validation */
  triggerOn?: ('blur' | 'change' | 'focus')[];
  
  /** Debounce delay (ms) */
  debounce?: number;
  
  /** Validation types to run in real-time */
  realTimeTypes?: string[];
  
  /** Enable submit-time validation */
  onSubmit: boolean;
  
  /** Stop on first error */
  stopOnFirstError?: boolean;
  
  /** Scroll to first error */
  scrollToFirstError?: boolean;
}

// ============================================================================
// CONDITIONAL LOGIC CONFIGURATION
// ============================================================================

export interface ConditionalLogicConfig {
  /** Global conditional rules */
  rules: ConditionalRule[];
  
  /** Enable debug mode */
  debug?: boolean;
}

export interface ConditionalRule {
  /** Rule identifier */
  ruleId: string;
  
  /** Target field(s) affected by this rule */
  targetFields: string[];
  
  /** Action to perform when condition is met */
  action: 'show' | 'hide' | 'enable' | 'disable' | 'require' | 'setValue';
  
  /** Condition to evaluate */
  condition: ConditionalExpression;
  
  /** Value to set (for setValue action) */
  value?: any;
}
