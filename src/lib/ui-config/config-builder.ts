import type {
  FieldConfig,
  FilingUIConfigData,
  LayoutMode,
  UIPanel,
  UISection,
  UITab,
} from "@/types/ui-config.types";

export interface CreateConfigOptions {
  country: string;
  procedure: string;
  message: string;
  title?: string;
  description?: string;
  layoutMode?: LayoutMode;
  tags?: string[];
}

export function createEmptyConfig(options: CreateConfigOptions): FilingUIConfigData {
  const { country, procedure, message, title, description, layoutMode = "single-page", tags } = options;
  return {
    version: "1.0.0",
    metadata: {
      title: title || `${country} ${procedure} ${message} Configuration`,
      description: description || `UI configuration for ${country} ${procedure} ${message}`,
      tags: tags?.length ? tags : [country, procedure, message],
      lastModifiedAt: new Date().toISOString(),
    },
    layout: { mode: layoutMode, tabPosition: "top", defaultColumns: 2 },
    tabs: layoutMode === "tabs" ? [] : undefined,
    sections: [],
    panels: [],
    fields: [],
    validation: {
      crossFieldRules: [],
      strategy: {
        realTime: true,
        triggerOn: ["blur", "change"],
        debounce: 300,
        onSubmit: true,
        stopOnFirstError: false,
        scrollToFirstError: true,
      },
    },
    conditionalLogic: { rules: [], debug: false },
    translations: { locales: ["en"], defaultLocale: "en" },
    permissions: { roles: {}, defaultRole: "operator" },
  };
}

export interface AddTabOptions extends Partial<UITab> {
  tabId?: string;
  id?: string;
  label?: string;
  title?: string;
}

function tabIdOf(tab: UITab): string {
  return tab.tabId;
}

function sectionIdOf(section: UISection): string {
  return section.sectionId;
}

export function addTab(config: FilingUIConfigData, options: AddTabOptions): FilingUIConfigData {
  if (!config.tabs) config.tabs = [];
  const tabId = options.tabId ?? options.id;
  if (!tabId) throw new Error("Tab ID is required");
  if (config.tabs.some((tab) => tabIdOf(tab) === tabId)) throw new Error(`Tab with ID "${tabId}" already exists`);

  const label = options.label ?? options.title ?? tabId;
  const tabOrder = options.tabOrder ?? options.displayOrder ?? (config.tabs.length + 1) * 10;
  const tab: UITab = {
    tabId,
    id: tabId,
    label,
    title: label,
    icon: options.icon,
    tabOrder,
    displayOrder: tabOrder,
    isVisible: options.isVisible ?? true,
    sections: options.sections ?? [],
    description: options.description,
  };
  config.tabs.push(tab);
  config.tabs.sort((a, b) => a.tabOrder - b.tabOrder);
  return { ...config, tabs: [...config.tabs] };
}

export function removeTab(config: FilingUIConfigData, tabId: string): FilingUIConfigData {
  if (!config.tabs) return { ...config };
  const tab = config.tabs.find((candidate) => tabIdOf(candidate) === tabId);
  if (!tab) throw new Error(`Tab with ID "${tabId}" not found`);

  const linkedSectionIds = new Set(tab.sections);
  config.tabs = config.tabs.filter((candidate) => tabIdOf(candidate) !== tabId);
  config.sections = config.sections.filter((section) => section.tabId !== tabId && !linkedSectionIds.has(sectionIdOf(section)));
  const survivingSections = new Set(config.sections.map(sectionIdOf));
  config.fields = config.fields.filter((field) => survivingSections.has(field.sectionId ?? field.section));
  return { ...config, tabs: [...config.tabs], sections: [...config.sections], fields: [...config.fields] };
}

export function updateTab(config: FilingUIConfigData, tabId: string, updates: Partial<UITab>): FilingUIConfigData {
  if (!config.tabs) throw new Error("No tabs in configuration");
  const tabIndex = config.tabs.findIndex((tab) => tabIdOf(tab) === tabId);
  if (tabIndex === -1) throw new Error(`Tab with ID "${tabId}" not found`);

  const current = config.tabs[tabIndex];
  const nextLabel = updates.label ?? updates.title ?? current.label;
  const nextOrder = updates.tabOrder ?? updates.displayOrder ?? current.tabOrder;
  const nextId = updates.tabId ?? updates.id ?? current.tabId;
  const updated: UITab = {
    ...current,
    ...updates,
    tabId: nextId,
    id: nextId,
    label: nextLabel,
    title: nextLabel,
    tabOrder: nextOrder,
    displayOrder: nextOrder,
    sections: updates.sections ?? current.sections,
  };
  const tabs = [...config.tabs];
  tabs[tabIndex] = updated;
  return { ...config, tabs };
}

