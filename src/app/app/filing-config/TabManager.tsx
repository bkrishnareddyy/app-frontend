"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Edit2, Eye, EyeOff, FileText, Folder, GripVertical, Plus, Trash2 } from "lucide-react";
import type { FilingUIConfigData, UITab, UISection } from "@/types/ui-config.types";
import { addTab, removeTab, updateTab } from "@/lib/ui-config/config-builder";

interface TabManagerProps {
  config: FilingUIConfigData;
  onChange: (config: FilingUIConfigData) => void;
  onSelectTab?: (tabId: string) => void;
  selectedTabId?: string | null;
}

interface TabFormData {
  title: string;
  description: string;
  icon: string;
  isVisible: boolean;
  displayOrder: number;
}

function idOf(tab: UITab): string {
  return tab.tabId ?? tab.id ?? "";
}

function titleOf(tab: UITab): string {
  return tab.label ?? tab.title ?? idOf(tab);
}

function orderOf(tab: UITab): number {
  return tab.tabOrder ?? tab.displayOrder ?? 0;
}

function sectionIdOf(section: UISection): string {
  return section.sectionId ?? section.id ?? "";
}

function makeTabId(title: string, tabs: UITab[]): string {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tab";
  const existing = new Set(tabs.map(idOf));
  if (!existing.has(`tab-${base}`)) return `tab-${base}`;
  let suffix = 2;
  while (existing.has(`tab-${base}-${suffix}`)) suffix += 1;
  return `tab-${base}-${suffix}`;
}

