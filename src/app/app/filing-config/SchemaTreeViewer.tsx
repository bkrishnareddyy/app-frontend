/**
 * JSON Schema Tree Viewer Component
 * 
 * Displays canonical JSON schema as an interactive tree structure.
 * Users can expand/collapse nodes, select fields to configure.
 */

"use client";

import React, { useState } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, List } from "lucide-react";

interface SchemaProperty {
  type: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  $ref?: string;
}

interface SchemaTreeNode {
  path: string;
  name: string;
  type: string;
  isRequired: boolean;
  isArray: boolean;
  description?: string;
  children?: SchemaTreeNode[];
  schema: SchemaProperty;
}

interface SchemaTreeViewerProps {
  schema: any;
  selectedPath: string | null;
  onSelectPath: (path: string, schema: SchemaProperty) => void;
}

export default function SchemaTreeViewer({ schema, selectedPath, onSelectPath }: SchemaTreeViewerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set()); // Start completely collapsed

  // Store root-level $defs for reference resolution throughout recursion
  const rootDefs = schema.$defs || schema.definitions || {};

  // Build tree structure from JSON schema
  const buildTree = (
    schemaObj: any,
    path: string = "",
    _name: string = "root",
    _parentRequired: string[] = []
  ): SchemaTreeNode[] => {
    const nodes: SchemaTreeNode[] = [];

    // Detect and unwrap root transaction type wrappers (ImportDeclaration/ExportDeclaration)
    if (path === "" && schemaObj.properties) {
      const rootKeys = Object.keys(schemaObj.properties);
      
      // If schema has single root property named ImportDeclaration or ExportDeclaration
      if (rootKeys.length === 1 && (rootKeys[0] === "ImportDeclaration" || rootKeys[0] === "ExportDeclaration")) {
        const wrapper = schemaObj.properties[rootKeys[0]];
        
        // Unwrap and treat the inner structure as root
        if (wrapper.properties) {
          return buildTree(wrapper, "", "root", wrapper.required || []);
        }
      }
    }

    // Resolve $ref using root-level $defs
    const resolveRef = (ref: string): SchemaProperty | null => {
      if (ref.startsWith("#/$defs/") || ref.startsWith("#/definitions/")) {
        const defName = ref.replace("#/$defs/", "").replace("#/definitions/", "");
        return rootDefs[defName] || null;
      }
      return null;
    };

    // Process properties
    if (schemaObj.properties) {
      const required = schemaObj.required || [];

      Object.entries(schemaObj.properties).forEach(([propName, propSchema]: [string, any]) => {
        const fieldPath = path ? `${path}.${propName}` : propName;
        let resolvedSchema = propSchema;

        // Resolve $ref
        if (propSchema.$ref) {
          const refSchema = resolveRef(propSchema.$ref);
          if (refSchema) {
            resolvedSchema = refSchema;
          }
        }

        const node: SchemaTreeNode = {
          path: fieldPath,
          name: propName,
          type: resolvedSchema.type || "object",
          isRequired: required.includes(propName),
          isArray: resolvedSchema.type === "array",
          description: resolvedSchema.description,
          schema: resolvedSchema,
        };

        // Handle nested objects
        if (resolvedSchema.type === "object" && resolvedSchema.properties) {
          node.children = buildTree(
            resolvedSchema,
            fieldPath,
            propName,
            resolvedSchema.required || []
          );
        }

        // Handle arrays
        if (resolvedSchema.type === "array" && resolvedSchema.items) {
          const itemsSchema = resolvedSchema.items;
          let resolvedItemsSchema = itemsSchema;

          // Resolve $ref in items
          if (itemsSchema.$ref) {
            const refSchema = resolveRef(itemsSchema.$ref);
            if (refSchema) {
              resolvedItemsSchema = refSchema;
            }
          }

          if (resolvedItemsSchema.type === "object" && resolvedItemsSchema.properties) {
            // Show array item structure
            node.children = buildTree(
              resolvedItemsSchema,
              `${fieldPath}[]`,
              `${propName}[]`,
              resolvedItemsSchema.required || []
            );
          }
        }

        nodes.push(node);
      });
    }

    return nodes;
  };

  const tree = buildTree(schema);

  const toggleExpanded = (path: string) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const renderNode = (node: SchemaTreeNode, level: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer hover:bg-surface-hover ${
            isSelected ? "bg-blue-50 border-l-4 border-brand" : ""
          }`}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
          onClick={() => {
            console.log('🖱️ Node clicked:', { path: node.path, hasChildren, schema: node.schema });
            // Complex objects: expand AND select for layout configuration
            // Leaf fields: select for field configuration
            if (hasChildren) {
              toggleExpanded(node.path);
            }
            onSelectPath(node.path, node.schema);
          }}
        >
          {/* Expand/Collapse Icon */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(node.path);
              }}
              className="w-4 h-4 flex items-center justify-center text-ink-muted hover:text-ink"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {/* Icon based on type */}
          {node.isArray ? (
            <List className="w-4 h-4 text-purple-600" />
          ) : hasChildren ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-yellow-600" />
            ) : (
              <Folder className="w-4 h-4 text-yellow-600" />
            )
          ) : (
            <FileText className="w-4 h-4 text-blue-600" />
          )}

          {/* Field Name */}
          <span className={`text-xs font-mono ${
            isSelected 
              ? "font-bold text-brand" 
              : "text-ink"
          }`}>
            {node.name}
          </span>
          
          {/* Complex Object Indicator */}
          {hasChildren && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
              COMPLEX
            </span>
          )}

          {/* Required Badge */}
          {node.isRequired && (
            <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold">
              REQUIRED
            </span>
          )}

          {/* Type Badge */}
          <span className="text-[9px] px-1.5 py-0.5 bg-surface-muted text-ink-muted rounded font-mono">
            {node.type}
          </span>
        </div>

        {/* Render Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children!.map((child) => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto border-r border-border bg-white">
      <div className="sticky top-0 bg-surface-muted border-b border-border px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Schema Structure</h3>
            <p className="text-[10px] text-ink-muted mt-1">
              Select complex objects (📁) to create layouts, or fields (📄) to configure
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setExpandedPaths(new Set())}
              className="text-[10px] px-2 py-1 bg-white border border-border rounded hover:bg-surface-hover transition-colors"
              title="Collapse All"
            >
              Collapse All
            </button>
            <button
              onClick={() => {
                // Expand all paths
                const allPaths = new Set<string>();
                const collectPaths = (nodes: SchemaTreeNode[]) => {
                  nodes.forEach(node => {
                    allPaths.add(node.path);
                    if (node.children) {
                      collectPaths(node.children);
                    }
                  });
                };
                collectPaths(tree);
                setExpandedPaths(allPaths);
              }}
              className="text-[10px] px-2 py-1 bg-white border border-border rounded hover:bg-surface-hover transition-colors"
              title="Expand All"
            >
              Expand All
            </button>
          </div>
        </div>
      </div>
      <div className="py-2">
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
