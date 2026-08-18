/**
 * Complex Object Configuration Panel
 * 
 * Shows layout type options for complex objects/arrays.
 * Saves layout choice immediately on selection.
 */

"use client";

import React from "react";
import { X } from "lucide-react";

interface ComplexObjectConfigPanelProps {
  fieldPath: string;
  fieldSchema: any;
  onSave: (layoutType: 'panel' | 'tabsheet' | 'tab' | 'card') => void;
  onCancel: () => void;
}

const LAYOUT_TYPES = [
  {
    value: 'panel' as const,
    label: 'Panel',
    description: 'Collapsible panel within a section',
    icon: '📋',
    bestFor: 'Single object with few fields'
  },
  {
    value: 'tabsheet' as const,
    label: 'TabSheet',
    description: 'Creates multiple tabs (one per child property)',
    icon: '📑',
    bestFor: 'Parent with multiple complex children (e.g., Traders → Consignor/Consignee/Seller/Buyer tabs)'
  },
  {
    value: 'tab' as const,
    label: 'Tab',
    description: 'Creates a single tab for this object',
    icon: '📄',
    bestFor: 'One section in a multi-tab form'
  },
  {
    value: 'card' as const,
    label: 'Card',
    description: 'Card layout for the object',
    icon: '🎴',
    bestFor: 'Visual emphasis, dashboard-style'
  }
];

export default function ComplexObjectConfigPanel({
  fieldPath,
  fieldSchema,
  onSave,
  onCancel
}: ComplexObjectConfigPanelProps) {
  const [selectedLayout, setSelectedLayout] = React.useState<'panel' | 'tabsheet' | 'tab' | 'card' | null>(null);
  
  const handleSelectLayout = (layoutType: 'panel' | 'tabsheet' | 'tab' | 'card') => {
    setSelectedLayout(layoutType);
    onSave(layoutType);
  };

  // Count children
  const childCount = fieldSchema.properties 
    ? Object.keys(fieldSchema.properties).length 
    : 0;

  const isArray = fieldSchema.type === 'array' || fieldSchema.items;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-border bg-surface-muted px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-ink">Layout Configuration</h2>
            <p className="text-xs text-ink-muted mt-1">
              Configure layout for complex object
            </p>
          </div>
          <button 
            onClick={onCancel} 
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Path Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">📁</div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-blue-900">Complex Object Selected</h3>
                <p className="text-xs text-blue-700 mt-1 font-mono">{fieldPath}</p>
                <div className="flex gap-4 mt-2 text-[10px] text-blue-600">
                  <span>• {childCount} properties</span>
                  {isArray && <span>• Array/List type</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Layout Type Selection */}
          <div>
            <label className="block text-sm font-semibold text-ink mb-3">
              Choose Layout Type
            </label>
            <div className="space-y-3">
              {LAYOUT_TYPES.map((layout) => (
                <button
                  key={layout.value}
                  onClick={() => handleSelectLayout(layout.value)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    selectedLayout === layout.value
                      ? 'border-brand bg-blue-50'
                      : 'border-border bg-white hover:border-brand hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{layout.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`text-sm font-semibold ${
                          selectedLayout === layout.value ? 'text-brand' : 'text-ink'
                        }`}>
                          {layout.label}
                        </h4>
                        {selectedLayout === layout.value && (
                          <span className="text-xs px-2 py-0.5 bg-green-600 text-white rounded-full">
                            ✓ Selected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-1">{layout.description}</p>
                      <p className="text-[10px] text-green-700 mt-1 font-medium">
                        💡 Best for: {layout.bestFor}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
