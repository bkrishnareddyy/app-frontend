/**
 * TabManager Component
 * 
 * Manages tabs in the UI configuration system.
 * Features:
 * - Add/edit/remove tabs
 * - Drag-and-drop reordering
 * - Link sections to tabs
 * - Display tab statistics
 * - Validation indicators
 */

"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { 
  Plus, 
  Edit2, 
  Trash2, 
  GripVertical, 
  Eye, 
  EyeOff,
  AlertCircle,
  CheckCircle,
  Folder,
  FileText
} from "lucide-react";

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

export default function TabManager({ 
  config, 
  onChange, 
  onSelectTab,
  selectedTabId 
}: TabManagerProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTab, setEditingTab] = useState<UITab | null>(null);
  const [formData, setFormData] = useState<TabFormData>({
    title: "",
    description: "",
    icon: "folder",
    isVisible: true,
    displayOrder: 0
  });

  // Get tabs sorted by display order
  const tabs = config.tabs?.sort((a, b) => a.displayOrder - b.displayOrder) || [];

  // Get sections linked to each tab
  const getTabSections = (tabId: string): UISection[] => {
    return config.sections.filter(section => section.tabId === tabId);
  };

  // Get field count for a tab
  const getTabFieldCount = (tabId: string): number => {
    const tabSections = getTabSections(tabId);
    const sectionIds = tabSections.map(s => s.id);
    return config.fields.filter(f => sectionIds.includes(f.sectionId)).length;
  };

  // Handle add tab
  const handleAddTab = () => {
    const newTab: Partial<UITab> = {
      id: `tab-${Date.now()}`,
      title: formData.title,
      description: formData.description,
      icon: formData.icon,
      displayOrder: tabs.length,
      isVisible: formData.isVisible
    };

    const updatedConfig = addTab(config, newTab);
    onChange(updatedConfig);
    
    setShowAddModal(false);
    resetForm();
  };

  // Handle edit tab
  const handleEditTab = () => {
    if (!editingTab) return;

    const updatedConfig = updateTab(config, editingTab.id, {
      title: formData.title,
      description: formData.description,
      icon: formData.icon,
      isVisible: formData.isVisible
    });

    onChange(updatedConfig);
    setShowEditModal(false);
    setEditingTab(null);
    resetForm();
  };

  // Handle remove tab
  const handleRemoveTab = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    const sectionCount = getTabSections(tabId).length;
    
    const message = sectionCount > 0
      ? `Delete tab "${tab?.title}"? This will unlink ${sectionCount} section(s). Sections won't be deleted.`
      : `Delete tab "${tab?.title}"?`;

    if (confirm(message)) {
      const updatedConfig = removeTab(config, tabId);
      onChange(updatedConfig);
    }
  };

  // Handle reorder (simple version - move up/down)
  const handleMoveTab = (tabId: string, direction: 'up' | 'down') => {
    const currentIndex = tabs.findIndex(t => t.id === tabId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= tabs.length) return;

    // Swap display orders
    const updatedConfig = { ...config };
    const tempOrder = updatedConfig.tabs![currentIndex].displayOrder;
    updatedConfig.tabs![currentIndex].displayOrder = updatedConfig.tabs![newIndex].displayOrder;
    updatedConfig.tabs![newIndex].displayOrder = tempOrder;

    onChange(updatedConfig);
  };

  // Open edit modal
  const openEditModal = (tab: UITab) => {
    setEditingTab(tab);
    setFormData({
      title: tab.title,
      description: tab.description || "",
      icon: tab.icon || "folder",
      isVisible: tab.isVisible !== false,
      displayOrder: tab.displayOrder
    });
    setShowEditModal(true);
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      icon: "folder",
      isVisible: true,
      displayOrder: 0
    });
  };

  // Toggle tab visibility
  const toggleTabVisibility = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    const updatedConfig = updateTab(config, tabId, {
      isVisible: !tab.isVisible
    });
    onChange(updatedConfig);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink">Tabs</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {tabs.length} tab{tabs.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          <Button
            onClick={() => setShowAddModal(true)}
            variant="primary"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Tab
          </Button>
        </div>
      </div>

      {/* Tab List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {tabs.length === 0 ? (
          <div className="text-center py-12 text-ink-muted">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No tabs configured</p>
            <p className="text-xs mt-1">Click "Add Tab" to create your first tab</p>
          </div>
        ) : (
          tabs.map((tab, index) => {
            const sectionCount = getTabSections(tab.id).length;
            const fieldCount = getTabFieldCount(tab.id);
            const isSelected = selectedTabId === tab.id;

            return (
              <div
                key={tab.id}
                className={`
                  border rounded-lg p-3 bg-white transition-all cursor-pointer
                  ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}
                `}
                onClick={() => onSelectTab?.(tab.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Drag handle */}
                  <div className="flex flex-col gap-1 pt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveTab(tab.id, 'up');
                      }}
                      disabled={index === 0}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveTab(tab.id, 'down');
                      }}
                      disabled={index === tabs.length - 1}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <GripVertical className="w-4 h-4 rotate-180" />
                    </button>
                  </div>

                  {/* Tab info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Folder className="w-4 h-4 text-primary shrink-0" />
                      <h4 className="text-sm font-semibold text-ink truncate">
                        {tab.title}
                      </h4>
                      {!tab.isVisible && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          Hidden
                        </span>
                      )}
                    </div>
                    {tab.description && (
                      <p className="text-xs text-ink-muted mb-2 line-clamp-2">
                        {tab.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-ink-muted">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {fieldCount} field{fieldCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabVisibility(tab.id);
                      }}
                      className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                      title={tab.isVisible ? "Hide tab" : "Show tab"}
                    >
                      {tab.isVisible ? (
                        <Eye className="w-4 h-4 text-gray-600" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(tab);
                      }}
                      className="p-1.5 hover:bg-blue-50 rounded transition-colors"
                      title="Edit tab"
                    >
                      <Edit2 className="w-4 h-4 text-blue-600" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTab(tab.id);
                      }}
                      className="p-1.5 hover:bg-red-50 rounded transition-colors"
                      title="Delete tab"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Tab Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} titleId="add-tab-modal">
        <ModalHeader titleId="add-tab-modal">
          <h2 className="text-lg font-bold text-ink">Add New Tab</h2>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Tab Title <span className="text-red-600">*</span>
              </label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., General Information, Parties, Goods"
                className="text-xs"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of what this tab contains"
                className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Icon Name
              </label>
              <Input
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="folder, file, users, package"
                className="text-xs"
              />
              <p className="text-xs text-ink-muted mt-1">
                Lucide icon name (optional)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tab-visible"
                checked={formData.isVisible}
                onChange={(e) => setFormData({ ...formData, isVisible: e.target.checked })}
                className="w-4 h-4 text-primary border-border rounded"
              />
              <label htmlFor="tab-visible" className="text-xs font-medium text-ink">
                Visible by default
              </label>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddTab}
            disabled={!formData.title.trim()}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Tab
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Tab Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} titleId="edit-tab-modal">
        <ModalHeader titleId="edit-tab-modal">
          <h2 className="text-lg font-bold text-ink">Edit Tab</h2>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Tab Title <span className="text-red-600">*</span>
              </label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., General Information, Parties, Goods"
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of what this tab contains"
                className="w-full px-3 py-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink block mb-1">
                Icon Name
              </label>
              <Input
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="folder, file, users, package"
                className="text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tab-visible-edit"
                checked={formData.isVisible}
                onChange={(e) => setFormData({ ...formData, isVisible: e.target.checked })}
                className="w-4 h-4 text-primary border-border rounded"
              />
              <label htmlFor="tab-visible-edit" className="text-xs font-medium text-ink">
                Visible by default
              </label>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleEditTab}
            disabled={!formData.title.trim()}
          >
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