export function linkSectionToTab(config: FilingUIConfigData, sectionId: string, tabId: string): void {
  if (!config.tabs) throw new Error("Configuration has no tabs");
  const tab = config.tabs.find((candidate) => tabIdOf(candidate) === tabId);
  if (!tab) throw new Error(`Tab with ID "${tabId}" not found`);
  const section = config.sections.find((candidate) => sectionIdOf(candidate) === sectionId);
  if (!section) throw new Error(`Section with ID "${sectionId}" not found`);

  for (const candidate of config.tabs) candidate.sections = candidate.sections.filter((id) => id !== sectionId);
  if (!tab.sections.includes(sectionId)) tab.sections.push(sectionId);
  section.tabId = tabId;
}

export interface AddSectionOptions {
  sectionId: string;
  title: string;
  layout?: "grid" | "panels" | "cards" | "list";
  columns?: number;
  sectionOrder?: number;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  description?: string;
  tabId?: string;
}

export function addSection(config: FilingUIConfigData, options: AddSectionOptions): void {
  if (config.sections.some((section) => sectionIdOf(section) === options.sectionId)) throw new Error(`Section with ID "${options.sectionId}" already exists`);
  const order = options.sectionOrder ?? (config.sections.length + 1) * 10;
  const section: UISection = {
    sectionId: options.sectionId,
    id: options.sectionId,
    tabId: options.tabId,
    title: options.title,
    sectionOrder: order,
    displayOrder: order,
    layout: options.layout ?? "grid",
    columns: options.columns ?? 2,
    isVisible: true,
    isCollapsible: options.isCollapsible ?? false,
    defaultExpanded: options.defaultExpanded ?? true,
    fields: [],
    description: options.description,
  };
  config.sections.push(section);
  config.sections.sort((a, b) => a.sectionOrder - b.sectionOrder);
  if (options.tabId) linkSectionToTab(config, options.sectionId, options.tabId);
}

export function removeSection(config: FilingUIConfigData, sectionId: string): void {
  const index = config.sections.findIndex((section) => sectionIdOf(section) === sectionId);
  if (index === -1) throw new Error(`Section with ID "${sectionId}" not found`);
  config.sections.splice(index, 1);
  config.tabs?.forEach((tab) => { tab.sections = tab.sections.filter((id) => id !== sectionId); });
  config.fields = config.fields.filter((field) => (field.sectionId ?? field.section) !== sectionId);
  if (config.panels) config.panels = config.panels.filter((panel) => panel.sectionId !== sectionId);
}

export interface AddPanelOptions {
  panelId: string;
  sectionId: string;
  title: string;
  panelOrder?: number;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
  borderStyle?: "solid" | "dashed" | "none";
}

export function addPanel(config: FilingUIConfigData, options: AddPanelOptions): void {
  if (!config.panels) config.panels = [];
  if (config.panels.some((panel) => panel.panelId === options.panelId)) throw new Error(`Panel with ID "${options.panelId}" already exists`);
  const section = config.sections.find((candidate) => sectionIdOf(candidate) === options.sectionId);
  if (!section) throw new Error(`Section with ID "${options.sectionId}" not found`);
  const panel: UIPanel = {
    panelId: options.panelId,
    sectionId: options.sectionId,
    title: options.title,
    panelOrder: options.panelOrder ?? (config.panels.filter((p) => p.sectionId === options.sectionId).length + 1) * 10,
    isCollapsible: options.isCollapsible ?? true,
    defaultExpanded: options.defaultExpanded ?? true,
    borderStyle: options.borderStyle ?? "solid",
    fields: [],
  };
  config.panels.push(panel);
  section.layout = "panels";
  section.panels = section.panels ?? [];
  if (!section.panels.includes(options.panelId)) section.panels.push(options.panelId);
  config.panels.sort((a, b) => a.panelOrder - b.panelOrder);
}

export function removePanel(config: FilingUIConfigData, panelId: string): void {
  if (!config.panels) return;
  const panel = config.panels.find((candidate) => candidate.panelId === panelId);
  if (!panel) throw new Error(`Panel with ID "${panelId}" not found`);
  config.panels = config.panels.filter((candidate) => candidate.panelId !== panelId);
  const section = config.sections.find((candidate) => sectionIdOf(candidate) === panel.sectionId);
  if (section?.panels) section.panels = section.panels.filter((id) => id !== panelId);
  config.fields.forEach((field) => { if (field.panelId === panelId) field.panelId = undefined; });
}

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