export default function TabManager({ config, onChange, onSelectTab, selectedTabId }: TabManagerProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTab, setEditingTab] = useState<UITab | null>(null);
  const [formData, setFormData] = useState<TabFormData>({
    title: "",
    description: "",
    icon: "folder",
    isVisible: true,
    displayOrder: 0,
  });

  const tabs = [...(config.tabs ?? [])].sort((a, b) => orderOf(a) - orderOf(b));

  const getTabSections = (tabId: string): UISection[] => {
    const linkedIds = new Set(tabs.find((tab) => idOf(tab) === tabId)?.sections ?? []);
    return config.sections.filter((section) => section.tabId === tabId || linkedIds.has(sectionIdOf(section)));
  };

  const getTabFieldCount = (tabId: string): number => {
    const sectionIds = new Set(getTabSections(tabId).map(sectionIdOf));
    return config.fields.filter((field) => sectionIds.has(field.sectionId ?? field.section)).length;
  };

  const resetForm = () => {
    setFormData({ title: "", description: "", icon: "folder", isVisible: true, displayOrder: 0 });
  };

  const handleAddTab = () => {
    const id = makeTabId(formData.title, tabs);
    onChange(addTab(config, {
      tabId: id,
      id,
      label: formData.title,
      title: formData.title,
      description: formData.description,
      icon: formData.icon,
      tabOrder: tabs.length,
      displayOrder: tabs.length,
      isVisible: formData.isVisible,
    }));
    setShowAddModal(false);
    resetForm();
  };

  const handleEditTab = () => {
    if (!editingTab) return;
    const id = idOf(editingTab);
    onChange(updateTab(config, id, {
      label: formData.title,
      title: formData.title,
      description: formData.description,
      icon: formData.icon,
      isVisible: formData.isVisible,
    }));
    setShowEditModal(false);
    setEditingTab(null);
    resetForm();
  };

  const handleRemoveTab = (tabId: string) => {
    const tab = tabs.find((candidate) => idOf(candidate) === tabId);
    const sectionCount = getTabSections(tabId).length;
    const message = sectionCount > 0
      ? `Delete tab "${tab ? titleOf(tab) : tabId}"? This will remove ${sectionCount} linked section(s) from this configuration.`
      : `Delete tab "${tab ? titleOf(tab) : tabId}"?`;
    if (window.confirm(message)) onChange(removeTab(config, tabId));
  };

  const handleMoveTab = (tabId: string, direction: "up" | "down") => {
    const currentIndex = tabs.findIndex((tab) => idOf(tab) === tabId);
    if (currentIndex === -1) return;
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= tabs.length) return;

    const current = tabs[currentIndex];
    const target = tabs[newIndex];
    const currentOrder = orderOf(current);
    const targetOrder = orderOf(target);
    let next = updateTab(config, idOf(current), { tabOrder: targetOrder, displayOrder: targetOrder });
    next = updateTab(next, idOf(target), { tabOrder: currentOrder, displayOrder: currentOrder });
    onChange(next);
  };

  const openEditModal = (tab: UITab) => {
    setEditingTab(tab);
    setFormData({
      title: titleOf(tab),
      description: tab.description || "",
      icon: tab.icon || "folder",
      isVisible: tab.isVisible !== false,
      displayOrder: orderOf(tab),
    });
    setShowEditModal(true);
  };

  const toggleTabVisibility = (tabId: string) => {
    const tab = tabs.find((candidate) => idOf(candidate) === tabId);
    if (!tab) return;
    onChange(updateTab(config, tabId, { isVisible: !tab.isVisible }));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink">Tabs</h3>
            <p className="text-xs text-ink-muted mt-0.5">{tabs.length} tab{tabs.length !== 1 ? "s" : ""} configured</p>
          </div>
          <Button onClick={() => setShowAddModal(true)} variant="primary" size="sm"><Plus className="w-4 h-4 mr-2" />Add Tab</Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {tabs.length === 0 ? (
          <div className="text-center py-12 text-ink-muted">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No tabs configured</p>
            <p className="text-xs mt-1">Click &quot;Add Tab&quot; to create your first tab</p>
          </div>
        ) : tabs.map((tab, index) => {
          const tabId = idOf(tab);
          const sectionCount = getTabSections(tabId).length;
          const fieldCount = getTabFieldCount(tabId);
          const isSelected = selectedTabId === tabId;
          return (
            <div key={tabId} className={`border rounded-lg p-3 bg-white transition-all cursor-pointer ${isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50"}`} onClick={() => onSelectTab?.(tabId)}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 pt-1">
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleMoveTab(tabId, "up"); }} disabled={index === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed" title="Move up"><GripVertical className="w-4 h-4" /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleMoveTab(tabId, "down"); }} disabled={index === tabs.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed" title="Move down"><GripVertical className="w-4 h-4 rotate-180" /></button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Folder className="w-4 h-4 text-primary shrink-0" />
                    <h4 className="text-sm font-semibold text-ink truncate">{titleOf(tab)}</h4>
                    {!tab.isVisible && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Hidden</span>}
                  </div>
                  {tab.description && <p className="text-xs text-ink-muted mb-2 line-clamp-2">{tab.description}</p>}
                  <div className="flex items-center gap-4 text-xs text-ink-muted">
                    <span className="flex items-center gap-1"><Folder className="w-3 h-3" />{sectionCount} section{sectionCount !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{fieldCount} field{fieldCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggleTabVisibility(tabId); }} className="p-1.5 hover:bg-gray-100 rounded transition-colors" title={tab.isVisible ? "Hide tab" : "Show tab"}>{tab.isVisible ? <Eye className="w-4 h-4 text-gray-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); openEditModal(tab); }} className="p-1.5 hover:bg-blue-50 rounded transition-colors" title="Edit tab"><Edit2 className="w-4 h-4 text-blue-600" /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveTab(tabId); }} className="p-1.5 hover:bg-red-50 rounded transition-colors" title="Delete tab"><Trash2 className="w-4 h-4 text-red-600" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <TabModal
        isOpen={showAddModal}
        title="Add New Tab"
        formData={formData}
        setFormData={setFormData}
        onClose={() => { setShowAddModal(false); resetForm(); }}
        onSubmit={handleAddTab}
        submitLabel="Add Tab"
        showAddIcon
      />
      <TabModal
        isOpen={showEditModal}
        title="Edit Tab"
        formData={formData}
        setFormData={setFormData}
        onClose={() => { setShowEditModal(false); setEditingTab(null); resetForm(); }}
        onSubmit={handleEditTab}
        submitLabel="Save Changes"
      />
    </div>
  );
}

function TabModal({
  isOpen,
  title,
  formData,
  setFormData,
  onClose,
  onSubmit,
  submitLabel,
  showAddIcon = false,
}: {
  isOpen: boolean;
  title: string;
  formData: TabFormData;
  setFormData: React.Dispatch<React.SetStateAction<TabFormData>>;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  showAddIcon?: boolean;
}) {
  const titleId = title === "Add New Tab" ? "add-tab-modal" : "edit-tab-modal";
  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId={titleId}>
      <ModalHeader titleId={titleId}><h2 className="text-lg font-bold text-ink">{title}</h2></ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink block mb-1">Tab Title <span className="text-red-600">*</span></label>
            <Input value={formData.title} onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))} placeholder="e.g., General Information, Parties, Goods" className="text-xs" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink block mb-1">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Brief description of what this tab contains" className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" rows={3} />
          </div>
          <div>
            <label className="text-xs font-medium text-ink block mb-1">Icon Name</label>
            <Input value={formData.icon} onChange={(e) => setFormData((prev) => ({ ...prev, icon: e.target.value }))} placeholder="folder, file, users, package" className="text-xs" />
            <p className="text-xs text-ink-muted mt-1">Lucide icon name (optional)</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={formData.isVisible} onChange={(e) => setFormData((prev) => ({ ...prev, isVisible: e.target.checked }))} className="w-4 h-4 text-primary border-border rounded" aria-label="Visible by default" />
            <span className="text-xs font-medium text-ink">Visible by default</span>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={!formData.title.trim()}>{showAddIcon && <Plus className="w-4 h-4 mr-2" />}{submitLabel}</Button>
      </ModalFooter>
    </Modal>
  );
}
