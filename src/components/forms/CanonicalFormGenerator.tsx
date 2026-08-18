"use client";

import { useState } from "react";
import { Input, FormField, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface FieldSchema {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "date" | "select" | "object" | "array";
  required?: boolean;
  options?: string[];
  fields?: FieldSchema[];
  itemSchema?: FieldSchema;
  help?: string;
}

interface CanonicalFormGeneratorProps {
  schema: FieldSchema[];
  data: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  readOnly?: boolean;
}

function FieldInput({ field, value, onChange, path, readOnly }: {
  field: FieldSchema;
  value: any;
  onChange: (path: string, value: any) => void;
  path: string;
  readOnly?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (field.type === "string" || field.type === "number" || field.type === "date") {
    return (
      <FormField key={path}>
        <Label htmlFor={path}>{field.label}{field.required && <span className="text-red-600 ml-1">*</span>}</Label>
        {field.help && <p className="text-xs text-ink-muted mt-1">{field.help}</p>}
        <Input id={path} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={value ?? ""} onChange={(e) => onChange(path, field.type === "number" ? parseFloat(e.target.value) : e.target.value)} disabled={readOnly} required={field.required} />
      </FormField>
    );
  }

  if (field.type === "boolean") {
    return (
      <FormField key={path}>
        <div className="flex items-center gap-2">
          <input id={path} type="checkbox" checked={value ?? false} onChange={(e) => onChange(path, e.target.checked)} disabled={readOnly} className="w-4 h-4 rounded border-border text-brand focus:ring-brand" />
          <Label htmlFor={path} className="mb-0">{field.label}{field.required && <span className="text-red-600 ml-1">*</span>}</Label>
        </div>
        {field.help && <p className="text-xs text-ink-muted mt-1">{field.help}</p>}
      </FormField>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <FormField key={path}>
        <Label htmlFor={path}>{field.label}{field.required && <span className="text-red-600 ml-1">*</span>}</Label>
        {field.help && <p className="text-xs text-ink-muted mt-1">{field.help}</p>}
        <Select id={path} value={value ?? ""} onChange={(e) => onChange(path, e.target.value)} disabled={readOnly} required={field.required}>
          <option value="">-- Select --</option>
          {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </Select>
      </FormField>
    );
  }

  if (field.type === "object" && field.fields) {
    return (
      <div key={path} className="space-y-3 pl-4 border-l-2 border-border">
        <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2 text-sm font-bold text-ink hover:text-brand transition-colors">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{field.label}{field.required && <span className="text-red-600">*</span>}
        </button>
        {field.help && <p className="text-xs text-ink-muted">{field.help}</p>}
        {isExpanded && <div className="space-y-3 pl-2">{field.fields.map((subField) => <FieldInput key={`${path}.${subField.name}`} field={subField} value={value?.[subField.name]} onChange={onChange} path={`${path}.${subField.name}`} readOnly={readOnly} />)}</div>}
      </div>
    );
  }

  if (field.type === "array" && field.itemSchema) {
    const itemSchema = field.itemSchema;
    const arrayValue = Array.isArray(value) ? value : [];
    const addItem = () => onChange(path, [...arrayValue, itemSchema.type === "object" ? {} : ""]);
    const removeItem = (index: number) => onChange(path, arrayValue.filter((_: unknown, i: number) => i !== index));

    return (
      <div key={path} className="space-y-3 pl-4 border-l-2 border-border">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2 text-sm font-bold text-ink hover:text-brand transition-colors">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{field.label} ({arrayValue.length}){field.required && <span className="text-red-600">*</span>}
          </button>
          {!readOnly && <Button type="button" variant="secondary" size="sm" onClick={addItem}><Plus className="w-3 h-3" />Add</Button>}
        </div>
        {field.help && <p className="text-xs text-ink-muted">{field.help}</p>}
        {isExpanded && (
          <div className="space-y-4 pl-2">
            {arrayValue.length === 0 ? <p className="text-xs text-ink-muted italic">No items added yet</p> : arrayValue.map((item: any, index: number) => (
              <div key={`${path}[${index}]`} className="space-y-2 p-3 rounded-xl border border-border bg-surface-muted/30">
                <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-ink">Item {index + 1}</span>{!readOnly && <button type="button" onClick={() => removeItem(index)} className="text-red-600 hover:text-red-700 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}</div>
                <FieldInput field={itemSchema} value={item} onChange={onChange} path={`${path}[${index}]`} readOnly={readOnly} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

export function CanonicalFormGenerator({ schema, data, onChange, readOnly }: CanonicalFormGeneratorProps) {
  const handleFieldChange = (path: string, value: any) => {
    const newData = { ...data };
    const pathParts = path.split(/[\.\[\]]+/).filter(Boolean);
    let current: any = newData;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      const nextPart = pathParts[i + 1];
      const isNextArray = /^\d+$/.test(nextPart);
      if (isNextArray && !Array.isArray(current[part])) current[part] = [];
      else if (!current[part] || typeof current[part] !== "object") current[part] = {};
      current = current[part];
    }
    current[pathParts[pathParts.length - 1]] = value;
    onChange(newData);
  };

  return <div className="space-y-4">{schema.map((field) => <FieldInput key={field.name} field={field} value={data[field.name]} onChange={handleFieldChange} path={field.name} readOnly={readOnly} />)}</div>;
}