export function addField(config: FilingUIConfigData, options: AddFieldOptions): void {
  if (config.fields.some((field) => field.fieldPath === options.fieldPath)) throw new Error(`Field with path "${options.fieldPath}" already exists`);
  const section = config.sections.find((candidate) => sectionIdOf(candidate) === options.section);
  if (!section) throw new Error(`Section with ID "${options.section}" not found`);
  if (options.panelId) {
    const panel = config.panels?.find((candidate) => candidate.panelId === options.panelId);
    if (!panel) throw new Error(`Panel with ID "${options.panelId}" not found`);
    if (panel.sectionId !== options.section) throw new Error(`Panel "${options.panelId}" does not belong to section "${options.section}"`);
  }

  const field: FieldConfig = {
    fieldPath: options.fieldPath,
    fieldLabel: options.fieldLabel,
    fieldType: options.fieldType,
    section: options.section,
    sectionId: options.section,
    panelId: options.panelId,
    displayOrder: options.displayOrder ?? (config.fields.filter((item) => (item.sectionId ?? item.section) === options.section).length + 1) * 10,
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
  if (!section.fields.includes(options.fieldPath)) section.fields.push(options.fieldPath);
  if (options.panelId) {
    const panel = config.panels?.find((candidate) => candidate.panelId === options.panelId);
    if (panel && !panel.fields.includes(options.fieldPath)) panel.fields.push(options.fieldPath);
  }
  config.fields.sort((a, b) => a.displayOrder - b.displayOrder);
}

export function removeField(config: FilingUIConfigData, fieldPath: string): void {
  const field = config.fields.find((candidate) => candidate.fieldPath === fieldPath);
  if (!field) throw new Error(`Field with path "${fieldPath}" not found`);
  config.fields = config.fields.filter((candidate) => candidate.fieldPath !== fieldPath);
  const section = config.sections.find((candidate) => sectionIdOf(candidate) === (field.sectionId ?? field.section));
  if (section) section.fields = section.fields.filter((path) => path !== fieldPath);
  if (field.panelId) {
    const panel = config.panels?.find((candidate) => candidate.panelId === field.panelId);
    if (panel) panel.fields = panel.fields.filter((path) => path !== fieldPath);
  }
}

export function updateField(config: FilingUIConfigData, fieldPath: string, updates: Partial<FieldConfig>): void {
  const field = config.fields.find((candidate) => candidate.fieldPath === fieldPath);
  if (!field) throw new Error(`Field with path "${fieldPath}" not found`);
  const oldSectionId = field.sectionId ?? field.section;
  Object.assign(field, updates);
  const nextSectionId = updates.sectionId ?? updates.section;
  if (nextSectionId && nextSectionId !== oldSectionId) {
    const oldSection = config.sections.find((candidate) => sectionIdOf(candidate) === oldSectionId);
    if (oldSection) oldSection.fields = oldSection.fields.filter((path) => path !== fieldPath);
    const newSection = config.sections.find((candidate) => sectionIdOf(candidate) === nextSectionId);
    if (newSection && !newSection.fields.includes(fieldPath)) newSection.fields.push(fieldPath);
    field.section = nextSectionId;
    field.sectionId = nextSectionId;
  }
}

export function cloneConfig(config: FilingUIConfigData): FilingUIConfigData {
  return JSON.parse(JSON.stringify(config));
}

export function getField(config: FilingUIConfigData, fieldPath: string): FieldConfig | undefined {
  return config.fields.find((field) => field.fieldPath === fieldPath);
}

export function getFieldsBySection(config: FilingUIConfigData, sectionId: string): FieldConfig[] {
  return config.fields.filter((field) => (field.sectionId ?? field.section) === sectionId);
}

export function getFieldsByPanel(config: FilingUIConfigData, panelId: string): FieldConfig[] {
  return config.fields.filter((field) => field.panelId === panelId);
}

export function getSection(config: FilingUIConfigData, sectionId: string): UISection | undefined {
  return config.sections.find((section) => sectionIdOf(section) === sectionId);
}

export function getTab(config: FilingUIConfigData, tabId: string): UITab | undefined {
  return config.tabs?.find((tab) => tabIdOf(tab) === tabId);
}

export function getPanel(config: FilingUIConfigData, panelId: string): UIPanel | undefined {
  return config.panels?.find((panel) => panel.panelId === panelId);
}
