"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface SelectionContextValue {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: readonly string[], checked: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

function useSelectionContext(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (context === null) {
    throw new Error("Bulk-selection components must be rendered inside a SelectionProvider.");
  }
  return context;
}

/** Selection state for a page of rows. Remounts (a new page, a new search) reset it for free. */
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: readonly string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(() => ({ selected, toggle, setMany, clear }), [selected, toggle, setMany, clear]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** Read-only access to the current selection, for a bulk action bar. */
export function useSelectedIds(): ReadonlySet<string> {
  return useSelectionContext().selected;
}

export function useClearSelection(): () => void {
  return useSelectionContext().clear;
}

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelectionContext();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`Select ${label}`}
      className="h-4 w-4 rounded border-border accent-current"
    />
  );
}

export function SelectAllCheckbox({ ids, label }: { ids: readonly string[]; label: string }) {
  const { selected, setMany } = useSelectionContext();
  const selectedOnPage = ids.filter((id) => selected.has(id)).length;
  const allSelected = ids.length > 0 && selectedOnPage === ids.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      onChange={() => setMany(ids, !allSelected)}
      aria-label={`Select all ${label}`}
      disabled={ids.length === 0}
      className="h-4 w-4 rounded border-border accent-current"
    />
  );
}
